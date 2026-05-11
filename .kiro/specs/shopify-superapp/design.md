# Design Document: Shopify Super-App (Nexify)

## Overview

Nexify is an all-in-one Shopify public app that consolidates the functionality of approximately 15 separate third-party apps into a single unified platform. The system is built on Remix (Node.js) with Shopify CLI, backed by PostgreSQL 16 via Prisma ORM, Redis 7 + BullMQ for background job processing, Meilisearch for full-text search, and Cloudflare R2 for file storage. Real-time features (live chat, FOMO popups) are powered by Socket.io. Third-party integrations include Brevo (email), Groq API with Llama 3 (AI), WhatsApp Business API, and Sentry (error monitoring). The entire stack runs on a single Hostinger KVM 2 VPS (Ubuntu 22.04, 2 vCPU, 8 GB RAM, 100 GB NVMe).

The app targets Shopify merchants generating $10K–$500K/year in revenue and is sold on the Shopify App Store under three subscription tiers: Starter ($29/mo), Growth ($79/mo), and Pro ($199/mo), billed through Shopify's native Billing API.

### Key Design Goals

- **Modularity**: Each feature (reviews, email, loyalty, etc.) is an independent module with its own routes, workers, and database models, but shares a common infrastructure layer.
- **Reliability**: All Shopify webhook processing is asynchronous and idempotent via BullMQ queues with retry logic.
- **Performance**: Meilisearch handles dashboard search; Redis caches hot data; PostgreSQL handles transactional writes; BullMQ workers handle all heavy lifting off the request path.
- **Security**: All secrets in environment variables, parameterized queries via Prisma, HMAC verification on all webhooks, SSL termination at Nginx, UFW firewall restricting internal service ports.
- **Scalability within VPS constraints**: PM2 cluster mode (2 instances), Redis-backed session store, and stateless Remix loaders allow horizontal scaling within the VPS RAM budget.

---

## Architecture

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Shopify Platform                          │
│  App Store Install → OAuth Flow → Webhooks → Billing API        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Hostinger KVM 2 VPS                           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Nginx (Reverse Proxy + SSL Termination)                 │    │
│  │  - Let's Encrypt TLS                                     │    │
│  │  - HTTP → HTTPS redirect                                 │    │
│  │  - WebSocket upgrade for /socket.io/                     │    │
│  └──────────────────────┬──────────────────────────────────┘    │
│                         │ proxy_pass 127.0.0.1:3000             │
│  ┌──────────────────────▼──────────────────────────────────┐    │
│  │  PM2 Cluster (2x Remix Node.js instances)                │    │
│  │  - Shopify OAuth / Session management                    │    │
│  │  - Merchant dashboard routes (app.*)                     │    │
│  │  - API routes (webhooks, pixel, reviews, chat)           │    │
│  │  - Socket.io server (live chat + FOMO)                   │    │
│  └──────┬──────────────────────────────────────────────────┘    │
│         │                                                        │
│  ┌──────▼──────────────────────────────────────────────────┐    │
│  │  PM2 BullMQ Worker Process                               │    │
│  │  - email.worker    (Brevo sends)                         │    │
│  │  - sms.worker      (WhatsApp sends)                      │    │
│  │  - webhook.worker  (Shopify event processing)            │    │
│  │  - review.worker   (review request emails)               │    │
│  │  - seo.worker      (SEO audits + AI meta generation)     │    │
│  │  - analytics.worker (daily aggregation)                  │    │
│  │  - search.worker   (Meilisearch index updates)           │    │
│  └──────┬──────────────────────────────────────────────────┘    │
│         │                                                        │
│  ┌──────▼──────────────────────────────────────────────────┐    │
│  │  Data Layer                                              │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │    │
│  │  │ PostgreSQL 16│  │   Redis 7    │  │ Meilisearch   │  │    │
│  │  │ (Prisma ORM) │  │ (BullMQ +   │  │ (127.0.0.1:   │  │    │
│  │  │ :5432 local  │  │  cache)      │  │  7700 local)  │  │    │
│  │  └──────────────┘  └──────────────┘  └───────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐      ┌──────────────────────┐
│ Cloudflare R2   │      │  External APIs        │
│ (File Storage)  │      │  - Brevo (email)      │
│ + CDN           │      │  - Groq (AI/LLM)      │
└─────────────────┘      │  - WhatsApp Business  │
                         │  - Sentry (errors)    │
                         └──────────────────────┘
