# Implementation Plan: Shopify Super-App (Nexify)

## Overview

This plan breaks the Nexify Shopify Super-App into incremental coding tasks organized by module. Each task builds on previous tasks, starting with infrastructure and core services, then layering feature modules on top. Property-based tests (fast-check) validate the 12 correctness properties defined in the design. All code is TypeScript on Remix (Node.js) with Prisma, Redis/BullMQ, Socket.io, Meilisearch, and Cloudflare R2.

## Tasks

- [x] 1. Project scaffolding, Prisma schema, and server-side clients
  - [x] 1.1 Initialize Remix project with Shopify CLI and configure directory layout
    - Scaffold the Remix app using `@shopify/cli`
    - Create top-level directories: `app/routes/`, `workers/`, `extensions/`, `prisma/`, `tests/`
    - Add `.env.example` with all required environment variables (no secret values)
    - Add startup validation in `app/env.server.ts` that checks all required env vars and exits with a descriptive error if any are missing
    - Configure `vitest.config.ts` with node environment, globals, setup file, and v8 coverage
    - Install dependencies: `prisma`, `@prisma/client`, `ioredis`, `bullmq`, `meilisearch`, `@aws-sdk/client-s3`, `socket.io`, `fast-check`, `vitest`
    - _Requirements: 3.1, 3.5, 3.6, 3.7_

  - [x] 1.2 Define the complete Prisma schema
    - Create `prisma/schema.prisma` with all models: Shop, Session, Customer, Review, ReviewRequest, Campaign, Automation, EmailSend, LoyaltyProgram, LoyaltyTransaction, ReferralProgram, Referral, Upsell, ChatSettings, ChatConversation, ChatMessage, AnalyticsEvent, AnalyticsDailySummary, SeoSettings, SeoIssue, WebhookEvent
    - Define enums: Plan (STARTER, GROWTH, PRO), WebhookStatus, ReviewStatus, ReferralStatus, ChatSender, SeoIssueSeverity
    - Add composite unique constraints: `WebhookEvent(shopId, topic, shopifyId)`, `Customer(shopId, shopifyId)`
    - Add indexes on foreign keys and frequently queried fields
    - Generate initial migration with `prisma migrate dev`
    - _Requirements: 3.2_

  - [x] 1.3 Create server-side singleton clients
    - Implement `app/db.server.ts` — singleton PrismaClient with dev-mode global caching
    - Implement `app/redis.server.ts` — singleton ioredis client connecting to `127.0.0.1:6379`
    - Implement `app/meilisearch.server.ts` — singleton Meilisearch client at `http://127.0.0.1:7700` with `customers` and `products` index configuration
    - Implement `app/r2.server.ts` — S3-compatible client for Cloudflare R2 with `uploadFile`, `deleteFile`, and `deleteFolder` functions
    - Implement `app/ai.server.ts` — Groq SDK wrapper with `chatbotReply`, `generateSeoMeta`, `generateAltText`, and `analyzeReviewSentiment` functions
    - _Requirements: 3.3, 14.1, 14.2, 14.3, 15.1, 15.6_

  - [x] 1.4 Create PM2 ecosystem config and BullMQ worker entry point
    - Create `ecosystem.config.js` with 3 apps: Remix cluster (2 instances), BullMQ worker (1 instance), Meilisearch
    - Create `workers/index.ts` that initializes 7 BullMQ queues: EMAIL, SMS, WEBHOOK, REVIEW_REQUEST, SEO_AUDIT, ANALYTICS, SEARCH_INDEX
    - Define queue configuration with concurrency and retry settings per the design table
    - _Requirements: 3.4, 3.5_

  - [x] 1.5 Scaffold Theme App Extension placeholders
    - Create `extensions/review-widget/` with placeholder Liquid and JS files
    - Create `extensions/upsell-widget/` with placeholder Liquid and JS files
    - Create `extensions/fomo-widget/` with placeholder Liquid and JS files
    - Create `extensions/chat-widget/` with placeholder Liquid and JS files
    - Create `extensions/loyalty-widget/` with placeholder Liquid and JS files
    - _Requirements: 3.8_


