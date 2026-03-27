#!/bin/bash
# Post-save hook for Aniston HRMS
# Runs after every file edit

FILE="$1"
LOG_DIR=".claude/logs"
mkdir -p "$LOG_DIR"

# If prisma schema changed, remind to generate
if echo "$FILE" | grep -q "schema.prisma"; then
  echo "REMINDER: Run 'npx prisma generate' to update the Prisma client after schema changes"
fi

# Log the edit
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Edited: $FILE" >> "$LOG_DIR/edit-history.log"

exit 0