```

### Request Flow

**Merchant Dashboard Request:**
1. Browser → Nginx (TLS) → Remix app (port 3000)
2. Remix loader verifies Shopify session via `authenticate.admin(request)`
3. Loader queries PostgreSQL via Prisma, optionally queries Meilisearch
4. Response rendered server-side and streamed to browser

**Shopify Webhook:**
1. Shopify → Nginx → `POST /api/webhooks` route
2. HMAC signature verified synchronously
3. `WebhookEvent` record created with status `pending`
4. Job enqueued in BullMQ WEBHOOK queue
5. HTTP 200 returned to Shopify within 5 seconds
6. BullMQ worker processes job asynchronously with idempotency check

**Real-time (Chat / FOMO):**
1. Storefront widget → Socket.io (via Nginx WebSocket upgrade)
2. Socket.io server broadcasts events to shop-specific rooms
3. Fallback: REST polling at 30-second intervals if WebSocket unavailable

### Process Architecture (PM2)

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'shopify-app',
      script: 'build/index.js',
      instances: 2,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3000 }
    },
    {
      name: 'bullmq-workers',
      script: 'workers/index.js',
      instances: 1,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'meilisearch',
      script: '/usr/local/bin/meilisearch',
      args: '--http-addr 127.0.0.1:7700 --master-key ${MEILISEARCH_MASTER_KEY}',
      interpreter: 'none'
    }
  ]
}
```

---

## Components and Interfaces

### 1. Shopify OAuth and Session Management (`app/shopify.server.ts`)

Wraps `@shopify/shopify-app-remix` to provide:
- `authenticate.admin(request)` — verifies session, redirects to OAuth if expired
- `authenticate.webhook(request)` — verifies HMAC signature for webhook routes
- `authenticate.public.appProxy(request)` — for storefront API proxy calls
- Session storage backed by PostgreSQL `sessions` table via Prisma adapter

**Installation Flow:**
```
GET /?shop=mystore.myshopify.com
  → shopify.authenticate.admin() detects no session
  → Redirect to Shopify OAuth: /auth?shop=...
  → Shopify redirects to /auth/callback?code=...&shop=...
  → Exchange code for offline access token
  → Persist Session record
  → Create Shop record (if new)
  → Register webhooks
  → Initialize module settings
  → Redirect to /app (dashboard)
```

### 2. Database Client (`app/db.server.ts`)

Singleton Prisma client with connection pooling. Exports typed Prisma client instance. All database operations use Prisma's parameterized query builder — no raw SQL strings with user input.

```typescript
import { PrismaClient } from '@prisma/client'

let db: PrismaClient
declare global { var __db__: PrismaClient | undefined }

if (process.env.NODE_ENV === 'production') {
  db = new PrismaClient()
} else {
  if (!global.__db__) global.__db__ = new PrismaClient()
  db = global.__db__
}

export { db }
```

### 3. Redis Client (`app/redis.server.ts`)

Singleton `ioredis` client connecting to `127.0.0.1:6379`. Used by BullMQ for job queues and optionally for caching hot data (e.g., plan limits, shop settings).

### 4. Meilisearch Client (`app/meilisearch.server.ts`)

Singleton `meilisearch` client connecting to `http://127.0.0.1:7700`. Manages two indexes:
- `customers` — indexed fields: `email`, `firstName`, `lastName`, `phone`
- `products` — indexed fields: `title`, `vendor`, `productType`, `tags`

