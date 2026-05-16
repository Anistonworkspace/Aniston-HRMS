#!/bin/bash
# ============================================================
# Aniston HRMS — Server-side Deploy Script
# Called by .github/workflows/deploy.yml via SSH.
# All secrets are passed as environment variables by the workflow.
# ============================================================
set -euo pipefail

cd /home/ubuntu/Aniston-HRMS

echo "=== [2/16] Installing system dependencies ==="
sudo apt-get update -qq 2>&1 | grep -v "^E:" || true
sudo apt-get install -y -qq --fix-missing chromium-browser || sudo apt-get install -y -qq --fix-missing chromium || true
sudo apt-get install -y -qq --fix-missing \
  libatk1.0-0 libatk-bridge2.0-0 libcups2 libxdamage1 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libnspr4 libnss3 libxss1 \
  libxtst6 xdg-utils fonts-liberation \
  libasound2t64 || sudo apt-get install -y -qq libasound2 || true
sudo apt-get install -y -qq --fix-missing postgresql-client zip || true
PG_DUMP_BIN=$(which pg_dump 2>/dev/null || true)
if [ -n "$PG_DUMP_BIN" ]; then
  echo "pg_dump found at: $PG_DUMP_BIN ($(pg_dump --version))"
  grep -q 'PG_DUMP_PATH=' .env 2>/dev/null || echo "PG_DUMP_PATH=$PG_DUMP_BIN" >> .env
  grep -q 'PSQL_PATH=' .env 2>/dev/null || echo "PSQL_PATH=$(which psql 2>/dev/null || true)" >> .env
fi
which docker || (curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu) || true
which docker-compose || sudo apt-get install -y -qq docker-compose-plugin || true

echo "=== [3/16] Pulling latest code ==="
git fetch origin main
git reset --hard origin/main

echo "=== [3.5/17] Ensuring Docker services (postgres + redis) are running ==="
cd /home/ubuntu/Aniston-HRMS/docker
sudo docker compose up -d postgres redis 2>/dev/null \
  || sudo docker-compose up -d postgres redis 2>/dev/null \
  || echo "Docker start failed — may already be running natively"
echo "Waiting for PostgreSQL to become ready..."
for i in $(seq 1 10); do
  sleep 3
  if sudo docker compose exec -T postgres pg_isready -U postgres 2>/dev/null \
     || sudo docker-compose exec -T postgres pg_isready -U postgres 2>/dev/null \
     || pg_isready -h localhost -p 5432 2>/dev/null; then
    echo "PostgreSQL ready after $((i*3))s"
    break
  fi
  echo "  [$((i*3))s] waiting for postgres..."
done
cd /home/ubuntu/Aniston-HRMS

echo "=== [4/17] Writing .env from GitHub Secrets ==="
if [ -z "${DEPLOY_DATABASE_URL:-}" ];       then echo "Missing DATABASE_URL secret";    exit 1; fi
if [ -z "${DEPLOY_JWT_SECRET:-}" ];         then echo "Missing JWT_SECRET secret";      exit 1; fi
if [ -z "${DEPLOY_JWT_REFRESH_SECRET:-}" ]; then echo "Missing JWT_REFRESH_SECRET";     exit 1; fi
if [ -z "${DEPLOY_ENCRYPTION_KEY:-}" ];     then echo "Missing ENCRYPTION_KEY secret";  exit 1; fi
if [ -z "${DEPLOY_REDIS_PASSWORD:-}" ];     then echo "Missing REDIS_PASSWORD secret";  exit 1; fi

# ── DB migration guard ─────────────────────────────────────────────────────────
# Production DB was migrated from aniston_hrms → aniston_hrms_new.
# If the GitHub secret still points to the old name, transparently redirect it.
# Update the DATABASE_URL GitHub secret to aniston_hrms_new to remove this guard.
RESOLVED_DATABASE_URL="${DEPLOY_DATABASE_URL}"
if echo "${RESOLVED_DATABASE_URL}" | grep -q '/aniston_hrms?'; then
  RESOLVED_DATABASE_URL="${RESOLVED_DATABASE_URL//\/aniston_hrms?/\/aniston_hrms_new?}"
  echo "INFO: DATABASE_URL redirected from aniston_hrms → aniston_hrms_new (update the GitHub secret to remove this step)"