- [x] 2. Shopify OAuth, session management, and app installation
  - [x] 2.1 Configure Shopify app authentication
    - Implement `app/shopify.server.ts` using `@shopify/shopify-app-remix` with Prisma session adapter
    - Configure `authenticate.admin`, `authenticate.webhook`, and `authenticate.public.appProxy`
    - Set up offline access token mode for background API calls
    - Define required API scopes for all modules
    - _Requirements: 1.1, 1.2, 1.6, 1.9_

  - [x] 2.2 Implement OAuth callback and shop initialization
    - Create `/auth/callback` route that exchanges authorization code for access token
    - On first-time install: create Shop record with `plan = STARTER`
    - Register all required webhooks from the manifest (orders/create, orders/updated, orders/fulfilled, orders/paid, customers/create, customers/update, checkouts/create, checkouts/update, products/create, products/update, products/delete, app/uninstalled)
    - Initialize default settings records for Chat, SEO, Loyalty, and Referral modules
    - Handle OAuth error parameter with descriptive error message and retry link
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

  - [ ]* 2.3 Write property test for shop initialization completeness
    - **Property 10: Shop Initialization Completeness**
    - Generate random shop domains completing OAuth. Assert that exactly one Shop record with `plan = STARTER` is created, and exactly one settings record each for Chat, SEO, Loyalty, and Referral is initialized.
    - **Validates: Requirements 1.3, 1.5**

  - [x] 2.4 Implement app/uninstalled webhook handler
    - On `app/uninstalled` webhook: mark Shop as inactive (`isActive = false`), revoke stored access token
    - Soft-delete only — never hard-delete Shop records
    - _Requirements: 1.8_

- [x] 3. Subscription billing and plan feature gating
  - [x] 3.1 Implement billing page and Shopify charge creation
    - Create `/app/billing` route displaying three plans with feature comparison
    - Implement plan selection: create Shopify recurring application charge via Billing API, redirect to Shopify approval URL
    - Handle charge approval callback: update Shop's plan field, activate feature set
    - Handle charge decline/cancellation: retain previous plan, notify Merchant
    - Implement plan upgrade: cancel existing charge, create new charge for higher tier
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_

  - [x] 3.2 Implement plan limits and feature gating middleware
    - Create `app/utils/plan-limits.server.ts` with plan limit constants (emails, WhatsApp, AI conversations per tier)
    - Implement `isWithinEmailQuota(shop, count)` function that checks monthly send count against plan limit
    - Implement `isWithinWhatsAppQuota(shop, count)` and `isWithinAIQuota(shop, count)` similarly
    - Implement `requirePlan(shop, minimumPlan)` middleware that returns upgrade prompt for insufficient plans
    - Wire gating into all GROWTH/PRO-only feature routes
    - _Requirements: 2.4, 2.8, 2.9, 2.10_

  - [ ]* 3.3 Write property test for plan feature gating
    - **Property 8: Plan Feature Gating**
    - Generate random feature access requests for STARTER plan shops targeting GROWTH/PRO-only features. Assert that all such requests return an upgrade prompt and do not execute business logic.
    - **Validates: Requirements 2.4, 4.11, 6.9, 8.9, 10.7**

  - [ ]* 3.4 Write property test for email quota enforcement
    - **Property 3: Email Quota Enforcement**
    - Generate random email send counts up to and beyond each plan limit. Assert sends are accepted while under the limit and rejected at or above the limit for all three tiers (STARTER: 5,000, GROWTH: 25,000, PRO: 100,000).
    - **Validates: Requirements 2.8, 2.9, 2.10, 7.13**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


