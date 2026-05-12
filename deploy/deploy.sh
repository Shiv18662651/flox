#!/bin/bash
# ============================================================
# Nexify Production Deploy Script
# Usage: bash deploy/deploy.sh
# Run from: /var/www/nexify on VPS
# ============================================================

set -e  # Exit on any error

APP_DIR="/var/www/nexify"
cd "$APP_DIR"

echo "🚀 Starting Nexify deployment..."

# 1. Pull latest code
echo "📦 Pulling latest code..."
git pull origin main

# 2. Install dependencies (including devDeps for remix-serve, tsx)
echo "📥 Installing dependencies..."
npm install

# 3. Build
echo "🔨 Building..."
npm run build

# 4. Restart PM2 with updated env
echo "🔄 Restarting services..."
pm2 restart all --update-env

# 5. Wait and verify
sleep 5
echo "✅ Checking app status..."
pm2 status

# 6. Verify port 3000 is listening
if ss -tlnp | grep -q ':3000'; then
  echo "✅ App is listening on port 3000"
else
  echo "❌ App is NOT listening on port 3000 — check: pm2 logs shopify-app"
  exit 1
fi

echo "🎉 Deployment complete!"
