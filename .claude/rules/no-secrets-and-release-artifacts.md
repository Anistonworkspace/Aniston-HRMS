---
name: no-secrets-and-release-artifacts
type: rule
applies_to: ["git", "deploy", "build", "release"]
---

# No Secrets and Release Artifacts Rule — Aniston HRMS

## Absolute Rules (Never Violate)

### Secrets — Never Commit
- NEVER commit `.env` files to git
- NEVER commit `.env.production`, `.env.local`, `.env.staging` to git
- NEVER hardcode API keys, passwords, or tokens in source code
- NEVER put secrets in GitHub Actions YAML inline — always use `${{ secrets.NAME }}`
- NEVER log secrets in CI/CD output (mask all secret values)

### Keystore / APK Signing — Never Commit
- NEVER commit `.jks` or `.keystore` files to git
- NEVER commit `google-services.json` to git
- NEVER commit `GoogleService-Info.plist` to git
- NEVER commit APK files (`.apk`) to git
- NEVER commit AAB files (`.aab`) to git
- These must be stored as base64-encoded GitHub Secrets

### Credentials in Comments — Never
- NEVER put passwords in code comments, even "example" passwords
- NEVER put real API keys in comments, docs, or example configs
- `.env.example` must contain placeholder values only (e.g., `JWT_SECRET=your-secret-here`)

## .gitignore Requirements
The following MUST be in `.gitignore`:
```
.env
.env.*
!.env.example
*.jks
*.keystore
*.apk
*.aab
android/app/google-services.json
ios/App/GoogleService-Info.plist
node_modules/
uploads/
*.log
coverage/
dist/
build/
```

## GitHub Actions Secret Names (Reference)
Approved secret names for this project:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret (min 32 chars)
- `ENCRYPTION_KEY` — AES-256 key (exactly 32 bytes)
- `REDIS_URL` — Redis connection string
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` — email credentials
- `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` — deployment credentials
- `ANDROID_KEYSTORE_BASE64` — keystore file as base64
- `ANDROID_KEY_ALIAS` — keystore key alias
- `ANDROID_KEY_PASSWORD` — key password
- `ANDROID_STORE_PASSWORD` — keystore password

## Release Artifact Rules
- APK/AAB artifacts must be uploaded to EC2 via SCP in CI/CD, not stored in git
- APK served at: `https://hr.anistonav.com/downloads/aniston-hrms.apk`
- Backend build artifacts (`dist/`) must NOT be committed
- Frontend build artifacts (`frontend/dist/`) must NOT be committed
- Build artifacts uploaded to deployment server via SCP only

## Violation Response
If a secret or artifact is accidentally committed:
1. IMMEDIATELY rotate the secret (do not just remove from git — it's in git history)
2. Use `git filter-repo` to purge from full history
3. Force-push the clean history (only case where force-push is acceptable)
4. Notify team about secret rotation
5. Review who may have cloned the repo after the commit

## Code Review Checklist
Before any PR is merged, verify:
- [ ] No `.env` files staged
- [ ] No `*.jks` or `*.keystore` files staged
- [ ] No `*.apk` or `*.aab` files staged
- [ ] No hardcoded secrets in any modified file
- [ ] `git diff --name-only` does not include any of the above