- [x] 5. Webhook processing pipeline
  - [x] 5.1 Implement webhook receiver route and HMAC verification
    - Create `/api/webhooks` POST route
    - Implement HMAC-SHA256 verification using `authenticate.webhook(request)` — return HTTP 401 on failure
    - On valid webhook: create `WebhookEvent` record with status `pending`, enqueue WEBHOOK job in BullMQ
    - Return HTTP 200 within 5 seconds, deferring all processing to the queue
    - _Requirements: 13.1, 13.2, 13.3, 13.8_

  - [x] 5.2 Implement webhook worker with idempotency
    - Create `workers/webhook.worker.ts` with concurrency 10 and 3× exponential backoff retry
    - Before processing: check if `WebhookEvent` with same `(shopId, topic, shopifyId)` already has status `processed` — skip if so
    - On success: update `WebhookEvent.status = 'processed'`, set `processedAt`
    - On failure: update `WebhookEvent.status = 'failed'`, store error message, allow BullMQ retry
    - After 3 failures: move to dead-letter queue, fire Sentry alert
    - Route webhook topics to appropriate module handlers (orders → loyalty/analytics/fomo, customers → search/email, products → search/seo, checkouts → email, app/uninstalled → shop)
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.7_

  - [ ]* 5.3 Write property test for webhook idempotency
    - **Property 1: Webhook Idempotency**
    - Generate random `(shopId, topic, shopifyId)` tuples and random payloads. Process the same webhook twice. Assert that side-effect counts are identical after first and second processing.
    - **Validates: Requirements 13.4**

  - [ ]* 5.4 Write property test for webhook HMAC verification
    - **Property 6: Webhook HMAC Verification**
    - Generate random request bodies and secrets. Compute correct HMAC and assert acceptance. Mutate body or header by one byte and assert rejection (HTTP 401). Assert empty/missing header always returns 401.
    - **Validates: Requirements 13.1, 13.2**

- [x] 6. File storage (R2) module
  - [x] 6.1 Implement R2 upload, delete, and key generation utilities
    - Implement `buildR2Key(module, shopId, resourceId, filename)` returning `{module}/{shopId}/{resourceId}/{filename}`
    - Implement `buildCdnUrl(key)` returning `{R2_PUBLIC_URL}/{key}`
    - Implement upload with retry-once logic on failure
    - Implement delete with Sentry logging on failure (non-blocking)
    - Implement `deleteFolder(prefix)` for batch deletion by prefix
    - Add file size validation (max 10 MB) and MIME type validation (JPEG, PNG, WebP, GIF)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [ ]* 6.2 Write property test for file upload key structure
    - **Property 7: File Upload Key Structure**
    - Generate random `(module, shopId, resourceId, filename)` tuples. Assert `buildR2Key` produces exactly `{module}/{shopId}/{resourceId}/{filename}` and CDN URL is `R2_PUBLIC_URL + "/" + key`.
    - **Validates: Requirements 14.2, 14.3**

