#!/bin/bash
# ============================================================
# Aniston HRMS — PostgreSQL Database Backup Script
# Usage: bash scripts/backup-db.sh [backup_dir]
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${1:-$PROJECT_DIR/backups/db}"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="backup_${TIMESTAMP}.sql"
MANIFEST="$BACKUP_DIR/manifest.json"

# Database connection — reads from env vars, then falls back to parsing DATABASE_URL
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-aniston}"
DB_NAME="${DB_NAME:-aniston_hrms}"

# Resolve password: explicit DB_PASSWORD > parse from DATABASE_URL > Docker default
if [ -z "${DB_PASSWORD:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  # Extract password from postgresql://user:password@host:port/dbname
  DB_PASSWORD="$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
fi
DB_PASSWORD="${DB_PASSWORD:-aniston_hrms_dev}"

echo "=== Aniston HRMS — Database Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Target: $BACKUP_DIR/$BACKUP_FILE.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Run pg_dump
export PGPASSWORD="$DB_PASSWORD"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --no-owner --no-acl --clean --if-exists \
  > "$BACKUP_DIR/$BACKUP_FILE"

# Compress
gzip "$BACKUP_DIR/$BACKUP_FILE"
COMPRESSED="${BACKUP_FILE}.gz"
FILE_SIZE=$(du -sh "$BACKUP_DIR/$COMPRESSED" | cut -f1)

echo "Backup created: $COMPRESSED ($FILE_SIZE)"

# Count tables and rows for manifest
TABLE_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" 2>/dev/null | tr -d ' ' || echo "unknown")
ROW_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
  "SELECT sum(n_live_tup) FROM pg_stat_user_tables;" 2>/dev/null | tr -d ' ' || echo "unknown")

# Update manifest
if [ -f "$MANIFEST" ]; then
  # Append to existing manifest
  TEMP=$(mktemp)
  python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
data['backups'].append({
    'file': '$COMPRESSED',
    'size': '$FILE_SIZE',
    'tables': '$TABLE_COUNT',
    'rows': '$ROW_COUNT',
    'timestamp': '$(date -Iseconds)',
    'type': 'scheduled'
})
# Keep last 30 entries
data['backups'] = data['backups'][-30:]
with open('$MANIFEST', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || echo "Warning: Could not update manifest (python3 not available)"
else
  # Create new manifest
  cat > "$MANIFEST" << MANIFEST_EOF
{
  "project": "Aniston HRMS",
  "backups": [
    {
      "file": "$COMPRESSED",
      "size": "$FILE_SIZE",
      "tables": "$TABLE_COUNT",
      "rows": "$ROW_COUNT",
      "timestamp": "$(date -Iseconds)",
      "type": "initial"
    }
  ]
}
MANIFEST_EOF
fi

# Cleanup: keep last 30 daily backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/backup_*.sql.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 30 ]; then
  echo "Cleaning up old backups (keeping last 30)..."
  ls -1t "$BACKUP_DIR"/backup_*.sql.gz | tail -n +31 | xargs rm -f
fi

echo "=== Database backup complete ==="
echo "File: $BACKUP_DIR/$COMPRESSED"
echo "Size: $FILE_SIZE"
echo "Tables: $TABLE_COUNT | Rows: $ROW_COUNT"