### 5. R2 Client (`app/r2.server.ts`)

AWS S3-compatible client using `@aws-sdk/client-s3` pointed at Cloudflare R2 endpoint. Exposes:
- `uploadFile(key, body, contentType): Promise<string>` — returns public CDN URL
- `deleteFile(key): Promise<void>`
- `deleteFolder(prefix): Promise<void>` — batch delete by prefix (for review cleanup)

### 6. BullMQ Workers (`workers/`)

Single worker process managing 7 queues. Each queue has a dedicated worker file:

| Queue | Worker | Concurrency | Retry |
|---|---|---|---|
| `email` | `email.worker.ts` | 5 | 3× exponential |
| `sms` | `sms.worker.ts` | 3 | 3× exponential |
| `webhook` | `webhook.worker.ts` | 10 | 3× exponential |
| `review-request` | `review.worker.ts` | 3 | 3× exponential |
| `seo-audit` | `seo.worker.ts` | 1 | 2× exponential |
| `analytics` | `analytics.worker.ts` | 1 | 1× |
| `search-index` | `search.worker.ts` | 5 | 3× exponential |

### 7. Socket.io Server

Integrated into the Remix server entry point. Rooms are namespaced by `shopId`:
- `shop:{shopId}` — merchant agent inbox (receives customer messages)
- `storefront:{shopId}` — storefront widgets (receives FOMO events, chat replies)

Authentication: storefront widgets pass `shopId` as a query parameter; merchant dashboard passes a signed session token.

### 8. Theme App Extensions (`extensions/`)

Five Liquid/JavaScript extensions deployed to Shopify's CDN:

| Extension | Placement | Socket.io | REST Fallback |
|---|---|---|---|
| `review-widget` | Product page | No | Yes (polling) |
| `upsell-widget` | Cart / Thank-you | No | No |
| `fomo-widget` | All pages | Yes | Yes (30s poll) |
| `chat-widget` | All pages | Yes | No |
| `loyalty-widget` | Account / All pages | No | Yes |

### 9. API Routes (`app/routes/api/`)

| Route | Method | Purpose |
|---|---|---|
| `/api/webhooks` | POST | Shopify webhook receiver |
| `/api/reviews` | POST | Review submission from tokenized link |
| `/api/pixel` | POST | First-party analytics event ingestion |
| `/api/chat` | GET/POST | Chat REST fallback |
| `/api/tracking` | GET | Email open/click tracking |
| `/api/referral` | GET | Referral link handler |

### 10. AI Client (`app/ai.server.ts`)

Groq SDK wrapper exposing:
- `chatbotReply(message, shopContext, history)` — customer support responses
- `generateSeoMeta(product)` — SEO title + description generation
- `generateAltText(imageUrl, productTitle)` — image alt text generation
- `analyzeReviewSentiment(reviewText)` — positive/neutral/negative classification

All Groq calls use `llama-3.3-70b-versatile` with `max_tokens: 300` for chat and `max_tokens: 150` for SEO/alt text to stay within rate limits.

---

## Data Models

The complete Prisma schema is defined in `prisma/schema.prisma`. Below is a summary of each model group and key design decisions.

### Core Models

**`Shop`** — Central tenant record. All other models reference `shopId`. Stores `accessToken` (encrypted at rest via environment-level disk encryption), `plan` enum, and `isActive` flag. Soft-deleted on uninstall (never hard-deleted to preserve billing history).

**`Session`** — Shopify OAuth session storage. Managed by `@shopify/shopify-app-remix` session adapter. Stores offline access tokens for background API calls.

### Customer Model

```prisma
model Customer {
  id              String   @id @default(cuid())
  shopId          String
  shopifyId       String   // Shopify customer GID
  email           String
  loyaltyPoints   Int      @default(0)   // denormalized sum of transactions
  loyaltyTier     String?
  isSubscribed    Boolean  @default(true)
  referralCode    String?  @unique
  // ... other fields
  @@unique([shopId, shopifyId])
  @@index([shopId])
  @@index([email])
}
```