- [x] 7. Reviews module
  - [x] 7.1 Implement review request scheduling and email sending
    - In webhook worker: on `orders/fulfilled`, enqueue REVIEW_REQUEST job with configurable delay (default 7 days)
    - Create `workers/review.worker.ts` with concurrency 3 and 3× exponential backoff
    - Worker sends review request email via Brevo with unique tokenized review submission link
    - Create `ReviewRequest` record tracking lifecycle: pending → sent → opened → reviewed
    - _Requirements: 4.1, 4.2_

  - [x] 7.2 Implement review submission API
    - Create `/api/reviews` POST route
    - Validate token: check it corresponds to a valid, unprocessed `ReviewRequest` for the correct shop
    - Accept rating (1–5), optional title, optional body, up to 5 photo attachments
    - Upload photos to R2 under `reviews/{shopId}/{reviewId}/{filename}`, store CDN URLs in Review record
    - Mark review as pending approval, notify Merchant via dashboard
    - Handle photo upload failure: return descriptive error, preserve other form data
    - _Requirements: 4.3, 4.4, 4.5, 4.12_

  - [ ]* 7.3 Write property test for review token validity
    - **Property 4: Review Token Validity**
    - Generate random tokens (valid, expired, already-used, malformed, wrong shop). Assert only valid, unprocessed tokens for the correct shop succeed. All other token states return error.
    - **Validates: Requirements 4.3**

  - [x] 7.4 Implement review moderation dashboard
    - Create `/app/reviews` route with moderation dashboard: view, approve, reject, respond to reviews
    - On approve: set `isPublished = true`
    - On delete: delete associated R2 photos via `deleteFolder`
    - Implement helpful count increment endpoint
    - For GROWTH/PRO plans: call `analyzeReviewSentiment` via Groq API and store result on Review record
    - _Requirements: 4.6, 4.7, 4.10, 4.11_

  - [x] 7.5 Implement review-widget Theme App Extension
    - Build `extensions/review-widget/` Liquid + JS extension for product pages
    - Display approved reviews: star rating, reviewer name, verified purchase badge, body, photo thumbnails
    - Render aggregate star rating and total review count at top of section
    - _Requirements: 4.8, 4.9_


- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. FOMO and social proof popups
  - [x] 9.1 Integrate Socket.io server into Remix entry point
    - Attach Socket.io server to the Remix HTTP server
    - Configure rooms namespaced by shopId: `shop:{shopId}` (merchant inbox), `storefront:{shopId}` (storefront widgets)
    - Implement storefront authentication via `shopId` query parameter and merchant authentication via signed session token
    - Configure Nginx WebSocket upgrade headers for `/socket.io/` path
    - _Requirements: 5.1, 5.2, 16.10_

  - [x] 9.2 Implement FOMO event publishing and settings
    - In webhook worker: on `orders/create`, publish FOMO event to `storefront:{shopId}` Socket.io room with buyer first name (or "Someone"), product title, and timestamp
    - Create `/app/fomo` settings route: configure popup position (bottom-left, bottom-right), display duration, historical order display toggle
    - Implement historical order fallback: cycle through recent orders from past 48 hours at configurable interval when no real-time orders
    - _Requirements: 5.1, 5.5, 5.6_

  - [x] 9.3 Implement fomo-widget Theme App Extension
    - Build `extensions/fomo-widget/` Liquid + JS extension
    - Connect to Socket.io server, display popup on FOMO event with buyer name, product title, relative timestamp
    - Auto-dismiss after configurable duration (default 5 seconds)
    - On product pages: filter to show only events for the currently viewed product
    - Implement Socket.io fallback: poll REST API at 30-second intervals on connection failure
    - _Requirements: 5.2, 5.3, 5.4, 5.7, 5.8_

- [x] 10. Upsell widgets
  - [x] 10.1 Implement upsell CRUD and editor
    - Create `/app/upsells` route with upsell management dashboard
    - Implement upsell editor: select product, set discount percentage, write headline, preview widget
    - Support four placement types: `post_purchase`, `cart`, `product_page`, `thank_you`
    - Display performance metrics: impression count, conversion rate, revenue generated
    - For GROWTH/PRO: support multiple active offers and A/B testing with per-variant tracking
    - _Requirements: 6.1, 6.5, 6.8, 6.9_

  - [x] 10.2 Implement upsell-widget Theme App Extension
    - Build `extensions/upsell-widget/` Liquid + JS extension
    - Post-purchase: display upsell offer on thank-you page
    - Cart: display sticky add-to-cart bar with complementary product
    - On upsell display: increment `impressions` counter
    - On upsell accept: add product to order via Shopify Orders API (no re-enter payment), increment `conversions`, add revenue
    - _Requirements: 6.2, 6.3, 6.4, 6.6, 6.7_

