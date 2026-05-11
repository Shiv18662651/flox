#!/usr/bin/env bash
# UFW Firewall Setup Script for Nexify Shopify Super-App
# Requirements: 16.2, 16.3, 16.4, 16.5, 16.11, 16.12
#
# This script configures UFW to:
# - Allow SSH (port 22) for server management
# - Allow Nginx Full (ports 80, 443) for HTTP/HTTPS traffic
# - Block direct access to PostgreSQL (5432), Redis (6379), Meilisearch (7700)
#
# Security notes:
# - All secrets (API keys, DB credentials, etc.) are stored in environment variables
#   and NEVER committed to version control. See .env.example for reference.
# - All database queries use Prisma ORM with parameterized queries — no raw SQL injection risk.
# - SESSION_SECRET must be at least 32 characters (validated at startup in env.server.ts).
# - MEILISEARCH_MASTER_KEY must be at least 16 characters (validated at startup in env.server.ts).
#
# Usage:
#   chmod +x deploy/setup-firewall.sh
#   sudo ./deploy/setup-firewall.sh

set -euo pipefail

echo "🔒 Configuring UFW firewall for Nexify..."

# Reset UFW to default (deny incoming, allow outgoing)
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (port 22)
ufw allow ssh
echo "✅ Allowed SSH (port 22)"

# Allow Nginx Full (ports 80 and 443)
ufw allow 'Nginx Full'
echo "✅ Allowed Nginx Full (ports 80, 443)"

# Explicitly deny direct access to internal services
# These services should only be accessible via localhost (127.0.0.1)
ufw deny 5432/tcp  # PostgreSQL
ufw deny 6379/tcp  # Redis
ufw deny 7700/tcp  # Meilisearch
echo "✅ Blocked direct access to PostgreSQL (5432), Redis (6379), Meilisearch (7700)"

# Enable UFW
ufw --force enable
echo "✅ UFW enabled"

# Show status
ufw status verbose

echo ""
echo "🔒 Firewall configuration complete."
echo ""
echo "Security reminders:"
echo "  • All secrets must be in environment variables (never in version control)"
echo "  • PostgreSQL, Redis, and Meilisearch listen on 127.0.0.1 only"
echo "  • Prisma ORM ensures all DB queries are parameterized (no SQL injection)"
echo "  • SESSION_SECRET must be ≥32 characters"
echo "  • MEILISEARCH_MASTER_KEY must be ≥16 characters"
