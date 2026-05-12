# Nexify VPS Setup & Deployment Guide

## PM2 Process Configuration

The app uses these 3 PM2 processes:

| Name | Script | Purpose |
|------|--------|---------|
| `shopify-app` | `app-start.sh` | Remix app via remix-serve |
| `bullmq-workers` | `workers-start.sh` | BullMQ job workers |
| `meilisearch` | meilisearch binary | Search engine |

## Start Scripts

### app-start.sh
```bash
#!/bin/bash
cd /var/www/nexify
set -a
source .env
set +a
exec npx remix-serve ./build/server/index.js
```

### workers-start.sh
```bash
#!/bin/bash
cd /var/www/nexify
set -a
source .env
set +a
export WORKERS_ROLE=worker
npx tsx workers/index.ts
```

## .env Rules

**CRITICAL:** The `.env` file must have NO lines without `KEY=VALUE` format.
- Every line must be `KEY=VALUE`, a comment `# comment`, or blank
- Multi-word values with spaces MUST be quoted: `BREVO_SENDER_NAME="Nexify App"`
- No standalone words (causes `source .env` to fail with "command not found")

Check for bad lines:
```bash
grep -n "^[^#=]*$" /var/www/nexify/.env | grep -v "^[0-9]*:$"
```

## Deploy (after code changes)

```bash
cd /var/www/nexify && bash deploy/deploy.sh
```

## Troubleshoot 502 Bad Gateway

```bash
# Check if app is running
pm2 status

# Check if port 3000 is listening
ss -tlnp | grep 3000

# Check app logs
pm2 logs shopify-app --lines 30 --nostream

# Restart app
pm2 restart shopify-app --update-env
```

## Required npm packages (must be installed)

```bash
npm install --save-dev @remix-run/serve tsx
```

## If app won't start after deploy

1. Check `.env` for bad lines: `sed -n '20,30p' .env`
2. Check build exists: `ls build/server/index.js`
3. Run manually: `source .env && npx remix-serve ./build/server/index.js`
