#!/bin/bash
# Pre-command hook for Aniston HRMS
# Runs before every terminal command

COMMAND="$@"
LOG_DIR=".claude/logs"
mkdir -p "$LOG_DIR"

# Log command with timestamp
echo "[$(date '+%Y-%m-%d %H:%M:%S')] $COMMAND" >> "$LOG_DIR/command-history.log"

# Warn if db:push without db:generate
if echo "$COMMAND" | grep -q "db:push"; then
  echo "REMINDER: Run 'npx prisma generate' after db:push to update the Prisma client"
fi

# Block dangerous rm -rf on critical directories
if echo "$COMMAND" | grep -qE "rm -rf.*(prisma/|backend/src/|frontend/src/)"; then
  echo "BLOCKED: Cannot rm -rf critical project directories (prisma/, backend/src/, frontend/src/)"
  exit 1
fi

exit 0