- [x] 11. Email marketing module
  - [x] 11.1 Implement block-based email template editor
    - Create `/app/email/templates` route with block-based editor
    - Support block types: text, image, button, divider, product
    - On save: render block JSON into valid HTML email, cache in `templateHtml` field
    - _Requirements: 7.1, 7.2_

  - [x] 11.2 Implement campaign scheduling and email worker
    - Create `/app/email/campaigns` route for campaign management
    - On schedule: enqueue one EMAIL job per eligible recipient in BullMQ EMAIL queue at scheduled time
    - Check email quota before enqueuing — reject if plan limit reached, display quota warning
    - Create `workers/email.worker.ts` with concurrency 5 and 3× exponential backoff
    - Worker sends email via Brevo API, records Brevo message ID in `EmailSend` record
    - Display campaign analytics: recipient count, open rate, click rate, attributed revenue
    - _Requirements: 7.3, 7.4, 7.13, 7.14_

  - [ ]* 11.3 Write property test for campaign recipient fanout
    - **Property 11: Campaign Recipient Fanout**
    - Generate random campaigns with N eligible subscribers. Assert exactly N EMAIL jobs are enqueued, no more, no fewer, and each job targets a distinct recipient email.
    - **Validates: Requirements 7.3**

  - [x] 11.4 Implement email tracking (opens and clicks)
    - Create `/api/tracking` GET route for open pixel and click redirect
    - Embed 1×1 tracking pixel in emails for open tracking
    - Wrap links with redirect through tracking endpoint for click tracking
    - On open/click event: update `openedAt`/`clickedAt` on EmailSend, increment Campaign `openCount`/`clickCount`
    - _Requirements: 7.5, 7.6_

  - [x] 11.5 Implement email automations
    - Create `/app/email/automations` route for automation management
    - Implement triggers: `abandoned_cart`, `welcome`, `post_purchase`, `win_back`, `birthday`
    - In webhook worker: on `checkouts/update` with abandoned checkout, enqueue abandoned cart email after configured delay
    - In webhook worker: on `customers/create` with active welcome automation, enqueue welcome email
    - _Requirements: 7.7, 7.8, 7.9_

  - [x] 11.6 Implement subscriber management and unsubscribe
    - Create `/app/email/subscribers` route with subscriber list, search, filter by opt-in status
    - Implement unsubscribe link handler: set `isSubscribed = false` on Customer record
    - On Brevo bounce/spam complaint: auto-set `isSubscribed = false`
    - Implement suppression check: never enqueue marketing email for `isSubscribed = false` customers
    - _Requirements: 7.10, 7.11, 7.12_

  - [ ]* 11.7 Write property test for unsubscribe suppression
    - **Property 9: Unsubscribe Suppression**
    - Generate random customers with `isSubscribed = false` and random campaign/automation triggers. Assert no email job is enqueued for any unsubscribed customer regardless of trigger type.
    - **Validates: Requirements 7.11, 7.12**