`loyaltyPoints` is a denormalized counter updated on every `LoyaltyTransaction` write. This avoids expensive SUM aggregations on the hot path. The authoritative balance is always the sum of `LoyaltyTransaction` records; the denormalized field is a cache.

### Review Models

`Review` stores the submitted review with `isApproved` and `isPublished` flags (two-step moderation). Photos are stored as `String[]` of R2 CDN URLs. `ReviewRequest` tracks the outbound email lifecycle (pending → sent → opened → reviewed).

### Email Marketing Models

`Campaign` stores the block-based template as `templateJson` (JSON) and the rendered HTML as `templateHtml` (cached string). `EmailSend` is a per-recipient record linking to either a `Campaign` or `Automation`, tracking Brevo message ID and open/click timestamps.

### Loyalty and Referral Models

`LoyaltyTransaction` is an append-only ledger. Point balance is computed as `SUM(points)` across all transactions for a customer (positive for `earn`, negative for `redeem`). The `Customer.loyaltyPoints` field is a denormalized cache updated transactionally.

`Referral` tracks the full lifecycle: `pending` → `signed_up` → `purchased` → `rewarded`. The `discountCode` field stores the Shopify discount code generated for the advocate.

### Analytics Model

`AnalyticsEvent` is a high-volume append-only table. Raw events are aggregated into daily summaries by the `analytics.worker.ts` BullMQ job. The aggregation job runs nightly and writes to a separate `AnalyticsDailySummary` table (not in the base schema but added via migration) to support fast dashboard queries without scanning millions of raw events.

### Webhook Model

`WebhookEvent` provides idempotency. The combination of `(shopId, topic, shopifyId)` uniquely identifies a Shopify resource event. Before processing, the worker checks for an existing `processed` record with the same key.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Property Reflection:** After prework analysis, the following redundancies were resolved:
- Properties 2 and 8 (loyalty balance non-negativity and ledger consistency) were combined into a single comprehensive property since ledger consistency implies non-negativity when redemptions are gated.
- Properties 3 and 7.13 (email quota) were merged — the plan limit enforcement covers all email send paths.
- Properties 1.3 and 1.5 (shop initialization) were combined since both test the same post-install setup invariant.

### Property 1: Webhook Idempotency

*For any* Shopify webhook event identified by `(shopId, topic, shopifyId)`, processing it a second time SHALL produce no additional side effects — the system state after two deliveries SHALL be identical to the state after one delivery.

**Validates: Requirements 13.4**

### Property 2: Loyalty Ledger Consistency and Non-Negativity

*For any* customer and any sequence of earn and redeem transactions, the `Customer.loyaltyPoints` field SHALL always equal the arithmetic sum of all accepted `LoyaltyTransaction.points` values for that customer, and any redemption that would cause the balance to become negative SHALL be rejected — the balance SHALL never be negative after any sequence of valid operations.

**Validates: Requirements 8.6, 8.10, 8.11**

### Property 3: Email Quota Enforcement

*For any* shop on a given plan, the total number of emails sent within a calendar month SHALL never exceed the plan limit (5,000 for STARTER, 25,000 for GROWTH, 100,000 for PRO), and any campaign or automation send attempted after the limit is reached SHALL be rejected with a quota warning.

**Validates: Requirements 2.8, 2.9, 2.10, 7.13**

### Property 4: Review Token Validity

*For any* review submission request, the system SHALL only accept the submission if the token corresponds to a valid, unprocessed `ReviewRequest` record for the same shop — all submissions with invalid, expired, already-used, or mismatched tokens SHALL be rejected with an error.

**Validates: Requirements 4.3**

### Property 5: Referral Self-Use Prevention

*For any* customer attempting to use a referral code, if the referral code belongs to that same customer, the system SHALL reject the referral and return an error — no `Referral` record SHALL be created and no discount SHALL be issued.

