# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Aniston HRMS, please email
**anistondeveloperteam@gmail.com** directly. Do not open a public GitHub issue.

---

## Secret Management

### The Golden Rule

**The `.env` file must NEVER be committed to git.**

The `.env` file contains live database credentials, JWT signing secrets, and
third-party API keys. If it is committed — even once, even in a "private" repo —
all secrets inside it must be considered compromised and rotated immediately.

### How secrets are managed in this project

| Secret type | Storage |
|---|---|
| DB credentials, JWT secrets, SMTP | `.env` file (local) or environment variables (server) |
| AI provider API keys | AES-256-GCM encrypted in the `AiApiConfig` DB table, managed via Settings UI |
| Aadhaar / PAN / bank account numbers | AES-256-GCM encrypted column (`*Encrypted` suffix) via `backend/src/utils/encryption.ts` |
| Task manager API keys (Jira/Asana/ClickUp) | AES-256-GCM encrypted in the `TaskManagerConfig` DB table |

### Setting up a new environment

```bash
# 1. Copy the template
cp .env.example .env

# 2. Generate secure JWT secrets
openssl rand -hex 64   # paste as JWT_SECRET
openssl rand -hex 64   # paste as JWT_REFRESH_SECRET

# 3. Generate the AES encryption key
openssl rand -hex 32   # paste as ENCRYPTION_KEY

# 4. Fill in DATABASE_URL, SMTP, and any optional API keys
```

### Generating secure secrets

```bash
# JWT_SECRET (64-byte hex = 512-bit key)
openssl rand -hex 64

# JWT_REFRESH_SECRET
openssl rand -hex 64

# ENCRYPTION_KEY (32-byte hex = 256-bit AES key)
openssl rand -hex 32
```

---

## Immediate Rotation Checklist

If any of the following were ever committed to the git history, rotate them NOW:

- [ ] `JWT_SECRET` — invalidates all active sessions; regenerate and redeploy
- [ ] `JWT_REFRESH_SECRET` — same impact as above
- [ ] `DATABASE_URL` password — change the Postgres user password immediately
- [ ] `OPENAI_API_KEY` — revoke in OpenAI dashboard and generate a new key
- [ ] `DEEPSEEK_API_KEY` — revoke in DeepSeek dashboard
- [ ] `ANTHROPIC_API_KEY` — revoke in Anthropic console
- [ ] `SMTP_PASS` — change in your mail provider
- [ ] `ENCRYPTION_KEY` — changing this requires re-encrypting all `*Encrypted` fields in the DB; plan carefully
- [ ] `STORAGE_SECRET_KEY` — rotate in MinIO / S3

---

## Removing a Secret from Git History

If `.env` (or any file containing secrets) was ever committed, the commit-level
secret still lives in the git history even after you delete the file.  
Use `git filter-repo` to rewrite history and then force-push:

```bash
# Install git-filter-repo (once)
pip install git-filter-repo

# Remove .env from entire git history
git filter-repo --invert-paths --path .env --force

# Force-push all branches (coordinate with the team first)
git push origin --force --all
git push origin --force --tags
```

After rewriting history, all collaborators must re-clone the repository. Old
clones will still have the compromised history locally.

---

## Pre-commit Hook

A pre-commit hook is included at `.github/hooks/pre-commit` to block accidental
`.env` commits. Install it locally:

```bash
cp .github/hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

## Dependencies & Supply Chain

- Keep dependencies up to date: `npm audit` and `npm outdated` regularly
- The CI pipeline runs `npm audit` on every push
- Pin Docker base image digests in production Dockerfiles
