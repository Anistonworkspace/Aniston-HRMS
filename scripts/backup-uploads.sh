#!/bin/bash
# ============================================================
# Aniston HRMS — Uploads / File Backup Script
# Usage: bash scripts/backup-uploads.sh [backup_dir]
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UPLOADS_DIR="$PROJECT_DIR/uploads"
BACKUP_DIR="${1:-$PROJECT_DIR/backups/uploads}"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="uploads_${TIMESTAMP}.tar.gz"

echo "=== Aniston HRMS — Uploads Backup ==="
echo "Timestamp: $TIMESTAMP"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check if uploads directory exists and has files
if [ ! -d "$UPLOADS_DIR" ] || [ -z "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  echo "No uploads directory or it's empty. Skipping uploads backup."
  exit 0
fi

# Create tar.gz archive
tar -czf "$BACKUP_DIR/$BACKUP_FILE" -C "$PROJECT_DIR" uploads/

FILE_SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
FILE_COUNT=$(find "$UPLOADS_DIR" -type f 2>/dev/null | wc -l)

echo "Backup created: $BACKUP_FILE ($FILE_SIZE, $FILE_COUNT files)"

# Cleanup: keep last 10 upload backups (they're larger)
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 10 ]; then
  echo "Cleaning up old upload backups (keeping last 10)..."
  ls -1t "$BACKUP_DIR"/uploads_*.tar.gz | tail -n +11 | xargs rm -f
fi

echo "=== Uploads backup complete ==="
echo "File: $BACKUP_DIR/$BACKUP_FILE"
echo "Size: $FILE_SIZE | Files: $FILE_COUNT"