fi
# ──────────────────────────────────────────────────────────────────────────────

{
  echo "NODE_ENV=production"
  echo "PORT=4000"
  echo "FRONTEND_URL=https://hr.anistonav.com"
  echo "API_URL=https://hr.anistonav.com"
  echo "AI_SERVICE_URL=http://localhost:8000"
  echo "DATABASE_URL=$RESOLVED_DATABASE_URL"
  echo "REDIS_PASSWORD=$DEPLOY_REDIS_PASSWORD"
  echo "REDIS_URL=redis://:$DEPLOY_REDIS_PASSWORD@127.0.0.1:6379"
  echo "JWT_SECRET=$DEPLOY_JWT_SECRET"
  echo "JWT_REFRESH_SECRET=$DEPLOY_JWT_REFRESH_SECRET"
  echo "JWT_ACCESS_EXPIRY=15m"
  echo "JWT_REFRESH_EXPIRY=7d"
  echo "ENCRYPTION_KEY=$DEPLOY_ENCRYPTION_KEY"
  echo "SMTP_HOST=${DEPLOY_SMTP_HOST:-smtp.office365.com}"
  echo "SMTP_PORT=${DEPLOY_SMTP_PORT:-587}"
  echo "SMTP_FROM=${DEPLOY_SMTP_FROM:-noreply@aniston.in}"
  echo "SMTP_USER=${DEPLOY_SMTP_USER:-}"
  echo "SMTP_PASS=${DEPLOY_SMTP_PASS:-}"
  echo "STORAGE_BUCKET=aniston-hrms"
  echo "STORAGE_ENDPOINT=${DEPLOY_STORAGE_ENDPOINT:-}"
  echo "STORAGE_ACCESS_KEY=${DEPLOY_STORAGE_ACCESS_KEY:-}"
  echo "STORAGE_SECRET_KEY=${DEPLOY_STORAGE_SECRET_KEY:-}"
  echo "OPENAI_API_KEY=${DEPLOY_OPENAI_KEY:-}"
  echo "MAPBOX_ACCESS_TOKEN=${DEPLOY_MAPBOX_TOKEN:-}"
  echo "TEAMS_CLIENT_ID=${DEPLOY_TEAMS_CLIENT_ID:-}"
  echo "TEAMS_CLIENT_SECRET=${DEPLOY_TEAMS_CLIENT_SECRET:-}"
  echo "TEAMS_TENANT_ID=${DEPLOY_TEAMS_TENANT_ID:-}"
} > .env
echo ".env written ($(wc -l < .env) lines)"

echo "=== [4.5/17] Pre-deployment database backup ==="
DATABASE_URL="$RESOLVED_DATABASE_URL" bash scripts/pre-deploy-backup.sh || echo "WARNING: Backup failed — continuing"

echo "=== [5/17] Installing Node.js dependencies ==="
export SCARF_ANALYTICS=false
sudo rm -rf node_modules || true
npm ci || (echo "Retrying npm ci..." && sudo rm -rf node_modules && npm ci)
node -e "import('tar').then(t => console.log('tar OK')).catch(e => console.error('tar missing:', e.message))" || true

echo "=== [6/17] Syncing database schema ==="
(sudo docker exec aph-postgres psql -U aniston -d aniston_hrms -c 'DROP TYPE IF EXISTS "ShiftType_old";' 2>/dev/null \
  || sudo docker exec aniston-shared-db psql -U aniston -d aniston_hrms -c 'DROP TYPE IF EXISTS "ShiftType_old";' 2>/dev/null \
  || true); echo "ShiftType_old cleanup done"

