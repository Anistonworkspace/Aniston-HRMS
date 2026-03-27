---
name: check-health
description: Verify the entire Aniston HRMS development environment is healthy
---

# Health Check

Run these checks and report green/yellow/red status:

```bash
# 1. Docker containers
echo "=== Docker ==="
docker ps --format "{{.Names}}: {{.Status}}" | grep -E "postgres|redis" || echo "RED: Docker containers not running"

# 2. Backend health
echo "=== Backend ==="
curl -s http://localhost:4000/api/health | grep '"ok"' && echo "GREEN" || echo "RED: Backend not responding"

# 3. Frontend
echo "=== Frontend ==="
curl -s http://localhost:5173 | head -1 | grep "html" && echo "GREEN" || echo "RED: Frontend not responding"

# 4. Database connection
echo "=== Database ==="
npx prisma db push --dry-run 2>&1 | grep "already in sync" && echo "GREEN" || echo "YELLOW: Schema may need push"

# 5. Environment variables
echo "=== Env Vars ==="
for var in DATABASE_URL REDIS_URL JWT_SECRET JWT_REFRESH_SECRET PORT FRONTEND_URL; do
  grep -q "$var" .env && echo "  $var: SET" || echo "  $var: MISSING"
done
```

## Expected Output
```
Docker:    GREEN (postgres + redis running)
Backend:   GREEN (health check 200)
Frontend:  GREEN (Vite serving)
Database:  GREEN (schema in sync)
Env Vars:  GREEN (all required vars set)
```