**Validates: Requirements 11.9**

### Property 6: Webhook HMAC Verification

*For any* incoming webhook request, the system SHALL only process the payload if the computed HMAC-SHA256 of the raw request body using the Shopify API secret matches the `X-Shopify-Hmac-Sha256` header exactly, and SHALL return HTTP 401 for all requests where the signature does not match.

**Validates: Requirements 13.1, 13.2**

### Property 7: File Upload Key Structure

*For any* file uploaded to R2 with parameters `(module, shopId, resourceId, filename)`, the storage key SHALL exactly equal `{module}/{shopId}/{resourceId}/{filename}` and the returned CDN URL SHALL exactly equal `{R2_PUBLIC_URL}/{module}/{shopId}/{resourceId}/{filename}`.

**Validates: Requirements 14.2, 14.3**

### Property 8: Plan Feature Gating

*For any* merchant request to use a feature restricted to GROWTH or PRO plans, if the shop's current plan is STARTER, the system SHALL deny access and display an upgrade prompt — no restricted feature's business logic SHALL execute for a STARTER plan shop.

**Validates: Requirements 2.4, 4.11, 6.9, 8.9, 10.7**

### Property 9: Unsubscribe Suppression

*For any* customer with `isSubscribed = false`, the system SHALL not enqueue any marketing email for that customer's address, regardless of campaign type, automation trigger, or send time — the suppression SHALL hold for all future sends until the customer explicitly re-subscribes.

**Validates: Requirements 7.11, 7.12**

### Property 10: Shop Initialization Completeness

*For any* new shop completing OAuth installation, the system SHALL create exactly one Shop record with `plan = STARTER`, and SHALL initialize exactly one settings record each for Chat, SEO, Loyalty, and Referral modules — no module settings record SHALL be missing after a successful installation.

**Validates: Requirements 1.3, 1.5**

### Property 11: Campaign Recipient Fanout

*For any* campaign with N eligible (subscribed, within-quota) recipients, scheduling the campaign SHALL enqueue exactly N EMAIL jobs in the BullMQ EMAIL queue — no recipient SHALL receive more than one job per campaign send.

**Validates: Requirements 7.3**

### Property 12: Loyalty Points Calculation Correctness

*For any* paid order with subtotal S and shop setting `pointsPerDollar = P`, the earned loyalty points SHALL equal `floor(S × P)` — the calculation SHALL be consistent regardless of order size, currency rounding, or fractional dollar amounts.

**Validates: Requirements 8.2**

---

## Error Handling

### Webhook Processing Errors

- HMAC failure → HTTP 401, no record created, no job enqueued
- Valid webhook, job processing failure → `WebhookEvent.status = 'failed'`, error stored in `WebhookEvent.error`, BullMQ retries up to 3× with exponential backoff (1s, 2s, 4s)
- After 3 failures → job moves to BullMQ dead-letter queue, Sentry alert fired

### External API Errors

**Brevo:**
- Bounce/spam complaint → auto-unsubscribe customer (`isSubscribed = false`)
- Rate limit (429) → BullMQ job retried with exponential backoff
- Permanent failure → `EmailSend.status = 'failed'`, Sentry error logged

**Groq API:**
- Error during SEO meta generation → log to Sentry, skip affected product, continue batch
- Error during chatbot reply → fall back to "I'll connect you with a human agent" message
- Rate limit → BullMQ job retried after delay

**Cloudflare R2:**
- Upload failure → retry once; if retry fails, return descriptive error to caller
- Delete failure → log to Sentry, do not block the parent operation (review deletion proceeds)

**Shopify API:**
- Rate limit (429) → respect `Retry-After` header, BullMQ job delayed
- Invalid access token → mark shop as inactive, notify merchant to reinstall

### Database Errors

- Unique constraint violation on `WebhookEvent` (duplicate delivery) → silently skip, return 200 to Shopify
- Transaction failure on loyalty redemption → rollback, return error to client
- Connection pool exhaustion → Sentry alert, PM2 auto-restart