- [x] 12. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Loyalty program
  - [x] 13.1 Implement loyalty program setup and point earning
    - Create `/app/loyalty` route for loyalty program management
    - On activation: create `LoyaltyProgram` record with configurable `pointsPerDollar`, `pointsForSignup`, `pointsForReview`, `pointsForReferral`
    - Implement `calculatePointsEarned(subtotal, pointsPerDollar)` returning `floor(subtotal × pointsPerDollar)`
    - In webhook worker: on `orders/paid`, calculate points and create `LoyaltyTransaction` of type `earn`
    - On approved review submission: create `LoyaltyTransaction` of type `earn` with `pointsForReview`
    - On new customer account creation: create `LoyaltyTransaction` of type `earn` with `pointsForSignup`
    - Update `Customer.loyaltyPoints` and `Customer.loyaltyTier` on every balance change
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.10_

  - [ ]* 13.2 Write property test for loyalty points calculation correctness
    - **Property 12: Loyalty Points Calculation Correctness**
    - Generate random order subtotals (including fractional amounts) and `pointsPerDollar` settings. Assert earned points always equal `floor(subtotal × pointsPerDollar)` with no floating-point drift.
    - **Validates: Requirements 8.2**

  - [x] 13.3 Implement loyalty point redemption
    - Implement redemption endpoint: validate balance is sufficient, create Shopify discount code via Discount API with value `points × rewardValue`
    - Create `LoyaltyTransaction` of type `redeem` (negative points)
    - Reject redemption if it would result in negative balance — return error message
    - Update `Customer.loyaltyPoints` transactionally
    - _Requirements: 8.5, 8.6, 8.11_

  - [ ]* 13.4 Write property test for loyalty ledger consistency and non-negativity
    - **Property 2: Loyalty Ledger Consistency and Non-Negativity**
    - Generate random sequences of earn and redeem transactions. Assert `Customer.loyaltyPoints >= 0` after each transaction and equals sum of all accepted transaction records. Assert any redeem exceeding balance is rejected.
    - **Validates: Requirements 8.6, 8.10, 8.11**

  - [x] 13.5 Implement loyalty dashboard and widget
    - Create loyalty dashboard showing total points issued, total redeemed, top earners, program ROI
    - For GROWTH/PRO: implement VIP tiers from `LoyaltyProgram.tiers` JSON, auto-assign customers based on cumulative balance
    - Build `extensions/loyalty-widget/` displaying customer point balance and available reward value on storefront
    - _Requirements: 8.7, 8.8, 8.9_

- [ ] 14. Live chat and AI chatbot
  - [ ] 14.1 Implement chat conversation and message handling
    - Create `/app/chat` route for merchant chat inbox dashboard
    - On visitor chat initiation: create `ChatConversation` record, assign unique `visitorId`
    - Store messages as `ChatMessage` records with `sender` field (`customer`, `agent`, `ai`)
    - Broadcast customer messages to merchant inbox via Socket.io `shop:{shopId}` room
    - Deliver agent replies to visitor via Socket.io `storefront:{shopId}` room
    - Implement conversation resolution: set status to `resolved`, record `resolvedAt`
    - _Requirements: 9.1, 9.3, 9.4, 9.8, 9.9_

  - [ ] 14.2 Implement AI chatbot auto-response
    - When no agent responds within 30 seconds and AI chatbot is enabled: call `chatbotReply` via Groq API
    - Provide system prompt with shop name and product titles as context
    - Store AI response as `ChatMessage` with `sender = 'ai'`, deliver via Socket.io
    - On Groq API error: fall back to "I'll connect you with a human agent" message
    - Enforce plan AI conversation limits — disable auto-responses when limit reached, notify merchant
    - _Requirements: 9.5, 9.6, 9.7, 9.11_

  - [ ] 14.3 Implement chat-widget Theme App Extension
    - Build `extensions/chat-widget/` Liquid + JS extension
    - Establish Socket.io connection for real-time message exchange
    - Implement exponential backoff reconnect (1s, 2s, 4s, 8s, 16s) up to 5 attempts on disconnect
    - _Requirements: 9.2, 9.10_

  - [ ] 14.4 Implement chat settings
    - Create `/app/chat/settings` route for widget customization
    - Allow merchant to configure widget color, welcome message, and AI personality
    - _Requirements: 9.12_

- [-] 15. Analytics dashboard
  - [x] 15.1 Implement analytics pixel and event ingestion
    - Create first-party JavaScript pixel for storefront embedding via Shopify Script Tag
    - Pixel sends `page_view` events to `/api/pixel` with session ID, visitor ID, page URL, UTM params, user agent
    - Pixel sends `add_to_cart` events with product ID and variant ID
    - Pixel uses first-party session identifier in localStorage — no third-party cookies
    - Create `/api/pixel` POST route: validate payload, discard invalid events (log to Sentry, return HTTP 200)
    - In webhook worker: on `orders/paid`, record `purchase` AnalyticsEvent with order ID, revenue, UTM attribution
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.9, 10.10_

  - [x] 15.2 Implement analytics aggregation worker and dashboard
    - Create `workers/analytics.worker.ts` with concurrency 1 — nightly aggregation of raw `AnalyticsEvent` into `AnalyticsDailySummary`
    - Create `/app/analytics` route with main dashboard: total revenue, total orders, AOV, unique visitors for selectable date range
    - Display channel attribution report: revenue and order count by UTM source/medium
    - For GROWTH/PRO: display customer LTV report and cohort retention chart
    - _Requirements: 10.5, 10.6, 10.7, 10.8_


