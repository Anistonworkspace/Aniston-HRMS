#!/bin/bash
# ============================================================
# Aniston HRMS — Database Restore Script
# Usage: bash scripts/restore-db.sh <backup_file.sql.gz>
# ============================================================

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: bash scripts/restore-db.sh <backup_file.sql.gz>"
  echo ""
  echo "Available backups:"
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
  ls -lht "$PROJECT_DIR/backups/db/"*.sql.gz 2>/dev/null || echo "  No backups found in backups/db/"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Database connection
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-aniston}"
DB_PASSWORD="${DB_PASSWORD:-aniston_hrms_2026}"
DB_NAME="${DB_NAME:-aniston_hrms}"

echo "=== Aniston HRMS — Database Restore ==="
echo "Restoring from: $BACKUP_FILE"
echo "Target database: $DB_NAME"
echo ""
echo "WARNING: This will DROP and recreate all tables in $DB_NAME!"
read -p "Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

echo ""
echo "Restoring..."

export PGPASSWORD="$DB_PASSWORD"

# Decompress and restore
gunzip -c "$BACKUP_FILE" | psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --single-transaction 2>&1 | tail -5

echo ""
echo "=== Database restore complete ==="
echo "Run 'npx prisma generate' to regenerate the Prisma client."