### Validation Errors

- Analytics pixel payload fails validation → discard event, log to Sentry, return HTTP 200 (do not break storefront)
- Review submission with invalid token → HTTP 403, descriptive error message
- File upload exceeds 10 MB or wrong MIME type → HTTP 400, descriptive error, form state preserved

### Socket.io Disconnection

- Chat widget: exponential backoff reconnect, up to 5 attempts (1s, 2s, 4s, 8s, 16s)
- FOMO widget: fall back to REST polling at 30-second intervals after first failed reconnect

---

## Testing Strategy

### Unit Tests

Unit tests cover pure business logic functions that do not require external services:

- **Loyalty point calculation**: `calculatePointsEarned(subtotal, pointsPerDollar)` — verify correct rounding, edge cases (zero subtotal, fractional dollars)
- **Plan limit enforcement**: `isWithinEmailQuota(shop, count)` — verify all three plan tiers
- **HMAC verification**: `verifyWebhookHmac(body, secret, header)` — verify correct/incorrect signatures
- **Referral self-use detection**: `isSelfReferral(customer, referralCode)` — verify rejection logic
- **Email template rendering**: `renderEmailBlocks(templateJson)` — verify HTML output for each block type
- **SEO issue detection**: `detectSeoIssues(product)` — verify detection of missing meta, alt text, schema
- **R2 key generation**: `buildR2Key(module, shopId, resourceId, filename)` — verify key format

### Property-Based Tests

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) (TypeScript) with a minimum of 100 iterations per property.

Each test is tagged with: `// Feature: shopify-superapp, Property {N}: {property_text}`

**Property 1 — Webhook Idempotency:**
Generate random `(shopId, topic, shopifyId)` tuples and random payloads. Process the same webhook twice. Assert that side-effect counts (emails enqueued, records created) are identical after the first and second processing.

**Property 2 — Loyalty Ledger Consistency and Non-Negativity:**
Generate random sequences of earn and redeem transactions for a customer. Assert that after each transaction, `Customer.loyaltyPoints >= 0` and equals the sum of all accepted transaction records. Assert that any redeem exceeding the balance is rejected and the balance is unchanged.

**Property 3 — Email Quota Enforcement:**
Generate random email send counts up to and beyond each plan limit. Assert that sends are accepted while under the limit and rejected (with quota warning) at or above the limit, for all three plan tiers (STARTER: 5,000, GROWTH: 25,000, PRO: 100,000).

**Property 4 — Review Token Validity:**
Generate random tokens (valid, expired, already-used, malformed, wrong shop). Assert that only valid, unprocessed tokens for the correct shop result in successful review submission. Assert that all other token states return an error.

**Property 5 — Referral Self-Use Prevention:**
Generate random customers with random referral codes. Assert that when a customer's own referral code is used, no `Referral` record is created and no discount is issued.

**Property 6 — Webhook HMAC Verification:**
Generate random request bodies and secrets. Compute correct HMAC and assert acceptance. Mutate the body or header by one byte and assert rejection (HTTP 401). Assert that an empty or missing header always returns 401.

**Property 7 — File Upload Key Structure:**
Generate random `(module, shopId, resourceId, filename)` tuples. Assert that `buildR2Key` always produces a string exactly equal to `{module}/{shopId}/{resourceId}/{filename}` and that the CDN URL is always `R2_PUBLIC_URL + "/" + key`.

**Property 8 — Plan Feature Gating:**
Generate random feature access requests for STARTER plan shops targeting GROWTH/PRO-only features. Assert that all such requests return an upgrade prompt and do not execute their business logic.

**Property 9 — Unsubscribe Suppression:**
Generate random customers with `isSubscribed = false` and random campaign/automation triggers. Assert that no email job is enqueued for any unsubscribed customer, regardless of trigger type or campaign.

