---
name: deploy
description: Deploy Aniston HRMS to EC2 production server
---

# Deploy to Production

## Pre-flight Checks
1. Verify no uncommitted changes: `git status`
2. Verify on main branch: `git branch --show-current`
3. Build backend locally: `npm run build --workspace=backend`
4. Build frontend locally: `cd frontend && npx vite build`
5. Run tests: `npm run test --workspace=backend`

## Deploy Options

### Option A — GitHub Actions (Recommended)
1. Go to GitHub → Actions → "Deploy to EC2"
2. Click "Run workflow"
3. Type `deploy` in the confirmation field
4. Click green "Run workflow" button
5. Monitor the workflow run for success/failure

### Option B — Manual SSH Deploy
```bash
# SSH into EC2
ssh ubuntu@13.126.128.38

# On EC2:
cd /home/ubuntu/Aniston-HRMS
git pull origin main
npm ci
npx prisma generate
npx prisma db push
cd frontend && npx vite build && cd ..
pm2 restart aniston-hrms

# Verify
sleep 5 && curl -s http://localhost:4000/api/health
```

## Post-Deploy Verification
- [ ] Health check returns 200: `curl https://hr.anistonav.com/api/health`
- [ ] Login page loads: `https://hr.anistonav.com/login`
- [ ] Login works with test credentials
- [ ] No console errors in browser

## Rollback (if needed)
```bash
# On EC2:
cd /home/ubuntu/Aniston-HRMS
git log --oneline -5  # Find the last working commit
git checkout <commit-hash>
npm ci && npx prisma generate && cd frontend && npx vite build && cd ..
pm2 restart aniston-hrms
```

**IMPORTANT:** Never auto-rollback. Report the error and wait for human decision.
