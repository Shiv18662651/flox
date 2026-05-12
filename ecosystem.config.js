// PM2 Ecosystem Configuration for Nexify Shopify Super-App
// Requirements: 16.6, 16.7, 16.8
//
// Cluster mode: The Remix app runs with 2 instances for zero-downtime restarts.
// PM2 automatically restarts crashed processes within 5 seconds (default behavior).
//
// Auto-restart behavior:
//   - PM2 monitors all processes and restarts them on crash
//   - Default restart delay: 0ms (immediate), configurable via restart_delay
//   - max_restarts: 10 within min_uptime window prevents restart loops
//   - exp_backoff_restart_delay: exponential backoff on repeated crashes
//
// Sentry integration:
//   - Unhandled exceptions in both Remix app and BullMQ workers are captured by Sentry
//   - SENTRY_DSN environment variable configures the Sentry project
//   - Initialize Sentry in app entry (entry.server.tsx) and worker entry (workers/index.ts)
//   - Sentry captures: unhandled rejections, uncaught exceptions, BullMQ job failures after max retries
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 reload shopify-app  # Zero-downtime reload
//   pm2 logs               # View all logs
//   pm2 monit              # Real-time monitoring

module.exports = {
  apps: [
    {
      name: 'shopify-app',
      script: 'build/server/index.js',
      instances: 2,
      exec_mode: 'cluster',
      exp_backoff_restart_delay: 1000, // Exponential backoff starting at 1s on repeated crashes
      max_restarts: 10,
      min_uptime: '5s', // Process must run at least 5s to be considered started
      env: { NODE_ENV: 'production', PORT: 3000 }
    },
    {
      name: 'bullmq-workers',
      script: 'workers/index.ts',
      interpreter: 'node_modules/.bin/tsx',
      instances: 1,
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '5s',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'meilisearch',
      script: '/usr/local/bin/meilisearch',
      args: '--http-addr 127.0.0.1:7700 --master-key ${MEILISEARCH_MASTER_KEY}',
      interpreter: 'none',
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '5s',
    }
  ]
}