if command -v psql &>/dev/null && [ -n "${RESOLVED_DATABASE_URL:-}" ]; then
  psql "$RESOLVED_DATABASE_URL" -c "ALTER TYPE \"EmployeeStatus\" ADD VALUE IF NOT EXISTS 'INTERN' AFTER 'PROBATION';" 2>/dev/null || true
  psql "$RESOLVED_DATABASE_URL" -c "ALTER TYPE \"AnomalyType\" ADD VALUE IF NOT EXISTS 'GPS_NO_DATA';" 2>/dev/null || true
  psql "$RESOLVED_DATABASE_URL" -c "ALTER TYPE \"AnomalyType\" ADD VALUE IF NOT EXISTS 'GPS_HEARTBEAT_MISSED';" 2>/dev/null || true
  psql "$RESOLVED_DATABASE_URL" -c "ALTER TYPE \"AnomalyType\" ADD VALUE IF NOT EXISTS 'GPS_GAP';" 2>/dev/null || true
  psql "$RESOLVED_DATABASE_URL" -c "ALTER TYPE \"AnomalyType\" ADD VALUE IF NOT EXISTS 'GPS_SIGNAL_LOST';" 2>/dev/null || true
  echo "Pre-applied enum ADD VALUE changes"
fi

echo "Ensuring all known migrations are marked as applied..."
# Resolve any failed migrations first so migrate deploy is not blocked
for migration in \
  20260514000001_delete_legacy_leave_types; do
  npx prisma migrate resolve --rolled-back "$migration" --schema=prisma/schema.prisma 2>/dev/null || true
done
for migration in \
  20260413000000_add_leave_settings_intern_role \
  20260413000001_add_leave_applicable_employees \
  20260429000000_gps_indexes_consent \
  20260502000000_leave_policy_engine \
  20260503000000_leave_balance_breakdown \
  20260503000001_leave_policy_max_paid_per_month \
  20260503000002_attendance_shift_snapshot_and_indexes \
  20260503000003_remove_hybrid_shift_type \
  20260506000000_add_leave_condition_messages \
  20260506000001_leave_unpaid_tracking \
  20260511000000_expand_hr_action_restrictions \
  20260511000001_add_gps_no_data_anomaly_type \
  20260511000002_add_gps_v1_5_5_tracking_fields \
  20260515000000_fix_employee_code_org_unique; do
  npx prisma migrate resolve --applied "$migration" --schema=prisma/schema.prisma 2>/dev/null || true
done
echo "Migration baseline complete"

if ! npx prisma migrate deploy --schema=prisma/schema.prisma; then
  echo "ERROR: prisma migrate deploy failed — aborting deploy to prevent running new code against wrong schema"
  exit 1
fi
echo "Schema migration complete"

echo "=== [6.3/17] Restoring agent pairing state ==="
if command -v psql &>/dev/null && [ -n "${RESOLVED_DATABASE_URL:-}" ]; then
  psql "$RESOLVED_DATABASE_URL" -c "UPDATE \"Employee\" SET \"agentPairedAt\" = '2026-05-03 00:00:00'::timestamp WHERE \"agentPairingCode\" IS NOT NULL AND \"agentPairedAt\" IS NULL AND \"deletedAt\" IS NULL;" 2>/dev/null && echo "Agent pairing state restored" || echo "agentPairedAt update skipped"
fi