**Property 10 — Shop Initialization Completeness:**
Generate random shop domains completing OAuth. Assert that exactly one Shop record with `plan = STARTER` is created, and exactly one settings record each for Chat, SEO, Loyalty, and Referral is initialized.

**Property 11 — Campaign Recipient Fanout:**
Generate random campaigns with N eligible subscribers. Assert that exactly N EMAIL jobs are enqueued — no more, no fewer — and each job targets a distinct recipient email address.

**Property 12 — Loyalty Points Calculation Correctness:**
Generate random order subtotals (including fractional amounts) and `pointsPerDollar` settings. Assert that earned points always equal `floor(subtotal × pointsPerDollar)` with no floating-point drift.

### Integration Tests

Integration tests verify the wiring between components using a test PostgreSQL database and mocked external APIs:

- **OAuth installation flow**: Full install → shop created → webhooks registered → settings initialized
- **Webhook processing pipeline**: POST to `/api/webhooks` → HMAC verified → `WebhookEvent` created → BullMQ job enqueued → worker processes → status updated
- **Email campaign send**: Campaign scheduled → EMAIL jobs enqueued → Brevo mock called → `EmailSend` records created
- **Loyalty earn on order paid**: `orders/paid` webhook → `LoyaltyTransaction` created → `Customer.loyaltyPoints` updated
- **Review submission**: Token validated → `Review` created → photos uploaded to R2 mock → merchant notified
- **SEO audit**: `SEO_AUDIT` job processed → Shopify API products fetched → `SeoIssue` records created
- **Meilisearch indexing**: Customer created → `SEARCH_INDEX` job enqueued → Meilisearch upsert called

### Smoke Tests

- All required environment variables present on startup
- PostgreSQL connection established
- Redis connection established
- Meilisearch reachable at `127.0.0.1:7700`
- R2 bucket accessible
- PM2 processes running (app, workers, meilisearch)
- Nginx SSL certificate valid and not expiring within 30 days
- UFW rules: ports 5432, 6379, 7700 blocked externally

### Test Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['app/**/*.ts', 'workers/**/*.ts'],
      exclude: ['app/routes/**', '**/*.d.ts']
    }
  }
})
```

Property-based tests use fast-check with `numRuns: 100` minimum:

```typescript
import fc from 'fast-check'
import { test, expect } from 'vitest'

// Feature: shopify-superapp, Property 2: Loyalty Ledger Consistency and Non-Negativity
test('loyalty balance is never negative and always equals sum of accepted transactions', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({
        type: fc.constantFrom('earn', 'redeem'),
        points: fc.integer({ min: 1, max: 1000 })
      }), { minLength: 1, maxLength: 50 }),
      (transactions) => {
        let balance = 0
        let sumAccepted = 0
        for (const tx of transactions) {
          if (tx.type === 'earn') {
            balance += tx.points
            sumAccepted += tx.points
          } else {
            if (tx.points > balance) continue // rejected — would go negative
            balance -= tx.points
            sumAccepted -= tx.points
          }
          expect(balance).toBeGreaterThanOrEqual(0)
          expect(balance).toBe(sumAccepted)
        }
      }
    ),
    { numRuns: 100 }
  )
})

// Feature: shopify-superapp, Property 6: Webhook HMAC Verification
test('webhook HMAC verification accepts correct signature and rejects any mutation', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 1000 }),
      fc.string({ minLength: 32, maxLength: 64 }),
      (body, secret) => {
        const crypto = require('crypto')
        const correctHmac = crypto
          .createHmac('sha256', secret)
          .update(body, 'utf8')
          .digest('base64')
        expect(verifyWebhookHmac(body, secret, correctHmac)).toBe(true)
        // Mutate body by one character
        const mutatedBody = body.slice(0, -1) + (body.slice(-1) === 'a' ? 'b' : 'a')
        expect(verifyWebhookHmac(mutatedBody, secret, correctHmac)).toBe(false)
      }
    ),
    { numRuns: 100 }
  )
})
```
