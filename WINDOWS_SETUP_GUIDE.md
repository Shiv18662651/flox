# Nexify — Windows Local Setup Guide

A step-by-step guide to run Nexify on your Windows machine. Written for non-technical users.

**Estimated total time:** 45–60 minutes for installs, 10 minutes to start the app.

---

## Before You Start

You already have:
- Node.js 22.19.0 ✅
- npm 10.9.3 ✅
- PostgreSQL (installed but needs connection confirmed) ⚠️

You still need to install: **Redis** and **Meilisearch**.

---

## Step 1: Fill in your `.env` file

The `.env` file is already created in your project root. Open it in Kiro and replace the placeholder values:

| Placeholder in `.env` | What to put there |
|---|---|
| `[apna naya secret yahan]` | Your Shopify app's **API secret** from [Shopify Partners Dashboard](https://partners.shopify.com) → Apps → your app → API credentials |
| `[apna password]` | The password you set for the `postgres` user when you installed PostgreSQL |
| `[apni nayi brevo key]` | Your Brevo API key from [Brevo SMTP & API](https://app.brevo.com/settings/keys/api) |
| `[apni nayi groq key]` | Your Groq API key from [console.groq.com/keys](https://console.groq.com/keys) |

If you don't have a Brevo or Groq account yet, both are free to sign up:
- Brevo: https://www.brevo.com (free tier: 300 emails/day)
- Groq: https://console.groq.com (free tier: 14,400 requests/day)

**Save the file.** The rest of the values are already correct for local development.

---

## Step 2: Install Redis for Windows

Redis is the job queue + cache. You have two options.

### Option A (Easiest — recommended): Memurai

Memurai is a Windows-native Redis replacement. It installs as a Windows Service so it runs automatically in the background.

1. Go to https://www.memurai.com/get-memurai
2. Download the **Memurai Developer Edition** (free)
3. Run the `.msi` installer → click Next → Next → Install
4. After install, Memurai is already running as a Windows Service on port 6379. Done.

**Verify it's running:**
- Press `Windows + R`, type `services.msc`, press Enter
- Scroll to "Memurai" — status should be "Running"

### Option B: Redis via WSL (Windows Subsystem for Linux)

Only pick this if you already use WSL. Inside WSL terminal:
```bash
sudo apt update && sudo apt install redis-server -y
sudo service redis-server start
```

### Option C: Docker (skip unless you already use it)

```
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

---

## Step 3: Install Meilisearch for Windows

Meilisearch is the search engine powering customer/product search in the dashboard.

1. Go to https://github.com/meilisearch/meilisearch/releases/latest
2. Scroll down to **Assets**
3. Download `meilisearch-windows-amd64.exe`
4. Create a folder: `C:\meilisearch`
5. Move the downloaded file into it and rename it to `meilisearch.exe`

**To run it later** (don't run yet, I'll tell you when):
- Open PowerShell in `C:\meilisearch`
- Run: `.\meilisearch.exe --master-key NexifyMeilisearch2026LocalKey`

---

## Step 4: Confirm PostgreSQL is running

1. Press `Windows + R`, type `services.msc`, press Enter
2. Look for a service named like **postgresql-x64-16** (or your version)
3. Status should be "Running"
4. If not, right-click → Start

**Create the `nexify` database** (one-time):

1. Open **pgAdmin** (installed with PostgreSQL) from Start menu
2. Connect using your `postgres` password
3. Right-click **Databases** → **Create** → **Database**
4. Name: `nexify` → Save

Or if you prefer command line:
```
psql -U postgres -c "CREATE DATABASE nexify;"
```
(You'll be prompted for your postgres password.)

---

## Step 5: Install project dependencies

Open PowerShell inside the project folder (`C:\Users\ADMIN\Desktop\shopify`) and run:

```
npm install
```

This takes 2–3 minutes. It downloads all the packages the app needs.

---

## Step 6: Create the database tables

Still in PowerShell, still in the project folder:

```
npx prisma migrate dev --name init
```

This creates the 21 tables in your `nexify` database. You'll see output like "Your database is now in sync with your schema."

If it asks you to name the migration, just press Enter.

---

## Installation Summary Checklist

Tick these off before going to Step 7:

- [ ] `.env` file has your real Shopify secret, Postgres password, Brevo key, Groq key
- [ ] Memurai (or Redis) is running — check in services.msc
- [ ] `meilisearch.exe` downloaded to `C:\meilisearch\`
- [ ] PostgreSQL service is running
- [ ] `nexify` database exists in pgAdmin
- [ ] `npm install` completed without errors
- [ ] `npx prisma migrate dev` ran successfully

---

## Step 7: Start the App

You need **two terminal windows open at the same time**, both inside the project folder.

### Terminal 1 — Start Meilisearch

```
cd C:\meilisearch
.\meilisearch.exe --master-key NexifyMeilisearch2026LocalKey
```

Leave this window open. You'll see log lines. Meilisearch is now running on port 7700.

### Terminal 2 — Start the Remix app

Open a **new** PowerShell in the project folder and run:

```
npm run dev
```

After ~15 seconds you'll see something like:
```
Local:   http://localhost:3000
```

Open that URL in your browser.

---

## What Each Service Does (So You Know Why It's Running)

| Service | Port | Why it's needed |
|---|---|---|
| PostgreSQL | 5432 | Stores all app data (shops, customers, reviews, orders, etc.) |
| Redis / Memurai | 6379 | Powers the job queue (BullMQ) and cache |
| Meilisearch | 7700 | Full-text search for customer/product lookups |
| Nexify app | 3000 | The actual Remix web app |

---

## Troubleshooting

### "Missing required environment variables" when running `npm run dev`
- You have empty values in `.env`. Open it and make sure every line has a value after the `=` sign.

### "Can't reach database server at localhost:5432"
- PostgreSQL service isn't running. Open services.msc → find PostgreSQL → right-click → Start
- Or the password in `.env` doesn't match your postgres password

### "ECONNREFUSED 127.0.0.1:6379"
- Redis/Memurai isn't running. Check services.msc.

### "Failed to connect to Meilisearch"
- Your Terminal 1 probably closed or crashed. Restart it.

### Port 3000 already in use
- Another app is using it. Either close that app, or edit `.env` and change `PORT=3000` to `PORT=3001`, then visit http://localhost:3001.

### Prisma migrate says "P1001: Can't reach database server"
- Same as the Postgres issue above. Verify the password in your `DATABASE_URL` matches what you set when installing Postgres.

---

## Running Tests (Optional)

To run the test suite (306 tests, ~2 seconds):
```
npx vitest --run
```

---

## Important Limitations in Local Mode

Since you're using fake values for R2, Sentry, and placeholder values for some APIs:

- **Photo uploads (review photos) will fail** — R2 is fake. This is expected locally.
- **Sentry won't report errors** — `SENTRY_DSN=fake`. Errors go to console only.
- **Shopify webhooks won't reach your localhost** — to test real webhooks, you'd need a tunnel tool like [ngrok](https://ngrok.com) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). For basic UI testing, this doesn't matter.
- **Emails will actually send** if your Brevo key is real — test with `test@test.com` recipients during development.

Everything else (dashboards, CRUD, loyalty, referrals, analytics pixel, etc.) works fully locally.