echo "=== [6.35/17] Removing legacy leave types (one-time cleanup) ==="
if command -v psql &>/dev/null && [ -n "${RESOLVED_DATABASE_URL:-}" ]; then
  # Hard-delete all leave types that still have old audience values.
  # HR will create fresh leave types from the UI going forward.
  # This runs idempotently — if no legacy types exist, it's a no-op.
  DELETED=$(psql "$RESOLVED_DATABASE_URL" -tAc "
    DELETE FROM \"LeaveType\"
    WHERE \"applicableTo\" NOT IN ('ACTIVE_ONLY','TRAINEE_ONLY','ALL_ELIGIBLE')
    RETURNING id;" 2>/dev/null | wc -l || echo "0")
  echo "Legacy leave types removed: ${DELETED}"
fi

echo "=== [6.4–6.9/17] Running idempotent SQL migrations ==="
if command -v psql &>/dev/null && [ -n "${RESOLVED_DATABASE_URL:-}" ]; then
  for f in \
    prisma/migrations/20260413000000_add_leave_settings_intern_role/migration.sql \
    prisma/migrations/20260413000001_add_leave_applicable_employees/migration.sql \
    prisma/migrations/20260502000000_leave_policy_engine/migration.sql \
    prisma/migrations/20260503000000_leave_balance_breakdown/migration.sql \
    prisma/migrations/20260503000001_leave_policy_max_paid_per_month/migration.sql \
    prisma/migrations/20260503000002_attendance_shift_snapshot_and_indexes/migration.sql \
    prisma/migrations/20260506000000_add_leave_condition_messages/migration.sql \
    prisma/migrations/20260506000001_leave_unpaid_tracking/migration.sql; do
    psql "$RESOLVED_DATABASE_URL" -f "$f" 2>/dev/null || true
  done
  echo "All idempotent SQL migrations applied"
fi

echo "=== [7/17] Generating Prisma client ==="
npx --no-install prisma generate
echo "Prisma client regenerated"

echo "=== [8/17] Building & starting AI service ==="
(
  sudo apt-get install -y -qq --fix-missing tesseract-ocr tesseract-ocr-eng poppler-utils || true
  sudo systemctl start docker || true
  if ! sudo docker info > /dev/null 2>&1; then echo "Docker not accessible — skipping AI service"; exit 0; fi
  cd /home/ubuntu/Aniston-HRMS/docker || exit 0
  touch /home/ubuntu/Aniston-HRMS/docker/.env || true
  sed -i '/^AI_SERVICE_API_KEY=/d' /home/ubuntu/Aniston-HRMS/docker/.env 2>/dev/null || true
  if [ -n "${DEPLOY_AI_SERVICE_API_KEY:-}" ]; then
    echo "AI_SERVICE_API_KEY=${DEPLOY_AI_SERVICE_API_KEY}" >> /home/ubuntu/Aniston-HRMS/docker/.env
    echo "docker/.env: AI_SERVICE_API_KEY set from secret"
  else
    RAND_KEY=$(openssl rand -hex 32)
    echo "AI_SERVICE_API_KEY=${RAND_KEY}" >> /home/ubuntu/Aniston-HRMS/docker/.env
    echo "AI_SERVICE_API_KEY not set — using generated key"
  fi
  sudo docker compose build ai-service 2>/dev/null || sudo docker-compose build ai-service 2>/dev/null || { echo "AI service build failed — skipping"; exit 0; }
  sudo docker compose up -d --no-deps --force-recreate ai-service 2>/dev/null || sudo docker-compose up -d --no-deps --force-recreate ai-service 2>/dev/null || echo "AI service start failed"
  cd /home/ubuntu/Aniston-HRMS || true
  for attempt in $(seq 1 18); do
    sleep 5
    if curl -sf http://localhost:8000/ai/health > /dev/null 2>&1; then echo "AI service healthy after $((attempt*5))s"; exit 0; fi
    echo "  Attempt ${attempt}/18..."
  done
  echo "AI service not healthy — OCR uses Node.js fallback"
) || echo "AI service setup failed (non-blocking) — continuing"
cd /home/ubuntu/Aniston-HRMS || true

echo "=== [9/17] Cleanup scripts ==="
npx tsx scripts/cleanup-holidays.ts; echo "Holiday cleanup done"

echo "=== [9.5/17] Backfill missing ABSENT records for OFFICE employees ==="
npx tsx scripts/backfill-absent-records.ts 2>&1 | tail -20 || echo "Backfill skipped (non-blocking)"

echo "=== [10/17] Seeding database ==="
if [ "${ALLOW_PROD_SEED:-}" = "true" ]; then
  npx tsx prisma/seed.ts
else
  echo "Skipping full seed in production"
fi

echo "=== [10.1/17] Ensuring system accounts are present ==="
node --input-type=module <<'ENSURE_ACCOUNTS_EOF'
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();
async function main() {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    console.error("FATAL: No organization found in DB — cannot ensure system accounts");
    process.exit(1);
  }
  console.log("  using org: " + org.name + " (id=" + org.id + ", slug=" + org.slug + ")");
  const engDept = await prisma.department.findFirst({ where: { name: "Engineering", organizationId: org.id } });
  const ceoDes  = await prisma.designation.findFirst({ where: { name: "CEO", organizationId: org.id } });
  const superPwd   = process.env.DEPLOY_SUPERADMIN_PASSWORD;
  const developerPwd = process.env.DEPLOY_DEVELOPER_PASSWORD;
  if (!superPwd || !developerPwd) {
    console.warn("WARN: DEPLOY_SUPERADMIN_PASSWORD or DEPLOY_DEVELOPER_PASSWORD not set — will only update role/status for existing accounts, skipping password update.");
  }
  const accounts = [
    { email: "superadmin@anistonav.com", password: superPwd,      role: "SUPER_ADMIN", code: "SYS-001", first: "Super",     last: "Admin"   },
    { email: "developer@anistonav.com",  password: developerPwd,  role: "SUPER_ADMIN", code: "SYS-DEV", first: "Developer", last: "Account" },
  ];
  for (const acct of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: acct.email } });
    if (!existing && !acct.password) {
      console.warn("  SKIP: " + acct.email + " does not exist and no password provided — set DEPLOY_SUPERADMIN_PASSWORD / DEPLOY_DEVELOPER_PASSWORD secrets to create it.");
      continue;
    }
    const hash = existing ? existing.passwordHash : await bcrypt.hash(acct.password, 12);
    const updatePwdHash = (existing && acct.password) ? await bcrypt.hash(acct.password, 12) : undefined;
    const user = await prisma.user.upsert({
      where:  { email: acct.email },
      update: { role: acct.role, status: "ACTIVE", ...(updatePwdHash ? { passwordHash: updatePwdHash } : {}) },
      create: { email: acct.email, passwordHash: hash, role: acct.role, status: "ACTIVE", organizationId: org.id },
    });
    // employeeCode is now unique per-org (composite), so look up by (organizationId + employeeCode)
    const existingEmp = await prisma.employee.findFirst({
      where: { employeeCode: acct.code, organizationId: org.id },
    });
    if (existingEmp) {
      await prisma.employee.update({
        where: { id: existingEmp.id },
        data: { isSystemAccount: true, userId: user.id, status: "ACTIVE", deletedAt: null, onboardingComplete: true },
      });
    } else {
      await prisma.employee.create({
        data: {
          employeeCode: acct.code, userId: user.id, firstName: acct.first, lastName: acct.last,
          email: acct.email, phone: "+91-0000000000", gender: "PREFER_NOT_TO_SAY",
          departmentId: engDept ? engDept.id : null, designationId: ceoDes ? ceoDes.id : null,
          workMode: "OFFICE", joiningDate: new Date("2024-01-01"),
          status: "ACTIVE", onboardingComplete: true, isSystemAccount: true, organizationId: org.id,
        },
      });
    }
    console.log("  system account ensured: " + acct.email + " [" + acct.role + "]");
  }
}
main()
  .catch(e => { console.error("system account ensure failed:", e.message); process.exit(0); })
  .finally(() => prisma.$disconnect());
