#!/usr/bin/env bash
# Nexify — Production Deploy Script
# Run this on your Hostinger VPS every time you push changes.
#
# Usage:
#   chmod +x deploy/deploy.sh
#   ./deploy/deploy.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo ""
echo "========================================="
echo "  Nexify Deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================="
echo ""

# ── 1. Check .env exists ────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "❌ ERROR: .env file not found in $APP_DIR"
  echo "   Copy .env.example to .env and fill in your production values."
  exit 1
fi

# Warn if SHOPIFY_APP_URL is still localhost
if grep -q "localhost" .env 2>/dev/null; then
  echo "⚠️  WARNING: .env contains 'localhost' — SHOPIFY_APP_URL must be your real domain."
  echo "   Example: SHOPIFY_APP_URL=https://your-domain.com"
  echo "   Continuing anyway, but the app will not work with Shopify until this is fixed."
  echo ""
fi

# ── 2. Install dependencies ─────────────────────────────────────────────────
echo "📦 Installing dependencies..."
NODE_ENV=development npm ci
echo "✅ Dependencies installed"
echo ""

# ── 3. Generate Prisma client ────────────────────────────────────────────────
echo "🗃️  Generating Prisma client..."
npx prisma generate
echo "✅ Prisma client generated"
echo ""

# ── 4. Run database migrations ──────────────────────────────────────────────
echo "🗃️  Running database migrations..."
# Baseline the DB if no migrations exist yet but the schema is already applied
if [ ! -d "prisma/migrations" ] || [ -z "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "   → No migrations found, baselining existing database..."
  mkdir -p prisma/migrations/0_init
  npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
  npx prisma migrate resolve --applied 0_init
  echo "   → Baseline complete"
else
  npx prisma migrate deploy
fi
echo "✅ Migrations applied"
echo ""

# ── 5. Build Remix app ───────────────────────────────────────────────────────
echo "🔨 Building Remix app..."
npx remix vite:build
echo "✅ Remix app built → build/server/index.js"
echo ""

# ── 6. Start / reload PM2 processes ─────────────────────────────────────────
echo "🚀 Starting PM2 processes..."

if pm2 list | grep -q "shopify-app"; then
  echo "   → Reloading existing PM2 processes (zero-downtime)..."
  pm2 reload ecosystem.config.js --update-env
else
  echo "   → Starting PM2 processes for the first time..."
  pm2 start ecosystem.config.js
fi

# Save PM2 process list so it survives reboots
pm2 save
echo "✅ PM2 processes running"
echo ""

# ── 8. Health check ──────────────────────────────────────────────────────────
echo "🩺 Health check (waiting 5s for app to start)..."
sleep 5

if curl -sf http://127.0.0.1:3000 -o /dev/null 2>&1; then
  echo "✅ App is responding on port 3000"
else
  echo "⚠️  App did not respond on port 3000 after 5 seconds."
  echo "   Check logs with: pm2 logs shopify-app --lines 50"
fi
echo ""

# ── 9. Show PM2 status ───────────────────────────────────────────────────────
pm2 list

echo ""
echo "========================================="
echo "  Deploy complete!"
echo "========================================="
echo ""
echo "Useful commands:"
echo "  pm2 logs shopify-app       — live app logs"
echo "  pm2 logs bullmq-workers    — live worker logs"
echo "  pm2 monit                  — real-time process monitor"
echo "  pm2 reload shopify-app     — zero-downtime reload"
echo "  pm2 restart shopify-app    — full restart"