- [ ] 16. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Referral program
  - [x] 17.1 Implement referral program setup and code generation
    - Create `/app/referrals` route for referral program management
    - On activation: generate unique referral code for each existing Customer, store in `Customer.referralCode`
    - On new customer creation: generate and assign unique referral code
    - _Requirements: 11.1, 11.2_

  - [x] 17.2 Implement referral link handling and lifecycle
    - Create `/api/referral` GET route for referral link handler
    - On referral link visit: create `Referral` record with status `pending`, store referral code in visitor session
    - Validate self-referral: reject if customer uses their own referral code, display error
    - On referred visitor account creation: update Referral status to `signed_up`, link Customer record
    - On referred customer first purchase: update status to `purchased`, create Shopify discount code for advocate, apply friend discount
    - On reward issued: create `LoyaltyTransaction` of type `earn` with `pointsForReferral` for referring customer
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.9_

  - [ ]* 17.3 Write property test for referral self-use prevention
    - **Property 5: Referral Self-Use Prevention**
    - Generate random customers with random referral codes. Assert that when a customer's own referral code is used, no Referral record is created and no discount is issued.
    - **Validates: Requirements 11.9**

  - [x] 17.4 Implement referral dashboard and storefront sharing
    - Create referral dashboard: total referrals, conversion rate, total attributed revenue
    - Add shareable referral link and social sharing buttons (copy link, email, WhatsApp) to loyalty-widget
    - _Requirements: 11.7, 11.8_

- [x] 18. SEO module
  - [x] 18.1 Implement SEO audit worker and issue detection
    - Create `workers/seo.worker.ts` with concurrency 1 and 2× exponential backoff
    - On SEO_AUDIT job: fetch all products/pages via Shopify API, check for missing meta titles, meta descriptions, image alt text, structured data
    - Create `SeoIssue` records with type, severity (critical, warning, info), resource URL, description
    - On Groq API error during generation: log to Sentry, skip affected product, continue batch
    - _Requirements: 12.1, 12.2, 12.3, 12.10_

  - [x] 18.2 Implement SEO dashboard and auto-fix features
    - Create `/app/seo` route with audit dashboard: overall score, issues by severity, individual issues with fix recommendations
    - Implement auto meta tags: use Groq API to generate SEO-optimized meta title and description, update via Shopify Products API
    - Implement auto alt text: use Groq API to generate descriptive alt text, update via Shopify Products API
    - Implement auto schema: inject Product schema.org JSON-LD via Shopify Script Tag
    - Mark resolved issues with `isFixed = true`
    - _Requirements: 12.4, 12.5, 12.6, 12.7, 12.9_

  - [x] 18.3 Implement SEO webhook triggers
    - In webhook worker: on `products/create` or `products/update`, enqueue targeted SEO check for that product
    - _Requirements: 12.8_

- [x] 19. Search and indexing module
  - [x] 19.1 Implement Meilisearch indexing worker
    - Create `workers/search.worker.ts` with concurrency 5 and 3× exponential backoff
    - On SEARCH_INDEX job (upsert): upsert Customer document in `customers` index or product document in `products` index
    - On SEARCH_INDEX job (delete): remove product document from `products` index
    - Wire into webhook worker: on `customers/create`/`customers/update` → enqueue customer upsert; on `products/create`/`products/update` → enqueue product upsert; on `products/delete` → enqueue product delete
    - _Requirements: 15.2, 15.3, 15.4_

  - [x] 19.2 Implement dashboard search API
    - Create search endpoint for merchant dashboard that queries Meilisearch
    - Configure searchable attributes: customers (email, firstName, lastName, phone), products (title, vendor, productType, tags)
    - Ensure Meilisearch listens only on `127.0.0.1:7700` — not exposed publicly
    - _Requirements: 15.1, 15.5, 15.6_

