# Aniston HRMS — EC2 Deployment Guide

> Deploy via MobaXterm (SSH to Ubuntu EC2)
> EC2 IP: 13.126.128.38

---

## Step 1: Install Prerequisites on EC2

Run these commands one by one:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v
npm -v

# Install Docker & Docker Compose
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Install nginx
sudo apt install -y nginx

# Install Git (should already be installed)
sudo apt install -y git

# IMPORTANT: Log out and back in for docker group to take effect
exit
```

After reconnecting to MobaXterm:

```bash
# Verify docker works without sudo
docker --version
docker compose version
```

---

## Step 2: Clone the Repository

```bash
cd /home/ubuntu
git clone https://github.com/Anistonworkspace/Aniston-HRMS.git
cd Aniston-HRMS
```

---

## Step 3: Create Production Environment File

```bash
nano .env.production
```

Paste this content (update values with your real secrets):

```env
NODE_ENV=production
PORT=4000

# Database (Docker postgres on same server)
DATABASE_URL="postgresql://aniston:CHANGE_THIS_STRONG_PASSWORD@localhost:5432/aniston_hrms?schema=public"

# Redis (Docker redis on same server)
REDIS_URL="redis://localhost:6379"

# JWT Secrets (CHANGE THESE — must be 32+ chars)
JWT_SECRET="CHANGE-THIS-TO-A-RANDOM-64-CHAR-STRING-FOR-PRODUCTION-USE"
JWT_REFRESH_SECRET="CHANGE-THIS-TO-ANOTHER-RANDOM-64-CHAR-STRING-FOR-PROD"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"

# URLs (use your domain)
FRONTEND_URL="http://hr.anistonav.com"
API_URL="http://hr.anistonav.com/api"

# AI Service
AI_SERVICE_URL="http://localhost:8000"
AI_SERVICE_API_KEY="your-ai-service-key"

# SMTP (for sending emails)
SMTP_HOST="smtp.office365.com"
SMTP_PORT=587
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="noreply@anistonav.com"

# Storage
STORAGE_BUCKET="aniston-hrms"
```

Save: `Ctrl+O`, Enter, `Ctrl+X`

---

## Step 4: Start PostgreSQL & Redis via Docker

```bash
cd /home/ubuntu/Aniston-HRMS

# Create docker-compose for production services
cat > docker-compose.services.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: aniston-postgres
    restart: always
    environment:
      POSTGRES_USER: aniston
      POSTGRES_PASSWORD: CHANGE_THIS_STRONG_PASSWORD
      POSTGRES_DB: aniston_hrms
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aniston -d aniston_hrms"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: aniston-redis
    restart: always
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
EOF

# Start services
docker compose -f docker-compose.services.yml up -d

# Verify they're running
docker ps
```

---

## Step 5: Install Dependencies & Build

```bash
cd /home/ubuntu/Aniston-HRMS

# Install all dependencies
npm ci

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Seed the database
npx tsx prisma/seed.ts

# Build shared package
npm run build --workspace=shared

# Build backend
npm run build --workspace=backend

# Build frontend (with production API URL)
VITE_API_URL=/api npm run build --workspace=frontend
```

---

## Step 6: Configure Nginx (Reverse Proxy)

```bash
sudo nano /etc/nginx/sites-available/aniston-hrms
```

Paste this:

```nginx
server {
    listen 80;
    server_name hr.anistonav.com 13.126.128.38;

    # Frontend static files
    root /home/ubuntu/Aniston-HRMS/frontend/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Socket.io
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Uploaded files
    location /uploads/ {
        alias /home/ubuntu/Aniston-HRMS/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback — all other routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 256;

    client_max_body_size 10M;
}
```

Save and enable:

```bash
sudo ln -sf /etc/nginx/sites-available/aniston-hrms /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

## Step 7: Start Backend with PM2

```bash
# Install PM2 globally
sudo npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'aniston-hrms',
    script: 'backend/dist/server.js',
    cwd: '/home/ubuntu/Aniston-HRMS',
    env_file: '.env.production',
    env: {
      NODE_ENV: 'production',
      PORT: 4000,
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: '/home/ubuntu/Aniston-HRMS/logs/error.log',
    out_file: '/home/ubuntu/Aniston-HRMS/logs/out.log',
  }]
};
EOF

# Create logs directory
mkdir -p logs

# Load env vars and start
set -a && source .env.production && set +a
pm2 start ecosystem.config.js

# Save PM2 process list (auto-start on reboot)
pm2 save
pm2 startup
# Run the command PM2 tells you (starts with sudo)
```

---

## Step 8: Verify Deployment

```bash
# Check PM2 process
pm2 status

# Check backend health
curl http://localhost:4000/api/health

# Check nginx
curl http://localhost/api/health

# Check from outside (use domain or EC2 public IP)
# Open browser: http://hr.anistonav.com
```

---

## Step 9: Open EC2 Security Group Ports

In AWS Console → EC2 → Security Groups → Edit inbound rules:

| Type | Port | Source |
|------|------|--------|
| HTTP | 80 | 0.0.0.0/0 |
| HTTPS | 443 | 0.0.0.0/0 |
| SSH | 22 | Your IP |

---

## Updating (After Code Changes)

```bash
cd /home/ubuntu/Aniston-HRMS
git pull origin main
npm ci
npx prisma generate
npx prisma db push
npm run build --workspace=shared
npm run build --workspace=backend
VITE_API_URL=/api npm run build --workspace=frontend
pm2 restart aniston-hrms
```

---

## Troubleshooting

```bash
# Check backend logs
pm2 logs aniston-hrms

# Check nginx logs
sudo tail -f /var/log/nginx/error.log

# Check docker services
docker ps
docker logs aniston-postgres
docker logs aniston-redis

# Restart everything
pm2 restart all
sudo systemctl restart nginx
```

---

## Login

After deployment, open `http://hr.anistonav.com` in browser:
- **Super Admin:** `superadmin@anistonav.com` / `Superadmin@1234`