ENSURE_ACCOUNTS_EOF
echo "System account check done"

echo "=== [11/17] Building shared + backend ==="
npm run build --workspace=shared
npm run build --workspace=backend
echo "Shared + Backend compiled"

echo "=== [11.5/17] Building frontend ==="
cd frontend && VITE_API_URL=/api npx vite build && cd ..

echo "=== [12/17] Semantic versioning + OTA bundle ==="
(
  PREV_VERSION=$(curl -s http://localhost:4000/api/app-updates/latest 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);v=d.get('data',{}).get('version','x');print(v if v and v[:1].isdigit() else '0.0.0')" 2>/dev/null || echo "0.0.0")
  PREV_VERSION=${PREV_VERSION:-0.0.0}
  COMMIT_MSG=$(git log -1 --pretty=%B 2>/dev/null || echo "chore: update")
  COMMIT_SUBJECT=$(git log -1 --pretty=%s 2>/dev/null | python3 -c "import sys,re; s=sys.stdin.read().strip(); print(re.sub(r'[^a-zA-Z0-9 .:()\-_]','',s)[:72])" 2>/dev/null || echo "update")
  BUMP_TYPE="patch"
  if echo "$COMMIT_MSG" | grep -qiE "(BREAKING CHANGE|feat!|fix!|refactor!)"; then BUMP_TYPE="major"
  elif echo "$COMMIT_MSG" | grep -qE "^feat[:(]"; then BUMP_TYPE="minor"; fi
  BUNDLE_VERSION=$(python3 -c "v='${PREV_VERSION}'.split('.'); a,b,c=(int(v[i]) if len(v)>i else 0 for i in range(3)); t='${BUMP_TYPE}'; print(str(a+1)+'.0.0' if t=='major' else str(a)+'.'+str(b+1)+'.0' if t=='minor' else str(a)+'.'+str(b)+'.'+str(c+1))" 2>/dev/null || echo "1.0.0")
  echo "New version: ${BUNDLE_VERSION}"
  mkdir -p app-updates
  if [ -d "frontend/dist" ]; then
    (cd frontend/dist && zip -r "../../app-updates/bundle-${BUNDLE_VERSION}.zip" . -q)
    echo "Bundle v${BUNDLE_VERSION} created"
  fi
  python3 -c "import json; m={'version':'${BUNDLE_VERSION}','url':'https://hr.anistonav.com/app-updates/bundle-${BUNDLE_VERSION}.zip','mandatory':True,'notes':'v${BUNDLE_VERSION} - ${COMMIT_SUBJECT}'}; open('app-updates/manifest.json','w').write(json.dumps(m,indent=2))" 2>/dev/null || true
  mkdir -p downloads downloads/agent/agent-build app-updates
  chmod 755 downloads app-updates 2>/dev/null || true
) || echo "OTA versioning failed (non-blocking) — continuing"

echo "=== [13/17] Verifying app binaries ==="
ls -lh downloads/agent/agent-build/aniston-support-setup.exe 2>/dev/null && echo "Agent .exe present" || echo "Agent installer not yet uploaded"

echo "=== [14/17] Updating Nginx config ==="
sudo cp /home/ubuntu/Aniston-HRMS/deploy/nginx.conf /etc/nginx/sites-available/hr.anistonav.com
sudo ln -sf /etc/nginx/sites-available/hr.anistonav.com /etc/nginx/sites-enabled/hr.anistonav.com
sudo nginx -t && sudo systemctl reload nginx || echo "WARNING: Nginx reload failed"

echo "=== [15/17] Checking uploads directory ==="
mkdir -p /home/ubuntu/Aniston-HRMS/uploads
mkdir -p /home/ubuntu/Aniston-HRMS/uploads/backups
mkdir -p /home/ubuntu/Aniston-HRMS/uploads/tmp
mkdir -p /home/ubuntu/Aniston-HRMS/downloads/agent/agent-build

echo "=== [15.5/17] Setting server timezone to UTC ==="
sudo timedatectl set-timezone UTC || true
echo "Server time: $(date)"

echo "=== [16/17] Reloading backend via PM2 (zero-downtime) ==="
mkdir -p /home/ubuntu/Aniston-HRMS/logs
if pm2 show aniston-hrms > /dev/null 2>&1; then
  pm2 reload aniston-hrms --update-env
  echo "Backend reloaded (zero-downtime rolling reload)"
else
  pm2 start ecosystem.config.cjs --env production 2>/dev/null || pm2 start backend/dist/server.js --name aniston-hrms
fi
pm2 save --force
echo "Waiting for backend to come online..."
for i in $(seq 1 12); do
  sleep 3
  STATUS=$(curl -sf http://localhost:4000/api/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('status','?'))" 2>/dev/null || echo "starting")
  echo "  [$((i*3))s] backend status: $STATUS"
  if [ "$STATUS" = "ok" ]; then echo "Backend is live!"; break; fi
done

echo "=== [17/17] Health checks ==="
curl -s http://localhost:4000/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('Status:', d.get('data',{}).get('status','?'))" || curl -s http://localhost:4000/api/health
echo ""
AI_STATUS=$(curl -sf http://localhost:8000/ai/health 2>/dev/null && echo "AI: Running" || echo "AI: Not running (OCR fallback active)")
echo "$AI_STATUS"
pm2 list
pm2 logs aniston-hrms --nostream --lines 10 2>/dev/null || true
echo "=== Deploy complete! ==="
