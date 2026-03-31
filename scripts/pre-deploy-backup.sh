#!/bin/bash
# ============================================================
# Aniston HRMS — Pre-Deployment Backup Script
# Runs BOTH database + uploads backup before any deployment.
# Usage: bash scripts/pre-deploy-backup.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_LOG="$PROJECT_DIR/backups/deploy-log.json"
TIMESTAMP="$(date -Iseconds)"
GIT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

echo "============================================"
echo "  Aniston HRMS — Pre-Deployment Backup"
echo "  $(date)"
echo "  Git commit: $GIT_COMMIT"
echo "============================================"
echo ""

mkdir -p "$PROJECT_DIR/backups"

# Step 1: Database backup
echo "[1/2] Running database backup..."
DB_BACKUP_OUTPUT=$(bash "$SCRIPT_DIR/backup-db.sh" 2>&1) || {
  echo "FATAL: Database backup failed! Aborting deployment."
  echo "$DB_BACKUP_OUTPUT"
  exit 1
}
echo "$DB_BACKUP_OUTPUT"
DB_FILE=$(echo "$DB_BACKUP_OUTPUT" | grep "^File:" | sed 's/File: //')
echo ""

# Step 2: Uploads backup
echo "[2/2] Running uploads backup..."
UPLOADS_BACKUP_OUTPUT=$(bash "$SCRIPT_DIR/backup-uploads.sh" 2>&1) || {
  echo "WARNING: Uploads backup failed (non-fatal, continuing)."
  echo "$UPLOADS_BACKUP_OUTPUT"
  UPLOADS_FILE="failed"
}
echo "$UPLOADS_BACKUP_OUTPUT"
UPLOADS_FILE="${UPLOADS_FILE:-$(echo "$UPLOADS_BACKUP_OUTPUT" | grep "^File:" | sed 's/File: //' || echo 'skipped')}"
echo ""

# Step 3: Log deployment metadata
if [ -f "$DEPLOY_LOG" ]; then
  python3 -c "
import json
with open('$DEPLOY_LOG') as f:
    data = json.load(f)
data['deployments'].append({
    'deployedAt': '$TIMESTAMP',
    'dbBackup': '$(basename "$DB_FILE" 2>/dev/null || echo "unknown")',
    'uploadsBackup': '$(basename "$UPLOADS_FILE" 2>/dev/null || echo "skipped")',
    'gitCommit': '$GIT_COMMIT'
})
data['deployments'] = data['deployments'][-50:]
with open('$DEPLOY_LOG', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || echo "Warning: Could not update deploy log"
else
  cat > "$DEPLOY_LOG" << EOF
{
  "project": "Aniston HRMS",
  "deployments": [
    {
      "deployedAt": "$TIMESTAMP",
      "dbBackup": "$(basename "$DB_FILE" 2>/dev/null || echo "unknown")",
      "uploadsBackup": "$(basename "$UPLOADS_FILE" 2>/dev/null || echo "skipped")",
      "gitCommit": "$GIT_COMMIT"
    }
  ]
}
EOF
fi

echo "============================================"
echo "  Pre-deployment backup COMPLETE"
echo "  DB:      $(basename "$DB_FILE" 2>/dev/null || echo "done")"
echo "  Uploads: $(basename "$UPLOADS_FILE" 2>/dev/null || echo "skipped")"
echo "  Commit:  $GIT_COMMIT"
echo "============================================"
echo ""
echo "Safe to proceed with deployment."
