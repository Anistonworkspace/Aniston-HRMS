/**
 * PM2 Ecosystem Config
 * Used by CI/CD (deploy.yml step 16) for zero-downtime backend restarts.
 * Run locally: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'aniston-hrms',
      script: 'backend/dist/server.js',
      cwd: '/home/ubuntu/Aniston-HRMS',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      // Graceful reload — waits for this many ms before forcing kill (matches graceful shutdown timeout)
      kill_timeout: 10000,
      // Wait for app to send ready signal before considering it up
      wait_ready: true,
      listen_timeout: 10000,
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // Log config
      out_file: '/home/ubuntu/Aniston-HRMS/logs/out.log',
      error_file: '/home/ubuntu/Aniston-HRMS/logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