- [x] 20. Security and infrastructure configuration
  - [x] 20.1 Configure Nginx reverse proxy and SSL
    - Create Nginx configuration: reverse proxy to `127.0.0.1:3000`, SSL termination with Let's Encrypt
    - Configure HTTP → HTTPS redirect
    - Configure WebSocket upgrade headers for `/socket.io/` path
    - _Requirements: 16.1, 16.9, 16.10_

  - [x] 20.2 Configure UFW firewall and security hardening
    - Configure UFW: allow SSH (22), Nginx Full (80, 443); block PostgreSQL (5432), Redis (6379), Meilisearch (7700)
    - Validate all secrets in environment variables, not in version control
    - Ensure parameterized queries via Prisma for all DB operations
    - Implement input validation and sanitization for all user-supplied input
    - Ensure session secret is at least 32 characters, Meilisearch master key at least 16 characters
    - _Requirements: 16.2, 16.3, 16.4, 16.5, 16.11, 16.12_

  - [x] 20.3 Configure PM2 cluster mode and error monitoring
    - Verify PM2 cluster mode with 2 instances for zero-downtime restarts
    - Configure PM2 auto-restart on crash within 5 seconds
    - Integrate Sentry for unhandled exceptions in both Remix app and BullMQ workers
    - _Requirements: 16.6, 16.7, 16.8_

- [ ] 21. Integration wiring and final verification
  - [x] 21.1 Wire all webhook topic handlers end-to-end
    - Verify webhook worker routes all topics to correct module handlers:
      - `orders/create` → FOMO event + analytics
      - `orders/paid` → loyalty earn + analytics purchase event
      - `orders/fulfilled` → review request scheduling
      - `customers/create` → welcome email + search index + referral code generation + loyalty signup bonus
      - `customers/update` → search index update
      - `checkouts/update` → abandoned cart email
      - `products/create`/`products/update` → search index + SEO check
      - `products/delete` → search index removal
      - `app/uninstalled` → shop deactivation
    - _Requirements: 13.7_

  - [x] 21.2 Wire cross-module integrations
    - Connect review approval → loyalty points earn
    - Connect referral purchase → loyalty points earn + discount code creation
    - Connect email sends → quota tracking across campaigns and automations
    - Verify plan gating is enforced on all GROWTH/PRO features: review sentiment (4.11), A/B upsells (6.9), VIP tiers (8.9), LTV report (10.7)
    - _Requirements: 8.3, 11.6, 2.4_

  - [ ]* 21.3 Write integration tests for critical flows
    - Test OAuth installation flow end-to-end: install → shop created → webhooks registered → settings initialized
    - Test webhook processing pipeline: POST → HMAC verify → WebhookEvent → BullMQ → worker → status updated
    - Test email campaign send: schedule → EMAIL jobs enqueued → Brevo mock → EmailSend records
    - Test loyalty earn on order paid: webhook → LoyaltyTransaction → Customer.loyaltyPoints updated
    - Test review submission: token validated → Review created → R2 upload → merchant notified
    - _Requirements: 1.1–1.5, 13.1–13.5, 7.3–7.4, 8.2, 4.3–4.5_

- [x] 22. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at natural module boundaries
- Property-based tests use fast-check with minimum 100 iterations per property, validating the 12 correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code is TypeScript targeting Remix (Node.js) with Prisma, Redis/BullMQ, Socket.io, Meilisearch, and Cloudflare R2
