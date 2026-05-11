# Nexify — Project Overview

**Nexify** is an all-in-one Shopify Super-App that consolidates 8 essential merchant tools into a single platform. Built on Remix (Node.js), PostgreSQL 16, Redis 7 + BullMQ, Socket.io, Meilisearch, and Cloudflare R2. Hosted on a single Hostinger KVM 2 VPS ($7/mo).

**Target:** Shopify merchants doing $10K–$500K/year who want to reduce app subscription costs and eliminate data silos.

**Pricing:** $29/mo Starter · $79/mo Growth · $149/mo Pro (billed via Shopify Billing API, 20% rev share to Shopify)

**Test coverage:** 280 tests across 23 files, all passing.

---

## Table of Contents

1. [Product Reviews](#1-product-reviews)
2. [FOMO Social Proof Popups](#2-fomo-social-proof-popups)
3. [Upsell Widgets](#3-upsell-widgets)
4. [Email Marketing + Abandoned Cart](#4-email-marketing--abandoned-cart)
5. [Loyalty Program](#5-loyalty-program)
6. [SEO Automation](#6-seo-automation)
7. [Analytics Dashboard](#7-analytics-dashboard)
8. [Referral Program](#8-referral-program)
9. [Infrastructure](#infrastructure)
10. [Database Schema](#database-schema)

---

## 1. Product Reviews

Automated review collection with photo uploads, moderation dashboard, and optional AI sentiment analysis.

### How It Works (Step by Step)

1. **Trigger:** Shopify sends an `orders/fulfilled` webhook when a merchant fulfills an order.
2. **Schedule:** The webhook worker creates a `ReviewRequest` record (status `pending`) and enqueues a delayed BullMQ job with a 7-day delay.
3. **Send:** After 7 days, the review worker wakes up, generates a tokenized review link (`/api/reviews?token={cuid}`), and sends it via Brevo email API. Status → `sent`.
4. **Submit:** Customer clicks the link, fills out rating (1–5) + title + body + up to 5 photos on a form.
5. **Validate:** The `/api/reviews` endpoint checks the token against the `ReviewRequest` record. Rejects invalid, expired, already-used, or wrong-shop tokens.
6. **Store:** Photos upload to Cloudflare R2 under key `reviews/{shopId}/{reviewId}/{filename}`. URLs stored in `Review.photos` array. Status → `reviewed`.
7. **Moderate:** Merchant sees the new review in the moderation dashboard (unapproved by default). Clicks Approve → `isPublished = true`.
8. **Display:** Storefront review-widget fetches approved reviews via `/api/reviews/public?shopId=X&productId=Y` and renders them on product pages.
9. **AI Analysis (GROWTH/PRO):** Merchant can optionally run sentiment analysis — Groq API (Llama 3) classifies review text as positive/neutral/negative.

### Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `Review` and `ReviewRequest` models |
| `workers/webhook.worker.ts` | `handleOrderFulfilled` — schedules the request |
| `workers/review.worker.ts` | Processes delayed job, sends email via Brevo |
| `app/utils/brevo.server.ts` | Brevo transactional email wrapper |
| `app/routes/api.reviews.tsx` | POST endpoint for review submission with token validation |
| `app/routes/api.reviews.helpful.tsx` | POST endpoint to increment helpful count |
| `app/routes/api.reviews.public.tsx` | GET endpoint for storefront widget (published reviews only) |
| `app/routes/app.reviews._index.tsx` | Merchant moderation dashboard |
| `app/r2.server.ts` | R2 photo upload + validation |
| `extensions/review-widget/blocks/review-widget.liquid` | Storefront markup + CSS |
| `extensions/review-widget/assets/review-widget.js` | Fetches + renders reviews, lightbox, helpful votes |

### What the Merchant Sees

A moderation dashboard at `/app/reviews` showing:

- Review cards with star rating, reviewer name, product, date, status badge (Pending/Approved/Published)
- Body text, photo thumbnails, helpful vote count, verified purchase badge
- Action buttons: Approve, Reject, Delete, Analyze Sentiment (GROWTH/PRO)
- Pagination (20 per page)

### What the Customer Sees

On product pages, a reviews section with:

- Aggregate star rating (e.g., "4.5 ★★★★½") and total count ("Based on 27 reviews")
- Individual review cards: stars, reviewer name (first + last initial), verified badge, date (relative like "3 days ago")
- Review title, body, photo thumbnails (click to open lightbox)
- "Was this helpful?" button (localStorage tracks votes to prevent duplicates)
- Pagination, responsive layout

Review request emails land in their inbox 7 days after fulfillment with a big "Write a Review" button.

### External APIs

- **Brevo** (`api.brevo.com/v3/smtp/email`) — sends review request emails
- **Cloudflare R2** (S3-compatible) — stores review photos
- **Groq API** (Llama 3.3 70B) — sentiment analysis for GROWTH/PRO plans

### Limitations

- 7-day delay is hardcoded (would need a setting to configure per shop)
- Max 5 photos per review, 10MB each, JPEG/PNG/WebP/GIF only
- No video support yet (schema has the field but upload path isn't wired)
- No reply-to-review feature for merchants
- Review request emails use a simple HTML template — no merchant customization yet
- Sentiment analysis is one-review-at-a-time on demand, not batch
- Widget renders via client-side fetch (no SSR for SEO of review content itself — aggregate rating could be added to product schema.org markup via SEO module)

---

## 2. FOMO Social Proof Popups

Real-time purchase notifications on the storefront to create urgency.

### How It Works (Step by Step)

1. **Order occurs:** Shopify sends `orders/create` webhook.
2. **HMAC verification:** `/api/webhooks` route verifies the signature.
3. **Immediate emit:** Before enqueueing to BullMQ, the route extracts buyer name, product title, product ID, and timestamp, then calls `emitFomoEvent(shopId, event)` which broadcasts via Socket.io to the `storefront:{shopId}` room.
4. **Storefront widget:** Connects to Socket.io with `?shopId=X` query param on page load. Listens for `fomo:purchase` events.
5. **Display:** When an event arrives, the widget shows a popup in the configured corner (bottom-left or bottom-right) with the format: "Alice just purchased Cool Sneakers · 2 minutes ago".
6. **Auto-dismiss:** Popup fades out after configurable duration (default 5 seconds).
7. **Fallback:** If Socket.io can't connect (or drops), widget polls `/api/fomo?shopId=X&productId=Y` every 30 seconds to fetch recent orders from the past 48 hours (via processed `WebhookEvent` records).
8. **Historical cycling:** When no real-time orders are happening, the widget cycles through stored historical orders at configurable interval (default 30s) to keep the social proof active.
9. **Product filtering:** On product pages, the widget filters events to only show popups for the currently viewed product.

### Files

| File | Purpose |
|---|---|
| `app/socket.server.ts` | Socket.io server init, `emitFomoEvent` helper |
| `app/routes/api.webhooks.tsx` | Emits FOMO event on `ORDERS_CREATE` |
| `app/routes/api.fomo.tsx` | REST fallback + returns shop's FOMO settings |
| `app/routes/app.fomo._index.tsx` | Merchant settings page (stores in Redis) |
| `extensions/fomo-widget/blocks/fomo-widget.liquid` | Popup markup + CSS |
| `extensions/fomo-widget/assets/fomo-widget.js` | Socket.io client + polling fallback + event queue |
| `deploy/nginx.conf` | WebSocket upgrade headers for `/socket.io/` |

### What the Merchant Sees

A settings page at `/app/fomo`:

- **Popup Position** — dropdown (bottom-left / bottom-right)
- **Display Duration** — number input (1–30 seconds)
- **Show Historical Orders** — checkbox toggle
- **Historical Order Cycle Interval** — number input (10–120 seconds)
- Save button

Settings persist in Redis keyed by `fomo:settings:{shopId}`.

### What the Customer Sees

A small, rounded popup card appearing in the corner of the page:

```
🛒 Alice just purchased
   Cool Sneakers
   2 minutes ago                    ×
```

- Slides in from bottom, fades out after 5 seconds (or when × is clicked)
- Doesn't block page content (fixed position, z-index 99999)
- Responsive — on mobile, spans full width at bottom
- Uses `aria-live="polite"` for screen reader announcements

### External APIs

None directly — Socket.io is self-hosted, WebhookEvent records feed the REST fallback.

### Limitations

- Single-server Socket.io (PM2 cluster mode breaks it — would need Redis adapter for multi-instance broadcast)
- Cycling historical orders shows same orders repeatedly on quiet stores
- No A/B testing on popup design or position
- No respect for user's "reduced motion" preference for the slide animation
- Buyer first names taken directly from Shopify — may show "Someone" more often than desired
- WebSocket requires proper Nginx upgrade config (documented in `deploy/nginx.conf`)

---

## 3. Upsell Widgets

Offers shown at key purchase moments (cart, product page, thank-you) to increase average order value.

### How It Works (Step by Step)

1. **Merchant creates offer:** In `/app/upsells`, picks placement type, selects product ID, sets discount %, writes headline.
2. **Storage:** `Upsell` record created with `type` (post_purchase / cart / product_page / thank_you), `productId`, `title`, `discountPercent`, `isActive`, counters.
3. **Plan gating:** STARTER plan allows only one active upsell. GROWTH/PRO allow multiple + A/B testing (via `isFeatureAvailable(plan, 'ab_upsells')`).
4. **Storefront fetch:** The upsell-widget extension reads its placement type from Liquid settings and calls `GET /api/upsells?shopId=X&type=cart&productId=Y`.
5. **Display:** Renders one of two layouts based on placement:
   - **Cart:** sticky bar at bottom of page with Add button
   - **Post-purchase / thank-you / product page:** centered card with Accept / Dismiss buttons
6. **Impression tracking:** On render, widget POSTs `{ upsellId, action: "impression" }` to `/api/upsells` — increments the `impressions` counter.
7. **Accept:** On click, widget POSTs `{ upsellId, action: "conversion", revenue }` — increments `conversions` and adds to `revenue`.
8. **Metrics:** Dashboard displays impression count, conversion rate (%), and total revenue per upsell.

### Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `Upsell` model |
| `app/routes/api.upsells.tsx` | GET active offers + POST tracking |
| `app/routes/app.upsells._index.tsx` | Merchant CRUD dashboard with performance metrics |
| `app/utils/plan-limits.server.ts` | `isFeatureAvailable(plan, 'ab_upsells')` gate |
| `extensions/upsell-widget/blocks/upsell-widget.liquid` | Both layouts (card + sticky bar) + CSS |
| `extensions/upsell-widget/assets/upsell-widget.js` | Fetch, render, track events |

### What the Merchant Sees

A dashboard at `/app/upsells`:

- "+ New Upsell" button opens an inline form:
  - Placement type dropdown (4 options)
  - Discount percentage (0–100%)
  - Headline text
  - Product ID input (Shopify GID)
- List of existing upsells with:
  - Title, active/inactive toggle, placement badge
  - 4 metric cards per upsell: Impressions, Conversions, Conversion Rate %, Revenue $
- Actions: Activate/Deactivate, Delete
- STARTER plan warning banner: "Only one active upsell allowed — upgrade for multiple"

### What the Customer Sees

**Cart placement:** A dark sticky bar at the bottom of the page:

```
  Complete your look with...  10% OFF    [Add to Cart]   ×
```

**Post-purchase / thank-you page:** A centered white card with:

```
  ┌─────────────────────────────────┐
  │  Add matching socks?            │
  │  Product: gid://.../Product/X   │
  │  15% OFF                         │
  │  [Add to Order]  [No thanks]    │
  └─────────────────────────────────┘
```

### External APIs

None — fully self-contained. In production, the "Add to Order" flow would call Shopify's Orders API to add the product to the existing order (placeholder currently).

### Limitations

- No Shopify Checkout Extensibility integration — accepting an upsell currently shows a JS alert; actual order modification requires Shopify's server-to-server Orders API
- No A/B variant rotation logic implemented yet (feature flag exists but UI for creating variants doesn't)
- Product ID is manual input — no Shopify product picker modal
- No preview mode before publishing
- Discount percent doesn't auto-create a Shopify discount code — merchant must configure separately
- Impression tracking fires on every widget render (could overcount for SPA-style themes)

---

## 4. Email Marketing + Abandoned Cart

Block-based template editor, campaign scheduling, triggered automations, tracking, and subscriber management.

### How It Works (Step by Step)

**Templates:**
1. Merchant creates a `Campaign` or `Automation` with `templateJson` — an array of blocks (`text`, `image`, `button`, `divider`, `product`).
2. On save, `renderEmailHtml(blocks)` converts the JSON into responsive table-based HTML and caches it in `templateHtml`.

**Campaign send:**
3. Merchant clicks "Send Now" or schedules a time.
4. Action fetches all subscribers where `isSubscribed = true`.
5. Checks quota: `isWithinEmailQuota(shopId, plan, recipientCount)` — STARTER 5K, GROWTH 25K, PRO 100K/month.
6. For each recipient, creates an `EmailSend` record (status `queued`) and enqueues a BullMQ EMAIL job with injected tracking pixel and unsubscribe link (per-recipient `emailSendId` and `customerId`).
7. The email worker pulls jobs (concurrency 5, 3× exponential backoff retry), sends via Brevo API, stores the returned `messageId`, updates status to `sent`.

**Tracking:**
8. Open: HTML contains `<img src="/api/tracking?type=open&id={emailSendId}">` → tracking route returns a 1×1 transparent GIF, updates `EmailSend.openedAt`, increments `Campaign.openCount`.
9. Click: Links wrapped as `/api/tracking?type=click&id={emailSendId}&url={encoded}` → route updates `clickedAt`, increments `clickCount`, redirects to target URL.

**Automations:**
10. **Abandoned cart:** `checkouts/update` webhook arrives → webhook worker checks if abandoned automation is active + subscriber is subscribed → enqueues email with configurable delay (default 60 minutes).
11. **Welcome:** `customers/create` webhook → enqueues welcome email if welcome automation is active.
12. Other triggers: `post_purchase`, `win_back`, `birthday` (scaffolded).

**Unsubscribe:**
13. Every email has `/api/unsubscribe?id={customerId}` link at the bottom.
14. Click → sets `Customer.isSubscribed = false` → renders confirmation page.
15. Brevo bounce/spam webhook → `/api/email-webhooks` → auto-unsubscribes the customer.
16. All send paths check `isSubscribed` before enqueuing.

### Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `Campaign`, `Automation`, `EmailSend` models |
| `app/utils/email-renderer.server.ts` | Block JSON → HTML + tracking/unsubscribe injection |
| `app/utils/brevo.server.ts` | Brevo API wrapper |
| `app/utils/plan-limits.server.ts` | `isWithinEmailQuota` |
| `workers/email.worker.ts` | Processes EMAIL jobs, calls Brevo |
| `workers/webhook.worker.ts` | `handleCustomerCreated` (welcome), `handleCheckoutUpdated` (abandoned cart) |
| `app/routes/api.tracking.tsx` | Open pixel + click redirect |
| `app/routes/api.unsubscribe.tsx` | Unsubscribe handler |
| `app/routes/api.email-webhooks.tsx` | Brevo bounce/spam webhooks |
| `app/routes/app.email.templates.tsx` | Template editor (JSON textarea + preview) |
| `app/routes/app.email.campaigns.tsx` | Campaign management + scheduling |
| `app/routes/app.email.automations.tsx` | Automation CRUD |
| `app/routes/app.email.subscribers.tsx` | Subscriber list with search + filter |

### What the Merchant Sees

Four routes under `/app/email/`:

- **Templates** (`/app/email/templates`) — Create/edit block-based templates. Block JSON textarea with live HTML preview. Save button caches rendered HTML.
- **Campaigns** (`/app/email/campaigns`) — Table of campaigns with Name, Subject, Status, Recipients, Opens %, Clicks %, Revenue. "Send Now" button on draft campaigns. Shows quota warning if over limit.
- **Automations** (`/app/email/automations`) — List of automation flows (abandoned_cart, welcome, post_purchase, win_back, birthday). Toggle active/inactive, configure delay and template per automation.
- **Subscribers** (`/app/email/subscribers`) — Search bar, filter by opt-in status, manually unsubscribe any customer.

### What the Customer Sees

**Campaign email:** Professional HTML email with merchant's branded blocks (text, images, buttons, product cards). Has a visible unsubscribe link at the bottom.

**Abandoned cart email:** Personalized subject like "You left something behind..." with the items still in their cart, sent ~60 minutes after they abandon checkout.

**Welcome email:** Sent on account creation with shop's welcome template.

**Unsubscribe page:** Clean confirmation page: "You have been successfully unsubscribed."

### External APIs

- **Brevo** (`api.brevo.com/v3/smtp/email`) — all email sending, plus bounce/complaint webhooks

### Limitations

- Template editor is a **JSON textarea**, not a visual drag-and-drop builder (would take weeks to build properly)
- No segmentation beyond "subscribed/unsubscribed" — can't target "customers who bought X" or "high LTV customers"
- No email preview testing (send to yourself feature)
- No A/B testing of subject lines
- Quota checks happen at send time, not at schedule time — a delayed campaign could fail quota at execution
- Brevo free tier is 9K/month across all shops — would need a paid Brevo account to support multiple PRO merchants
- Unsubscribe links aren't cryptographically signed (anyone with a customer ID could unsubscribe them) — should add HMAC signature in production
- No deliverability monitoring or SPF/DKIM setup guidance for merchants
- Abandoned cart cooldown isn't enforced (same customer could get multiple abandoned cart emails if they abandon repeatedly)

---

## 5. Loyalty Program

Points-based rewards system with tier progression and storefront widget.

### How It Works (Step by Step)

1. **Activation:** Merchant clicks "Activate" in `/app/loyalty` → creates `LoyaltyProgram` record with default values (1 pt/$, 100 pt signup bonus, 50 pt review, 200 pt referral, $0.01 reward value).
2. **Earning — Purchase:** `orders/paid` webhook → webhook worker calculates `Math.floor(subtotal × pointsPerDollar)` → creates `LoyaltyTransaction` of type `earn` → increments `Customer.loyaltyPoints` (denormalized counter) in a Prisma transaction.
3. **Earning — Signup:** `customers/create` webhook → if program active, awards `pointsForSignup`.
4. **Earning — Review:** Review moderation dashboard "Approve" action → awards `pointsForReview`.
5. **Earning — Referral:** When referred friend makes first purchase, advocate gets `pointsForReferral` (see Referral module).
6. **VIP Tiers (GROWTH/PRO):** Merchant configures tiers as JSON: `[{ name: "Silver", minPoints: 500 }, { name: "Gold", minPoints: 2000 }]`. After each point award, `assignTier()` finds the highest qualifying tier and updates `Customer.loyaltyTier`.
7. **Redemption:** Customer POSTs to `/api/loyalty/redeem` with `{ customerId, shopId, points }`.
8. **Validation:** `redeemPoints()` checks balance ≥ points. If insufficient, rejects with error. If OK, creates negative `LoyaltyTransaction` (type `redeem`) + decrements balance transactionally.
9. **Discount code:** Generates a unique code like `LOYALTY-A1B2C3-1M3K4F2`. In production, this would be created in Shopify via the Discount API; currently placeholder.
10. **Widget:** Storefront loyalty-widget calls `/api/loyalty/balance?shopId=X&customerId=Y` every 60 seconds, displays current points + available dollar value.

### Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `LoyaltyProgram`, `LoyaltyTransaction` models |
| `app/utils/loyalty.server.ts` | `calculatePointsEarned`, `awardPoints`, `redeemPoints`, `assignTier` |
| `workers/webhook.worker.ts` | Point awards on `orders/paid` and `customers/create` |
| `app/routes/api.loyalty.balance.tsx` | Public GET for widget |
| `app/routes/api.loyalty.redeem.tsx` | POST redemption endpoint |
| `app/routes/app.loyalty._index.tsx` | Dashboard with stats, settings, VIP tiers, top earners |
| `app/routes/app.reviews._index.tsx` | Awards review points on approval |
| `extensions/loyalty-widget/blocks/loyalty-widget.liquid` | Storefront widget markup |
| `extensions/loyalty-widget/assets/loyalty-widget.js` | Polls balance, renders |

### What the Merchant Sees

Dashboard at `/app/loyalty`:

- **Activate/Deactivate** toggle button
- **4 stat cards:** Total Points Issued, Total Redeemed, Redemption Rate (ROI%), Status
- **Points Settings form:** points per dollar, signup bonus, review bonus, referral bonus, reward value ($/point)
- **VIP Tiers section** (GROWTH/PRO only):
  - JSON textarea to define tiers: `[{ "name": "Silver", "minPoints": 500 }, ...]`
  - Upgrade prompt shown on STARTER: "VIP tiers require Growth or Pro plan"
- **Top Earners table:** Customer name, current points, tier

### What the Customer Sees

Storefront loyalty widget (anywhere the merchant places it):

```
  ┌──────────────────────────────┐
  │  ⭐ Your Rewards              │
  │                               │
  │  1,250 Points                 │
  │  Available reward: $12.50     │
  │                               │
  │  [Silver VIP badge]           │
  │                               │
  │  ─────────────────────       │
  │  🎁 Refer a Friend            │
  │  [referral link]  📋          │
  │  [Email] [WhatsApp]           │
  └──────────────────────────────┘
```

The widget polls every 60 seconds so balance updates after purchases. Only shown when customer is logged in.

### External APIs

- **Shopify Discount API** (not yet wired) — would create discount codes on redemption
- **Groq API** — not used by this module

### Limitations

- Discount code generation is currently a placeholder string — needs Shopify Discount API integration to be a real redemption
- No point expiration logic (`LoyaltyTransaction` has `type: 'expire'` in design but no scheduled job expires points)
- VIP tier benefits aren't defined (tiers assign but don't unlock anything like bonus point multipliers or perks)
- No email notifications on tier promotion or point milestones
- Widget requires customer ID to be exposed by the theme — many themes don't set `window.__st.cid`, so merchants may need to add a meta tag
- No manual point adjustment UI for merchants (customer service can't add/remove points through the dashboard)
- Point calculation uses Shopify's `subtotal_price` from webhook — doesn't exclude tax/shipping explicitly
- Birthday bonus points scaffolded but not implemented

---

## 6. SEO Automation

Automated audits, AI-generated meta tags, AI alt text, and schema.org markup injection.

### How It Works (Step by Step)

1. **Trigger audit:** Merchant clicks "Run SEO Audit" in `/app/seo` → enqueues `SEO_AUDIT` job in BullMQ (worker concurrency 1, 2× exponential backoff).
2. **Fetch products:** Worker pulls stored Shopify access token from Shop record, calls Shopify REST Admin API with pagination (`/admin/api/2024-10/products.json?limit=50` + page_info), fetches all products with metafields.
3. **Detect issues:** For each product, `detectProductSeoIssues(product, shopDomain)` checks:
   - Missing meta title → critical
   - Missing meta description → critical
   - Missing image alt text → warning (one issue per affected image)
4. **Store issues:** Creates `SeoIssue` records with type, severity, resourceUrl, description.
5. **Calculate score:** `auditScore = floor((totalProducts - productsWithIssues) / totalProducts × 100)`. Updates `SeoSettings.auditScore` and `lastAuditAt`.
6. **Auto-fix meta tags:** Merchant clicks "Auto-Fix" on a missing_meta issue → dashboard fetches the product, calls Groq API `generateSeoMeta(product)` → returns optimized title (≤60 chars) + description (≤160 chars) → updates product metafields via Shopify API (`title_tag` and `description_tag` in `global` namespace). Marks issue `isFixed = true`.
7. **Auto-fix alt text:** Click "Auto-Fix" on missing_alt → dashboard finds the image across products, calls `generateAltText(imageUrl, productTitle)` → updates image via Shopify REST API.
8. **Auto-schema:** "Enable Schema.org" button creates a Shopify Script Tag pointing to the app's schema injection script — adds Product JSON-LD to product pages automatically.
9. **Targeted check:** On `products/create` or `products/update` webhook, the webhook worker enqueues a targeted `SEO_AUDIT` job with just that `productId`, re-evaluating only that product.
10. **Mark fixed:** Merchant can manually mark an issue as fixed without auto-fix (useful for issues that were resolved externally).

### Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `SeoSettings`, `SeoIssue` models |
| `workers/seo.worker.ts` | Full + targeted audit processing |
| `workers/seo-issues.ts` | Pure detection logic (`detectProductSeoIssues`, `calculateAuditScore`) |
| `workers/shopify-api.ts` | Shopify REST helpers for worker (fetchProducts, updateMetafields, updateImageAltText, createScriptTag) |
| `workers/webhook.worker.ts` | Enqueues targeted audits on product webhooks |
| `app/ai.server.ts` | Groq wrappers: `generateSeoMeta`, `generateAltText` |
| `app/routes/app.seo._index.tsx` | Dashboard with audit score, issue list, auto-fix buttons |

### What the Merchant Sees

Dashboard at `/app/seo`:

- **"Run SEO Audit" button** (top right)
- **4 stat cards:** Audit Score (colored: green ≥80, amber ≥50, red <50), Critical Issues count, Warnings count, Last Audit date
- **Auto-Fix Settings:** Three toggles (Auto Meta Tags / Auto Alt Text / Auto Schema) with indicator dots, "Enable Schema.org" button if not enabled
- **Issue sections** grouped by severity:
  - **Critical Issues** (red background): "Product X is missing a meta title" with "Auto-Fix" button
  - **Warnings** (amber background): "Image is missing alt text" with "Auto-Fix" button
  - **Info** (blue background)
- Each issue row has: description, resource URL, "Auto-Fix" and "Mark Fixed" buttons
- Empty state: "No SEO issues found — your store looks great"

### What the Customer Sees

Nothing visible — SEO improvements affect search engine rankings, not direct storefront display. Behind the scenes:

- Product pages get proper `<title>` and `<meta name="description">` tags
- Product images get descriptive `alt` attributes (also improves accessibility for screen readers)
- Product pages include JSON-LD structured data so Google can show rich results (price, ratings, availability)

### External APIs

- **Shopify REST Admin API** (`/admin/api/2024-10/products.json`) — fetch products, update metafields, update images, create script tags
- **Groq API** (Llama 3.3 70B) — generate SEO meta titles/descriptions and alt text

### Limitations

- Uses **REST Admin API** (legacy) instead of GraphQL — slower pagination, more API calls. Shopify recommends GraphQL now.
- Only checks products, not pages/collections/blog posts
- Doesn't detect: broken links, slow page load, mobile-friendliness, HTTPS issues, duplicate content
- Schema.org is injected via Script Tag — Google prefers server-rendered JSON-LD for reliability
- AI-generated alt text uses `imageUrl` as input but Groq is text-only — can't actually "see" the image, so it infers from product title/context only (not ideal)
- No A/B testing of AI-generated meta tags
- Auto-fix is one-issue-at-a-time — no "fix all critical issues" batch button
- Groq API rate limit is 14,400 requests/day free tier — bulk audits on a large catalog could hit limits
- No sitemap generation or submission to Google Search Console
- Audit runs serially per shop (concurrency 1) to respect Shopify rate limits — a shop with 10,000 products takes a while

---

## 7. Analytics Dashboard

First-party JavaScript pixel, nightly aggregation, and merchant-facing reports.

### How It Works (Step by Step)

1. **Pixel installation:** Merchant embeds `<script src="{APP_URL}/pixel.js" data-app-url="..." data-shop-id="..."></script>` on their storefront (via Shopify Script Tag or theme edit).
2. **Pixel load:** Script runs on every page load. Generates/reads `nexify_visitor_id` (persistent) and `nexify_session_id` (rotates after 30min inactivity) from `localStorage`. **No third-party cookies.**
3. **Page view event:** Pixel extracts URL, UTM params (`utm_source`, `utm_medium`, `utm_campaign`), user agent. Sends to `/api/pixel` via `navigator.sendBeacon` (falls back to `fetch` with `keepalive`).
4. **Add-to-cart event:** Pixel hooks into form submissions to `/cart/add` AND intercepts `fetch` calls to `/cart/add.js`. Extracts product ID and sends.
5. **API validation:** `/api/pixel` validates payload (required fields, event type in whitelist, string length limits). On invalid, logs warning and returns 200 (never breaks storefront). Creates `AnalyticsEvent` record with IP extracted from `x-forwarded-for`.
6. **Purchase event:** On `orders/paid` webhook, webhook worker creates a `purchase` `AnalyticsEvent` directly (server-side), extracting UTM from `landing_site` URL and total_price as revenue.
7. **Nightly aggregation:** `ANALYTICS` job (concurrency 1) runs per shop per day:
   - Fetches all `AnalyticsEvent` for the target date
   - Groups by `(source, medium)`
   - Counts: pageViews, addToCarts, uniqueVisitors (Set of visitorIds), orders (dedup by orderId), revenue
   - Upserts into `AnalyticsDailySummary` with compound unique key `(shopId, date, source, medium)`
8. **Dashboard render:** Loader queries `AnalyticsDailySummary` for selected date range. Aggregates totals across summaries. Displays in cards + table.

### Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `AnalyticsEvent`, `AnalyticsDailySummary` models |
| `public/pixel.js` | First-party pixel (served statically from app) |
| `app/routes/api.pixel.tsx` | Event validation + DB insert + CORS |
| `workers/analytics.worker.ts` | Nightly aggregation into daily summaries |
| `workers/webhook.worker.ts` | Purchase event creation on `orders/paid` |
| `app/routes/app.analytics._index.tsx` | Merchant dashboard |
| `app/utils/plan-limits.server.ts` | `isFeatureAvailable(plan, 'ltv_report')` — gates LTV section |

### What the Merchant Sees

Dashboard at `/app/analytics`:

- **Date range picker** (default: last 30 days)
- **4 metric cards:** Total Revenue, Total Orders, Average Order Value, Unique Visitors
- **Channel Attribution table:** Source | Medium | Revenue | Orders (sorted by revenue)
- **Customer LTV & Cohort Retention section:**
  - STARTER plan: upgrade prompt "Available on Growth or Pro"
  - GROWTH/PRO: Avg Customer LTV (revenue / unique visitors approximation) + Conversion Rate (orders / visitors)
  - Note: "Full cohort retention chart coming soon"

### What the Customer Sees

Nothing visible — the pixel is invisible (no UI elements). It just tracks behavior silently.

**Privacy friendly:**
- No third-party cookies
- Stores only first-party `localStorage` session/visitor IDs
- No cross-site tracking
- Merchant remains GDPR-responsible for their own consent banners and privacy policy

### External APIs

None — entirely self-hosted. Raw events go straight from customer browser → app's `/api/pixel` endpoint → PostgreSQL.

### Limitations

- **Unique visitor count is approximate** — summed across daily summaries, which means a visitor counted on multiple days is counted multiple times in the date-range total. Accurate unique count requires querying raw events (not done for performance).
- **Full cohort retention chart** is placeholder text, not implemented
- **LTV is a rough approximation** (`totalRevenue / uniqueVisitors`) — real LTV would track repeat purchases per customer over time
- **Aggregation job must be scheduled externally** (cron or repeatable BullMQ job) — currently worker exists but no trigger wired
- **No real-time dashboard** — data is stale until nightly aggregation runs
- **No bot filtering** — bot traffic inflates page views and unique visitors
- **No conversion funnel reports** (view → cart → checkout → purchase)
- **UTM attribution** uses Shopify's `landing_site` which is the first page of the session, not last-touch
- **No integration with Meta/Google Ads APIs** (removed from final scope)
- **Pixel doesn't fire on SPA route changes** by default — themes using AJAX navigation may miss page views

---

## 8. Referral Program

Unique codes per customer, advocate rewards, friend discounts, social sharing.

### How It Works (Step by Step)

1. **Activation:** Merchant clicks "Activate" in `/app/referrals` → creates `ReferralProgram` record (default: $10 advocate reward, 15% friend discount).
2. **Backfill codes:** On activation, `generateCodesForExistingCustomers()` creates a unique `crypto.randomBytes(4).toString('hex')` (8-char hex) for each existing customer without one.
3. **New customer:** `customers/create` webhook → webhook worker generates + assigns a unique referral code to the new customer.
4. **Share:** Customer sees their personal referral link in the loyalty widget: `{APP_URL}/api/referral?code=abc12345&shop=mystore.myshopify.com`. Widget has copy button, email share (`mailto:`), and WhatsApp share (`wa.me/?text=`).
5. **Friend visits link:** `/api/referral?code=X&shop=Y` validates the code exists, matches the shop, and isn't self-referred (checks `visitorEmail` query param against referrer's email).
6. **Pending referral created:** Creates `Referral` record with `status = pending`, stores referrer customer ID.
7. **Friend signs up:** `customers/create` webhook fires for the new customer → `handleReferralSignup()` finds the matching pending referral (by email) → updates status to `signed_up`, links the new customer ID, sets `Customer.referredBy = code`.
8. **Friend first purchase:** `orders/paid` webhook → `handleReferralPurchase()` finds the signed_up referral for this customer → updates status to `purchased`, generates advocate discount code (`REF-XXXXXXXX`), stores on referral.
9. **Award loyalty points:** If loyalty program is active, calls `awardPoints(referrer, points = pointsForReferral)`.
10. **Dashboard:** Merchant sees total referrals, conversion rate (purchased/total), and a recent referrals list.

### Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `ReferralProgram`, `Referral` models + `Customer.referralCode`, `Customer.referredBy` |
| `app/utils/referral.server.ts` | Code generation (`generateReferralCode`, `generateUniqueReferralCode`), self-ref check (`isSelfReferral`), lifecycle handlers (`handleReferralSignup`, `handleReferralPurchase`) |
| `app/utils/loyalty.server.ts` | `awardPoints()` used on referral reward |
| `workers/webhook.worker.ts` | `handleCustomerCreated` — generates code + updates pending referrals; `handleOrderPaid` — triggers `handleReferralPurchase` |
| `app/routes/api.referral.tsx` | Public link handler with self-ref check |
| `app/routes/api.loyalty.balance.tsx` | Returns `referralCode` in response when referral program is active |
| `app/routes/app.referrals._index.tsx` | Dashboard + settings |
| `extensions/loyalty-widget/assets/loyalty-widget.js` | Renders referral sharing section |

### What the Merchant Sees

Dashboard at `/app/referrals`:

- **Activate/Deactivate** toggle (activation generates codes for all existing customers)
- **3 stat cards:** Total Referrals, Conversion Rate (%), Converted (count)
- **Reward Settings form:**
  - Advocate Reward ($) — discount given to referrer
  - Friend Discount (%) — discount for the referred friend
  - Reward Type dropdown: Discount Code / Loyalty Points
- **Recent Referrals table:** Referred Email | Status (pending/signed_up/purchased/rewarded) | Discount Code | Date

### What the Customer Sees

Integrated into the loyalty widget (when both programs are active):

```
  ─────────────────────
  🎁 Refer a Friend
  Share your link and earn rewards!

  ┌─────────────────────────┐📋
  │ https://app.../referral │
  └─────────────────────────┘

  [✉️ Email]  [💬 WhatsApp]
```

**Copy button:** Writes link to clipboard via `navigator.clipboard.writeText()`, shows ✓ feedback for 2 seconds.

**Email:** Opens default mail client with `mailto:?subject=...&body=Hey! Check out this store with my referral link...`.

**WhatsApp:** Opens `wa.me` with pre-filled message.

**Friend's side:** When they click the referral link, they're redirected to the store (tracking cookie/session set). On account creation, the referral is automatically linked. On first purchase, they get the discount applied at checkout (would need a discount code auto-applied via theme customization or checkout UI extension).

### External APIs

- **Shopify Discount API** (placeholder — not actually wired) — would create the advocate discount code on successful referral

### Limitations

- **Self-referral detection uses email matching** — not bulletproof. If a customer uses a different email on their alt account, they could refer themselves.
- **Discount code** generated is a placeholder string — actual Shopify discount code creation (with value, expiration, usage limits) needs wiring to Shopify Discount API.
- **Friend discount application is manual** — no auto-apply at checkout; friend has to know to enter the code. Would need a cookie-based checkout extension.
- **No referral link tracking in Shopify's analytics** — app's own analytics captures the `/api/referral` hit but not the subsequent customer journey.
- **No time limit on referral expiration** — a referral stays `pending` forever until the friend signs up.
- **Email matching for linking signed_up referrals** is fragile — if customer signs up with a different email than the one used on the referral, the link is never made. Would need cookie-based tracking.
- **No social sharing buttons for SMS, Facebook, Twitter** — only copy/email/WhatsApp.
- **No unique referral link landing page** — the link currently returns JSON; should render a branded "You got $X off thanks to {referrer}" page and set a cookie.
- **WhatsApp share message is hardcoded** — not customizable by merchant.

---

## Infrastructure

### How Nginx, PM2, BullMQ, PostgreSQL, Redis, and Meilisearch Connect

```
                    ┌─────────────────────────┐
                    │  Shopify / Customer     │
                    │  Browser / Webhooks     │
                    └────────────┬────────────┘
                                 │ HTTPS (443)
                                 ▼
                    ┌─────────────────────────┐
                    │  Nginx                  │
                    │  • SSL termination      │
                    │  • HTTP→HTTPS redirect  │
                    │  • WebSocket upgrade    │
                    │    for /socket.io/      │
                    │  • Rate limiting        │
                    └────────────┬────────────┘
                                 │ proxy_pass 127.0.0.1:3000
                                 ▼
        ┌────────────────────────────────────────────────┐
        │  PM2 Cluster (2× Remix instances, port 3000)    │
        │  • Shopify OAuth + admin routes                 │
        │  • Public API routes (/api/*)                   │
        │  • Socket.io server (FOMO events)               │
        │  • Serves public/pixel.js                       │
        └───────┬────────────────┬───────────────────────┘
                │                │
                │ ioredis        │ PrismaClient
                ▼                ▼
    ┌──────────────────┐   ┌──────────────────┐
    │  Redis           │   │  PostgreSQL 16   │
    │  127.0.0.1:6379  │   │  127.0.0.1:5432  │
    │  • BullMQ queues │   │  • All app data  │
    │  • FOMO settings │   │  • Transactional │
    │  • Caching       │   │    writes        │
    └────────┬─────────┘   └──────────────────┘
             │ BullMQ
             ▼
    ┌─────────────────────────────────┐
    │  PM2 Worker Process (separate)  │
    │  workers/index.ts               │
    │                                 │
    │  6 BullMQ queues:               │
    │  • EMAIL (concurrency 5)        │
    │  • WEBHOOK (concurrency 10)     │
    │  • REVIEW_REQUEST (3)           │
    │  • SEO_AUDIT (1)                │
    │  • ANALYTICS (1)                │
    │  • SEARCH_INDEX (5)             │
    └───────┬──────────────┬──────────┘
            │              │
            │ Meilisearch  │ External APIs
            │ HTTP client  │ (fetch)
            ▼              ▼
    ┌─────────────┐   ┌─────────────────────────┐
    │ Meilisearch │   │  Brevo (email)          │
    │ 127.0.0.1:  │   │  Groq (AI)              │
    │ 7700        │   │  Cloudflare R2 (files)  │
    │ (PM2 mgmt)  │   │  Shopify Admin API      │
    └─────────────┘   └─────────────────────────┘
```

### Component Roles

**Nginx** — public entry point. Terminates SSL with Let's Encrypt certificates. Redirects HTTP to HTTPS. Handles WebSocket upgrade headers for Socket.io on `/socket.io/`. Rate-limits API routes (30 req/s with burst 50). Sets security headers (HSTS, X-Frame-Options, X-Content-Type-Options). All traffic proxies to `127.0.0.1:3000`.

**PM2** — process manager. Runs three processes defined in `ecosystem.config.js`:
- `shopify-app` — Remix server in cluster mode with 2 instances on port 3000 (zero-downtime restarts, shared port via cluster)
- `bullmq-workers` — single worker process that consumes all 6 BullMQ queues
- `meilisearch` — the Meilisearch binary, bound to `127.0.0.1:7700` with master key auth

PM2 auto-restarts crashed processes within 5 seconds (exponential backoff starting at 1s, max 10 restarts within 5s uptime window).

**BullMQ** — job queue library running on top of Redis. Producers (Remix app) enqueue jobs via `queue.add()`. Consumers (worker process) pull jobs and process them with configured concurrency. Supports delays (used for 7-day review requests), retries with exponential backoff, dead-letter queues (after 3 failed attempts).

**PostgreSQL 16** — primary database. All transactional writes go here via Prisma ORM (parameterized queries, no raw SQL injection risk). Listens only on `127.0.0.1:5432` — blocked from public by UFW. Every model has `shopId` for multi-tenancy; composite unique constraints enforce idempotency (e.g., `WebhookEvent(shopId, topic, shopifyId)`).

**Redis 7** — two roles:
1. **BullMQ backend** — job queues stored as Redis lists/streams, visible across producer and worker processes
2. **Application cache** — shop-level settings (FOMO config) keyed by `fomo:settings:{shopId}`, hot data

Listens only on `127.0.0.1:6379`.

**Meilisearch** — full-text search engine for dashboard search. Two indexes: `customers` (searchable: email, firstName, lastName, phone) and `products` (searchable: title, vendor, productType, tags). Both indexes filter by `shopId` for multi-tenant isolation. Customer/product documents are upserted via `SEARCH_INDEX` BullMQ jobs triggered from webhooks. Listens only on `127.0.0.1:7700`.

**Cloudflare R2** — file storage (S3-compatible). All review photos stored under `reviews/{shopId}/{reviewId}/{filename}`. Served via `{R2_PUBLIC_URL}` CDN. Outside VPS — no disk pressure on the server.

### Firewall (UFW)

Configured by `deploy/setup-firewall.sh`:
- **Allow:** SSH (22), Nginx Full (80, 443)
- **Deny:** PostgreSQL (5432), Redis (6379), Meilisearch (7700) — all bound to localhost, not exposed publicly

### Request Flows

**Merchant dashboard request:**
Browser → Nginx (TLS) → Remix (port 3000) → `authenticate.admin(request)` → Prisma query → rendered HTML streamed back.

**Webhook from Shopify:**
Shopify → Nginx → `/api/webhooks` → HMAC verified → (if ORDERS_CREATE, emit FOMO via Socket.io immediately) → create `WebhookEvent` → enqueue BullMQ job → return HTTP 200 within 5s.

Worker process → pulls job → idempotency check → routes to handler → marks event as `processed` → if fail, `failed` + retry.

**Customer storefront:**
Browser → CDN-cached widget JS → fetch from `{APP_URL}/api/reviews/public` etc. → Remix route → Prisma (+ maybe Meilisearch) → JSON response.

**Real-time FOMO:**
Customer browser opens Socket.io connection via `wss://{APP_URL}/socket.io/?shopId=X` → Nginx upgrades to WebSocket → Remix Socket.io server joins `storefront:{shopId}` room → when `ORDERS_CREATE` webhook arrives, server emits `fomo:purchase` event → all connected widgets for that shop receive it.

---

## Database Schema

21 Prisma models in `prisma/schema.prisma`:

| Model | Purpose |
|---|---|
| `Shop` | Central tenant. Stores shopDomain, accessToken, plan (STARTER/GROWTH/PRO), isActive. |
| `Session` | Shopify OAuth sessions (managed by @shopify/shopify-app-session-storage-prisma). |
| `Customer` | Shop customers. Has loyaltyPoints (denormalized), isSubscribed, referralCode, referredBy. |
| `Review` | Product reviews. Rating, title, body, photos[], isApproved, isPublished, sentiment, helpfulCount. |
| `ReviewRequest` | Outbound review request tracking. token (unique cuid), scheduledAt, sentAt, status. |
| `Campaign` | Email marketing campaigns. templateJson, templateHtml (cached), recipientCount, openCount, clickCount. |
| `Automation` | Email automations. trigger, isActive, delayMinutes, templateJson. |
| `EmailSend` | Per-recipient email send record. Links to Campaign or Automation. brevoMessageId, openedAt, clickedAt. |
| `LoyaltyProgram` | Per-shop loyalty config. pointsPerDollar, rewardValue, tiers (JSON). |
| `LoyaltyTransaction` | Append-only ledger. type (earn/redeem), points (signed), reason, orderId. |
| `ReferralProgram` | Per-shop referral config. advocateReward, friendDiscount, rewardType. |
| `Referral` | Individual referrals. referrerCustomerId, referredEmail, status (pending/signed_up/purchased/rewarded), discountCode. |
| `Upsell` | Upsell offers. type, productId, title, discountPercent, impressions, conversions, revenue. |
| `AnalyticsEvent` | Raw event log (high volume). eventType, visitorId, sessionId, revenue, source/medium/campaign. |
| `AnalyticsDailySummary` | Aggregated daily stats. Unique on (shopId, date, source, medium). |
| `SeoSettings` | Per-shop SEO config. autoMetaTags, autoAltText, autoSchema, auditScore, lastAuditAt. |
| `SeoIssue` | Individual detected issues. type, severity, resourceUrl, isFixed. |
| `WebhookEvent` | Idempotency-enforcing webhook log. Unique on (shopId, topic, shopifyId). status, payload. |

---

## Testing

All modules have unit tests using Vitest + fast-check (for property-based tests).

**Total: 280 tests passing, 23 test files, 0 failures.**

| Test file | Tests | Coverage |
|---|---|---|
| `app/env.server.test.ts` | Env validation, secret length checks |
| `app/r2.server.test.ts` | R2 key structure, CDN URL, file validation |
| `app/utils/billing.server.test.ts` | Plan configs, Shopify billing GraphQL, upgrade/downgrade |
| `app/utils/plan-limits.server.test.ts` | Plan gating, feature availability |
| `app/utils/loyalty.server.test.ts` | Points calculation, earn/redeem, tier assignment |
| `app/utils/referral.server.test.ts` | Code generation, self-ref detection |
| `app/utils/email-renderer.server.test.ts` | Block→HTML rendering, tracking injection |
| `app/routes/api.webhooks.test.ts` | HMAC verification flow, FOMO emission, idempotency |
| `app/routes/api.reviews.test.ts` | Token validation, photo upload, 5-photo limit |
| `app/routes/api.reviews.helpful.test.ts` | Helpful count increment |
| `app/routes/api.reviews.public.test.ts` | Public reviews API with shopId filter |
| `app/routes/api.fomo.test.ts` | REST fallback, settings integration |
| `app/routes/api.upsells.test.ts` | CRUD + tracking + CORS |
| `app/routes/api.pixel.test.ts` | Payload validation, IP extraction, CORS |
| `app/routes/api.tracking.test.ts` | Open pixel, click redirect |
| `app/routes/api.loyalty.redeem.test.ts` | Redemption validation + error cases |
| `app/routes/api.referral.test.ts` | Self-ref prevention, valid code flow |
| `app/routes/app.fomo.test.ts` | Settings CRUD + Redis persistence |
| `workers/webhook.worker.test.ts` | Idempotency check, topic routing |
| `workers/webhook-fulfilled.test.ts` | Review request scheduling |
| `workers/review.worker.test.ts` | Email HTML generation, skip logic, Brevo error propagation |
| `workers/search.worker.test.ts` | Meilisearch upsert/delete + error handling |
| `workers/seo-issues.test.ts` | Issue detection + audit score |

Run tests: `npx vitest --run`

---

## Environment Variables

See `.env.example` for the full list. Required:

```
SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES
DATABASE_URL                    # postgresql://user:pass@localhost:5432/nexify
REDIS_URL                       # redis://127.0.0.1:6379
MEILISEARCH_URL, MEILISEARCH_MASTER_KEY  # http://127.0.0.1:7700, min 16 chars
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME
GROQ_API_KEY, GROQ_MODEL        # llama-3.3-70b-versatile
SENTRY_DSN
SESSION_SECRET                  # min 32 chars
```

Validated at startup by `app/env.server.ts` — app exits with descriptive error if any are missing or if secrets are too short.

---

## Deployment Checklist

1. Provision Hostinger KVM 2 VPS (Ubuntu 22.04)
2. Install Node.js 20, PM2, PostgreSQL 16, Redis 7, Nginx, Meilisearch, Certbot
3. `git clone` + `npm install`
4. Set `.env` with production values
5. `npx prisma migrate deploy` — apply migrations
6. `npm run build` — Remix production build
7. `certbot --nginx -d yourdomain.app` — obtain SSL
8. Copy `deploy/nginx.conf` to `/etc/nginx/sites-available/nexify`, symlink to `sites-enabled/`, replace `YOUR_DOMAIN`
9. `nginx -t && systemctl reload nginx`
10. `sudo ./deploy/setup-firewall.sh` — enable UFW
11. `pm2 start ecosystem.config.js` — start all processes
12. `pm2 save && pm2 startup` — persist across reboots
13. In Shopify Partner Dashboard: set app URL to `https://yourdomain.app`, add redirect URL `https://yourdomain.app/auth/callback`
14. Install on a development store, test OAuth flow

---

## What's Next

The built system is a complete MVP ready for beta testing. Before public launch on the Shopify App Store, prioritize:

1. ~~**Shopify Discount API integration** for real loyalty redemption + referral advocate codes~~ ✅ Done — `app/utils/discount.server.ts` wires `discountCodeBasicCreate` into both flows.
2. **Visual email template builder** (or at least pre-made templates merchants can clone) — ✅ Three prebuilt templates ship in `app/utils/email-templates.server.ts` (Welcome, Abandoned Cart, Post-Purchase) with a one-click Clone button in the dashboard.
3. **Cohort retention chart** in analytics (currently placeholder)
4. ~~**Scheduled analytics aggregation** (cron or repeatable BullMQ job)~~ ✅ Done — repeatable cron `5 0 * * *` UTC registered in `workers/index.ts` via `scheduleAnalyticsCron()`.
5. ~~**Real PM2 cluster + Socket.io Redis adapter** for multi-instance FOMO broadcast~~ ✅ Done — `@socket.io/redis-adapter` attached in `app/socket.server.ts` using duplicated Redis connections.
6. **Postgres migration run** on your VPS (not done yet — the code is ready but tables aren't created)
7. **Beta test with 5–10 merchants** before charging money

The hardest parts — OAuth, webhooks, real-time FOMO, idempotent job processing, quota enforcement, AI integration — are done.
