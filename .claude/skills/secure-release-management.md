---
name: secure-release-management
description: "Skill for secure release management: secrets audit, APK signing, CI/CD pipeline validation, zero-downtime deploy, rollback execution"
type: skill
---

# Secure Release Management Skill — Aniston HRMS

## When to Use
Use when asked to:
- Prepare a production release
- Audit secrets before deploy
- Validate CI/CD pipeline
- Execute a rollback
- Set up signing for APK/AAB

## Pre-Release Security Checklist

### Secrets Audit
```bash
# Search for hardcoded secrets
grep -r "password\|secret\|api_key\|apikey" --include="*.ts" --include="*.tsx" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist ./ | grep -v ".test." | grep -v "//.*"

# Check .env is not tracked
git ls-files .env .env.* | grep -v .env.example

# Check no keystores in repo
git ls-files "*.jks" "*.keystore" "*.apk" "*.aab"
```

If any of the above return results → BLOCK release.

### GitHub Secrets Required
Before any deploy, verify these secrets exist in GitHub repo settings:
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `REDIS_URL`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`
- For Android: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`

## Zero-Downtime Deploy Sequence
```bash
# Step 1: Build on CI server (not prod)
npm run build

# Step 2: Database migration (backward-compatible BEFORE code swap)
npx prisma migrate deploy

# Step 3: Copy new build to server
scp -r dist/ ubuntu@$EC2_HOST:/home/ubuntu/Aniston-HRMS/dist-new/

# Step 4: Atomic swap + reload (PM2 cluster mode = zero downtime)
pm2 reload ecosystem.config.js --env production

# Step 5: Health check
curl -f https://hr.anistonav.com/api/health || { echo "Health check failed"; exit 1; }

# Step 6: Confirm old dist cleaned up
rm -rf /home/ubuntu/Aniston-HRMS/dist-old/
```

## PM2 Zero-Downtime Reload
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'aniston-hrms-backend',
    script: './dist/server.js',
    instances: 'max',          // Use all CPU cores
    exec_mode: 'cluster',      // Required for zero-downtime reload
    max_memory_restart: '500M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 4000,
    },
    // Graceful shutdown: wait for in-flight requests to complete
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
  }]
};
```

`pm2 reload` sends SIGINT to one worker, waits for in-flight requests to complete, then starts new worker — true zero downtime.

## APK Release Flow
```yaml
# GitHub Actions snippet
- name: Build Release APK
  run: |
    # Decode keystore
    echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > /tmp/keystore.jks
    
    # Sync Capacitor
    cd frontend && npx cap sync android
    
    # Build signed APK
    cd android && ./gradlew assembleRelease \
      -Pandroid.injected.signing.store.file=/tmp/keystore.jks \
      -Pandroid.injected.signing.store.password=${{ secrets.ANDROID_STORE_PASSWORD }} \
      -Pandroid.injected.signing.key.alias=${{ secrets.ANDROID_KEY_ALIAS }} \
      -Pandroid.injected.signing.key.password=${{ secrets.ANDROID_KEY_PASSWORD }}
    
    # Cleanup (always run)
    rm -f /tmp/keystore.jks
    
    # Upload to EC2
    scp app/build/outputs/apk/release/app-release.apk \
      ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }}:~/downloads/apk-build/aniston-hrms.apk
```

## Rollback Execution

### Code Rollback
```bash
# Find last good commit
git log --oneline -10

# Create revert commit (safe — doesn't rewrite history)
git revert HEAD --no-edit

# Or revert to specific commit
git revert <bad-commit-hash> --no-edit

# Push to trigger CI/CD
git push origin main
```

### Database Rollback (if migration was run)
```bash
# Restore from backup
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER $DB_NAME < /path/to/backup.sql

# Mark migration as rolled back
DATABASE_URL=$PROD_DB_URL npx prisma migrate resolve --rolled-back MIGRATION_NAME

# Verify state
DATABASE_URL=$PROD_DB_URL npx prisma migrate status
```

## Post-Deploy Verification
```bash
# Health check
curl -s https://hr.anistonav.com/api/health | jq '.status'

# Verify version deployed
curl -s https://hr.anistonav.com/api/version | jq '.version'

# Check PM2 processes
pm2 status

# Check recent logs for errors
pm2 logs aniston-hrms-backend --lines 50 | grep -i error

# Check Nginx
nginx -t && echo "Nginx config OK"
```

## Release Checklist
```
PRE-RELEASE:
- [ ] No open P0/P1 issues
- [ ] All tests pass in CI
- [ ] TypeScript: zero errors
- [ ] Security audit: no new criticals
- [ ] Database backup created
- [ ] Staging deployment verified

RELEASE:
- [ ] Migration runs first
- [ ] PM2 reload (zero-downtime)
- [ ] Health check passes
- [ ] Nginx reload

POST-RELEASE:
- [ ] Monitor error rates for 15 min
- [ ] Verify key workflows work (login, leave, payroll)
- [ ] Confirm APK download URL works (if mobile release)
- [ ] Tag the release in git: git tag v[X.Y.Z]
```