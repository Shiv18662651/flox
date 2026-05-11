# Requirements Document

## Introduction

The Shopify Super-App (working title: **Nexify**) is an all-in-one Shopify public app sold on the Shopify App Store. It consolidates the functionality of approximately 15 separate third-party apps — including Klaviyo, Judge.me, ReConvert, Tidio, and Smile.io — into a single unified platform. The target audience is Shopify merchants generating $10K–$500K per year in revenue who want to reduce app subscription costs, eliminate data silos between tools, and manage their entire growth stack from one dashboard.

The platform is built on Remix (Node.js), PostgreSQL 16, Redis 7, BullMQ, Socket.io, and Meilisearch, hosted on a Hostinger KVM 2 VPS. Third-party integrations include Brevo (email delivery), WhatsApp Business API (SMS/WhatsApp), Groq API with Llama 3 (AI chatbot and SEO), and Cloudflare R2 (file storage). Billing is handled through Shopify's native Billing API with three tiers: Starter ($29/mo), Growth ($79/mo), and Pro ($199/mo).

---

## Glossary

- **App**: The Nexify Shopify Super-App platform described in this document.
- **Shop**: A Shopify merchant store that has installed the App.
- **Merchant**: The owner or operator of a Shop.
- **Customer**: An end-user (shopper) of a Shop.
- **Visitor**: An anonymous browser session on a Shop's storefront, not yet identified as a Customer.
- **Session**: A Shopify OAuth session record linking a Shop to its access token.
- **Plan**: One of three subscription tiers — STARTER, GROWTH, or PRO.
- **BullMQ_Worker**: A background job processor that consumes jobs from Redis queues.
- **Brevo**: The third-party transactional and marketing email delivery service.
- **Groq_API**: The third-party AI inference API providing Llama 3 model access.
- **R2**: Cloudflare R2 object storage used for file uploads (review photos, email assets).
- **Meilisearch**: The self-hosted full-text search engine used for product and customer search.
- **Widget**: A Shopify Theme App Extension rendered on the storefront.
- **Webhook**: An HTTP callback sent by Shopify to the App when a resource event occurs.
- **FOMO_Popup**: A storefront notification showing recent purchase activity to create urgency.
- **Upsell**: A post-purchase or in-cart offer to increase average order value.
- **Loyalty_Program**: A points-based rewards system tied to customer purchases and actions.
- **Referral_Program**: A system rewarding existing Customers for bringing new Customers.
- **SEO_Audit**: An automated scan of a Shop's product and page metadata for SEO issues.
- **Campaign**: A one-time bulk email send to a segment of subscribers.
- **Automation**: A triggered email sequence activated by a specific customer event.
- **Pixel**: A first-party JavaScript tracking snippet embedded in the Shop's storefront.

---

## Requirements

### Requirement 1: Shopify OAuth and App Installation

**User Story:** As a Merchant, I want to install the App from the Shopify App Store, so that my store is connected and I can access all platform features.

#### Acceptance Criteria

1. WHEN a Merchant initiates installation from the Shopify App Store, THE App SHALL redirect the Merchant through the Shopify OAuth 2.0 authorization flow and request all required API scopes.
2. WHEN the Merchant approves the OAuth authorization, THE App SHALL exchange the authorization code for a permanent access token and persist it in the Session store.
3. WHEN a new Shop is authenticated for the first time, THE App SHALL create a Shop record in the database with the shop domain, access token, and default STARTER plan.
4. WHEN a new Shop is created, THE App SHALL register all required Shopify webhooks defined in the webhook manifest.
5. WHEN a new Shop is created, THE App SHALL initialize default settings records for Chat, SEO, Loyalty, and Referral modules.
6. WHEN the App receives a request with an expired or invalid Session, THE App SHALL redirect the Merchant to re-authenticate via OAuth.
7. IF the OAuth callback contains an error parameter, THEN THE App SHALL display a descriptive error message and provide a retry link.
8. WHEN the `app/uninstalled` webhook is received, THE App SHALL mark the Shop as inactive and revoke the stored access token.
9. THE App SHALL support Shopify's online and offline access token modes, using offline tokens for background API calls.

---

### Requirement 2: Subscription Billing

**User Story:** As a Merchant, I want to subscribe to a pricing plan, so that I can access the features appropriate for my store's size.

#### Acceptance Criteria

1. WHEN a Merchant accesses the billing page, THE App SHALL display the three available plans — STARTER ($29/mo), GROWTH ($79/mo), and PRO ($199/mo) — with a feature comparison.
2. WHEN a Merchant selects a plan, THE App SHALL create a Shopify recurring application charge via the Shopify Billing API and redirect the Merchant to the Shopify approval URL.
3. WHEN Shopify confirms a charge approval, THE App SHALL update the Shop's plan field to the selected plan and activate the corresponding feature set.
4. WHEN a Merchant attempts to use a feature not included in their current plan, THE App SHALL display an upgrade prompt identifying the required plan.
5. WHEN a Merchant upgrades their plan, THE App SHALL cancel the existing charge and create a new charge for the higher tier.
6. IF a Shopify charge is declined or cancelled, THEN THE App SHALL retain the Shop on their previous plan and notify the Merchant.
7. THE App SHALL apply Shopify's 20% revenue share to all charges by using the Shopify Billing API as the sole payment processor.
8. WHILE a Shop's plan is STARTER, THE App SHALL enforce limits of 5,000 emails per month, 500 WhatsApp messages per month, and 100 AI conversations per month.
9. WHILE a Shop's plan is GROWTH, THE App SHALL enforce limits of 25,000 emails per month, 2,000 WhatsApp messages per month, and 500 AI conversations per month.
10. WHILE a Shop's plan is PRO, THE App SHALL enforce limits of 100,000 emails per month, 10,000 WhatsApp messages per month, and 2,000 AI conversations per month.

---

### Requirement 3: Project Folder Structure and Base Setup

**User Story:** As a developer, I want a well-organized project structure, so that I can build and maintain each module independently without conflicts.

#### Acceptance Criteria

1. THE App SHALL use the Remix framework with the directory layout defined in the project specification, including `app/routes/`, `workers/`, `extensions/`, and `prisma/` top-level directories.
2. THE App SHALL provide a single `prisma/schema.prisma` file containing all model definitions for Shop, Session, Customer, Review, ReviewRequest, Campaign, Automation, EmailSend, LoyaltyProgram, LoyaltyTransaction, ReferralProgram, Referral, Upsell, ChatSettings, ChatConversation, ChatMessage, AnalyticsEvent, SeoSettings, SeoIssue, and WebhookEvent.
3. THE App SHALL provide server-side client modules at `app/shopify.server.ts`, `app/db.server.ts`, `app/redis.server.ts`, `app/meilisearch.server.ts`, and `app/r2.server.ts`.
4. THE App SHALL provide a `workers/index.ts` entry point that initializes BullMQ queues for EMAIL, SMS, WEBHOOK, REVIEW_REQUEST, SEO_AUDIT, ANALYTICS, and SEARCH_INDEX.
5. THE App SHALL provide an `ecosystem.config.js` PM2 configuration that runs the Remix app in cluster mode with 2 instances, the BullMQ worker process, and the Meilisearch process.
6. THE App SHALL provide a `.env.example` file documenting all required environment variables without exposing secret values.
7. WHEN the application starts, THE App SHALL validate that all required environment variables are present and exit with a descriptive error message if any are missing.
8. THE App SHALL provide an `extensions/` directory with placeholder scaffolding for five Theme App Extensions: `review-widget`, `upsell-widget`, `fomo-widget`, `chat-widget`, and `loyalty-widget`.

---

### Requirement 4: Reviews Module

**User Story:** As a Merchant, I want to collect and display product reviews, so that I can build social proof and increase conversion rates.

#### Acceptance Criteria

1. WHEN an order is fulfilled, THE App SHALL schedule a ReviewRequest job in the BullMQ REVIEW_REQUEST queue with a configurable delay (default: 7 days after fulfillment).
2. WHEN a ReviewRequest job is processed, THE App SHALL send a review request email via Brevo containing a unique, tokenized review submission link.
3. WHEN a Customer submits a review via the tokenized link, THE App SHALL validate the token, accept a rating (1–5), optional title, optional body text, and up to 5 photo attachments.
4. WHEN a Customer uploads review photos, THE App SHALL upload each photo to Cloudflare R2 under the key pattern `reviews/{shopId}/{reviewId}/{filename}` and store the resulting public CDN URL in the Review record.
5. WHEN a review is submitted, THE App SHALL mark it as pending approval and notify the Merchant via the dashboard.
6. WHEN a Merchant approves a review, THE App SHALL set the review's `isPublished` flag to true, making it visible in the storefront Widget.
7. THE App SHALL provide a review moderation dashboard where the Merchant can view, approve, reject, and respond to reviews.
8. THE review-widget Theme App Extension SHALL display approved reviews on product pages, including star rating, reviewer name, verified purchase badge, review body, and photo thumbnails.
9. THE review-widget SHALL render an aggregate star rating and total review count at the top of the reviews section.
10. WHEN a Customer marks a review as helpful, THE App SHALL increment the `helpfulCount` field on the Review record.
11. WHERE the GROWTH or PRO plan is active, THE App SHALL use the Groq_API to analyze review sentiment and store the result (positive / neutral / negative) on the Review record.
12. IF a review photo upload fails, THEN THE App SHALL return a descriptive error to the Customer and allow resubmission without losing other form data.

---

### Requirement 5: FOMO and Social Proof Popups

**User Story:** As a Merchant, I want to show real-time purchase notifications on my storefront, so that I can create urgency and increase conversion rates.

#### Acceptance Criteria

1. WHEN an order is created via the `orders/create` webhook, THE App SHALL publish a FOMO event to the relevant Shop's Socket.io room.
2. THE fomo-widget Theme App Extension SHALL connect to the App's Socket.io server and display a popup notification when a FOMO event is received.
3. THE fomo-widget SHALL display the buyer's first name (or "Someone"), the product title, and a relative timestamp (e.g., "2 minutes ago").
4. THE fomo-widget SHALL auto-dismiss each popup after a configurable duration (default: 5 seconds).
5. WHEN no real-time orders are available, THE App SHALL optionally display recent historical orders from the past 48 hours as FOMO events, cycling through them at a configurable interval.
6. THE App SHALL provide a FOMO settings page where the Merchant can configure popup position (bottom-left, bottom-right), display duration, and whether to show historical orders.
7. WHILE a Visitor is on a product page, THE fomo-widget SHALL only show FOMO events relevant to the currently viewed product.
8. IF the Socket.io connection is unavailable, THEN THE fomo-widget SHALL fall back to polling the App's REST API for recent orders at 30-second intervals.

---

### Requirement 6: Upsell Widgets

**User Story:** As a Merchant, I want to present upsell offers at key moments in the purchase journey, so that I can increase average order value.

#### Acceptance Criteria

1. THE App SHALL support four upsell placement types: `post_purchase` (thank-you page), `cart` (cart drawer/page), `product_page`, and `thank_you`.
2. WHEN a Customer completes a purchase, THE upsell-widget SHALL display a post-purchase upsell offer on the Shopify thank-you page before the Customer leaves.
3. WHEN a Customer views the cart, THE upsell-widget SHALL display a sticky add-to-cart bar with a complementary product recommendation.
4. WHEN a Customer accepts a post-purchase upsell, THE App SHALL add the upsell product to the original order using the Shopify Orders API without requiring the Customer to re-enter payment details.
5. THE App SHALL provide an upsell editor where the Merchant can select the upsell product, set an optional discount percentage, write a headline, and preview the widget appearance.
6. WHEN an upsell is displayed, THE App SHALL increment the `impressions` counter on the Upsell record.
7. WHEN a Customer accepts an upsell offer, THE App SHALL increment the `conversions` counter and add the order revenue to the `revenue` field on the Upsell record.
8. THE App SHALL display upsell performance metrics (impression count, conversion rate, revenue generated) on the upsell dashboard.
9. WHERE the GROWTH or PRO plan is active, THE App SHALL support multiple active upsell offers and A/B test them by rotating offers and tracking per-variant conversion rates.

---

### Requirement 7: Email Marketing

**User Story:** As a Merchant, I want to send targeted email campaigns and automated sequences to my subscribers, so that I can drive repeat purchases and recover lost revenue.

#### Acceptance Criteria

1. THE App SHALL provide a block-based email template editor where the Merchant can compose emails using text, image, button, divider, and product blocks.
2. WHEN a Merchant saves an email template, THE App SHALL render the block JSON into a valid HTML email and cache the result in the `templateHtml` field.
3. WHEN a Merchant schedules a Campaign, THE App SHALL enqueue one EMAIL job per recipient in the BullMQ EMAIL queue at the scheduled time.
4. WHEN an EMAIL job is processed, THE App SHALL send the email via the Brevo API and record the Brevo message ID in the EmailSend record.
5. THE App SHALL track email open and click events by embedding a 1×1 tracking pixel and wrapping links with a redirect through the App's tracking endpoint.
6. WHEN an open or click event is recorded, THE App SHALL update the `openedAt` or `clickedAt` field on the corresponding EmailSend record and increment the Campaign's `openCount` or `clickCount`.
7. THE App SHALL provide the following Automation triggers: `abandoned_cart`, `welcome`, `win_back`, `post_purchase`, and `birthday`.
8. WHEN the `checkouts/update` webhook indicates a checkout has been abandoned for longer than the configured delay, THE App SHALL enqueue an abandoned cart Automation email for the Customer.
9. WHEN a new Customer is created via the `customers/create` webhook and the welcome Automation is active, THE App SHALL enqueue a welcome email for that Customer.
10. THE App SHALL provide a subscriber list view with search, filter by opt-in status, and the ability to manually unsubscribe a Customer.
11. WHEN a Customer clicks an unsubscribe link, THE App SHALL set `isSubscribed` to false on the Customer record and suppress all future marketing emails to that address.
12. IF the Brevo API returns a bounce or spam complaint for an email address, THEN THE App SHALL automatically set `isSubscribed` to false for the corresponding Customer.
13. WHILE a Shop's monthly email send count has reached the plan limit, THE App SHALL reject new Campaign sends and display a quota warning to the Merchant.
14. THE App SHALL display Campaign analytics including recipient count, open rate, click rate, and attributed revenue on the campaign detail page.

---

### Requirement 8: Loyalty Program

**User Story:** As a Merchant, I want to reward customers with points for purchases and actions, so that I can increase customer retention and lifetime value.

#### Acceptance Criteria

1. WHEN a Merchant activates the Loyalty Program, THE App SHALL create a LoyaltyProgram record for the Shop with configurable points-per-dollar, signup bonus, review bonus, and referral bonus values.
2. WHEN an order is paid via the `orders/paid` webhook, THE App SHALL calculate loyalty points earned based on the order subtotal and the Shop's `pointsPerDollar` setting and create a LoyaltyTransaction record of type `earn`.
3. WHEN a Customer submits an approved review, THE App SHALL create a LoyaltyTransaction of type `earn` with the Shop's `pointsForReview` value.
4. WHEN a new Customer creates an account, THE App SHALL create a LoyaltyTransaction of type `earn` with the Shop's `pointsForSignup` value.
5. WHEN a Customer redeems points, THE App SHALL create a Shopify discount code via the Shopify Discount API with a value equal to `points × rewardValue` and create a LoyaltyTransaction of type `redeem`.
6. THE App SHALL store the Customer's current point balance as the sum of all LoyaltyTransaction records for that Customer.
7. THE loyalty-widget Theme App Extension SHALL display the Customer's current point balance and available reward value on the storefront.
8. THE App SHALL provide a loyalty dashboard showing total points issued, total points redeemed, top earners, and program ROI.
9. WHERE the GROWTH or PRO plan is active, THE App SHALL support VIP tiers defined in the LoyaltyProgram `tiers` JSON field, automatically assigning Customers to tiers based on their cumulative point balance.
10. WHEN a Customer's point balance changes, THE App SHALL update the `loyaltyPoints` and `loyaltyTier` fields on the Customer record.
11. IF a loyalty points redemption would result in a negative Customer balance, THEN THE App SHALL reject the redemption and return an error message.

---

### Requirement 9: Live Chat and AI Chatbot

**User Story:** As a Merchant, I want to provide real-time chat support on my storefront with AI assistance, so that I can answer customer questions and reduce support workload.

#### Acceptance Criteria

1. WHEN a Visitor initiates a chat on the storefront, THE App SHALL create a ChatConversation record and assign a unique `visitorId` to the session.
2. THE chat-widget Theme App Extension SHALL establish a Socket.io connection to the App server and display an inbox UI for real-time message exchange.
3. WHEN a Visitor sends a message, THE App SHALL store the message as a ChatMessage record with `sender` set to `customer` and broadcast it to the Merchant's agent inbox via Socket.io.
4. WHEN a Merchant agent sends a reply, THE App SHALL store the message as a ChatMessage record with `sender` set to `agent` and deliver it to the Visitor's chat widget via Socket.io.
5. WHILE the AI chatbot is enabled for a Shop, THE App SHALL automatically respond to incoming Visitor messages using the Groq_API when no agent is available within 30 seconds.
6. WHEN the Groq_API generates a chatbot reply, THE App SHALL store the message as a ChatMessage record with `sender` set to `ai` and deliver it to the Visitor via Socket.io.
7. THE App SHALL provide the Groq_API with a system prompt containing the Shop's name and a list of the Shop's product titles as context.
8. WHEN a Merchant resolves a conversation, THE App SHALL set the ChatConversation `status` to `resolved` and record the `resolvedAt` timestamp.
9. THE App SHALL provide a chat inbox dashboard where the Merchant can view all open conversations, respond to messages, and see conversation history.
10. IF the Socket.io connection drops, THEN THE chat-widget SHALL attempt to reconnect with exponential backoff up to a maximum of 5 retry attempts.
11. WHILE a Shop's monthly AI conversation count has reached the plan limit, THE App SHALL disable AI auto-responses and notify the Merchant.
12. THE App SHALL allow the Merchant to configure the chat widget color, welcome message, and AI personality from the chat settings page.

---

### Requirement 10: Analytics Dashboard

**User Story:** As a Merchant, I want to see first-party analytics for my store's traffic and revenue, so that I can make data-driven decisions without relying on third-party cookies.

#### Acceptance Criteria

1. THE App SHALL provide a first-party JavaScript Pixel that Merchants embed in their storefront via a Shopify Script Tag.
2. WHEN the Pixel is loaded on a storefront page, THE Pixel SHALL send a `page_view` event to the App's `/api/pixel` endpoint, including the session ID, visitor ID, page URL, UTM parameters, and user agent.
3. WHEN a Customer adds a product to the cart, THE Pixel SHALL send an `add_to_cart` event including the product ID and variant ID.
4. WHEN a Customer completes a purchase, THE App SHALL record a `purchase` AnalyticsEvent via the `orders/paid` webhook, including order ID, revenue, and UTM attribution data.
5. THE App SHALL display a main analytics dashboard showing total revenue, total orders, average order value, and unique visitors for a selectable date range.
6. THE App SHALL display a channel attribution report showing revenue and order count broken down by UTM source and medium.
7. WHERE the GROWTH or PRO plan is active, THE App SHALL display a customer lifetime value (LTV) report and cohort retention chart.
8. THE App SHALL aggregate raw AnalyticsEvent records into daily summary statistics via a BullMQ ANALYTICS job to support fast dashboard queries.
9. IF an analytics event payload fails validation, THEN THE App SHALL discard the event and log the error to Sentry without returning an error to the Pixel.
10. THE Pixel SHALL not set any third-party cookies and SHALL use a first-party session identifier stored in localStorage.

---

### Requirement 11: Referral Program

**User Story:** As a Merchant, I want to reward customers for referring their friends, so that I can acquire new customers at low cost.

#### Acceptance Criteria

1. WHEN a Merchant activates the Referral Program, THE App SHALL generate a unique referral code for each existing Customer and store it in the `referralCode` field.
2. WHEN a new Customer is created, THE App SHALL generate and assign a unique referral code to that Customer.
3. WHEN a Visitor uses a referral link containing a referral code, THE App SHALL create a Referral record with status `pending` and store the referral code in the Visitor's session.
4. WHEN the referred Visitor creates an account, THE App SHALL update the Referral status to `signed_up` and link the new Customer record.
5. WHEN the referred Customer completes their first purchase, THE App SHALL update the Referral status to `purchased`, create a Shopify discount code for the referring Customer (advocate reward), and apply the friend discount to the referred Customer's order.
6. WHEN a referral reward is issued, THE App SHALL create a LoyaltyTransaction of type `earn` with the Shop's `pointsForReferral` value for the referring Customer.
7. THE App SHALL provide a referral dashboard showing total referrals, conversion rate (referral to purchase), and total revenue attributed to referrals.
8. THE App SHALL provide a shareable referral link and social sharing buttons (copy link, email, WhatsApp) in the loyalty-widget on the storefront.
9. IF a Customer attempts to use their own referral code, THEN THE App SHALL reject the referral and display an error message.

---

### Requirement 12: SEO Module

**User Story:** As a Merchant, I want my store's SEO to be automatically optimized, so that I can rank higher in search engines without manual effort.

#### Acceptance Criteria

1. WHEN a Merchant enables the SEO Module, THE App SHALL enqueue an SEO_AUDIT job in the BullMQ SEO_AUDIT queue for the Shop.
2. WHEN an SEO_AUDIT job is processed, THE App SHALL fetch all products and pages from the Shop via the Shopify API and check each for missing meta titles, missing meta descriptions, missing image alt text, and missing structured data (schema.org).
3. WHEN an SEO issue is detected, THE App SHALL create an SeoIssue record with the appropriate type, severity, resource URL, and description.
4. THE App SHALL display an SEO audit dashboard showing the overall audit score, a breakdown of issues by severity (critical, warning, info), and a list of individual issues with fix recommendations.
5. WHEN the Merchant enables auto meta tags, THE App SHALL use the Groq_API to generate an SEO-optimized meta title and meta description for each product lacking them and update the product via the Shopify Products API.
6. WHEN the Merchant enables auto alt text, THE App SHALL use the Groq_API to generate descriptive alt text for each product image lacking it and update the image via the Shopify Products API.
7. WHEN the Merchant enables auto schema, THE App SHALL inject Product schema.org JSON-LD markup into each product page via a Shopify Script Tag.
8. WHEN a product is created or updated via the `products/create` or `products/update` webhook, THE App SHALL enqueue a targeted SEO check for that product.
9. WHEN an SEO issue is resolved (either automatically or manually), THE App SHALL set the `isFixed` flag on the SeoIssue record to true.
10. IF the Groq_API returns an error during meta tag generation, THEN THE App SHALL log the error to Sentry, skip the affected product, and continue processing remaining products.

---

### Requirement 13: Webhook Processing

**User Story:** As a developer, I want all Shopify webhooks to be processed reliably and idempotently, so that no events are lost and no side effects are duplicated.

#### Acceptance Criteria

1. WHEN the App receives a Shopify webhook, THE App SHALL verify the HMAC signature using the Shopify API secret before processing the payload.
2. IF the HMAC signature verification fails, THEN THE App SHALL return HTTP 401 and discard the payload without processing.
3. WHEN a verified webhook is received, THE App SHALL create a WebhookEvent record with status `pending` and enqueue a WEBHOOK job in the BullMQ WEBHOOK queue.
4. WHEN a WEBHOOK job is processed, THE App SHALL check whether a WebhookEvent with the same Shopify resource ID and topic already has status `processed` and skip processing if so.
5. WHEN a WEBHOOK job completes successfully, THE App SHALL update the WebhookEvent status to `processed` and record the `processedAt` timestamp.
6. IF a WEBHOOK job throws an unhandled exception, THEN THE App SHALL update the WebhookEvent status to `failed`, store the error message, and allow BullMQ to retry the job up to 3 times with exponential backoff.
7. THE App SHALL register the following webhook topics on app installation: `orders/create`, `orders/updated`, `orders/fulfilled`, `orders/paid`, `customers/create`, `customers/update`, `checkouts/create`, `checkouts/update`, `products/create`, `products/update`, `products/delete`, and `app/uninstalled`.
8. THE App SHALL return HTTP 200 to Shopify within 5 seconds of receiving a webhook, deferring all processing to the BullMQ queue.

---

### Requirement 14: File Storage

**User Story:** As a developer, I want all user-uploaded files to be stored in Cloudflare R2, so that the VPS disk is not used for file storage and files are served via CDN.

#### Acceptance Criteria

1. THE App SHALL use the AWS S3-compatible Cloudflare R2 API for all file upload and delete operations.
2. WHEN a file is uploaded, THE App SHALL store it under a structured key following the pattern `{module}/{shopId}/{resourceId}/{filename}`.
3. WHEN a file is uploaded successfully, THE App SHALL return the public CDN URL in the format `{R2_PUBLIC_URL}/{key}`.
4. WHEN a Review is deleted, THE App SHALL delete all associated photo and video files from R2.
5. THE App SHALL enforce a maximum file size of 10 MB per upload for review photos.
6. THE App SHALL accept only image file types (JPEG, PNG, WebP, GIF) for review photo uploads.
7. IF an R2 upload operation fails, THEN THE App SHALL retry the upload once and, if the retry also fails, return a descriptive error to the caller.

---

### Requirement 15: Search and Indexing

**User Story:** As a Merchant, I want fast search across my customers and products within the app dashboard, so that I can quickly find records without waiting for database queries.

#### Acceptance Criteria

1. THE App SHALL use Meilisearch as the search backend for customer and product search within the merchant dashboard.
2. WHEN a Customer record is created or updated, THE App SHALL enqueue a SEARCH_INDEX job to upsert the Customer document in the Meilisearch `customers` index.
3. WHEN a product is created or updated via a Shopify webhook, THE App SHALL enqueue a SEARCH_INDEX job to upsert the product document in the Meilisearch `products` index.
4. WHEN a product is deleted via the `products/delete` webhook, THE App SHALL enqueue a SEARCH_INDEX job to remove the product document from the Meilisearch `products` index.
5. WHEN a Merchant performs a search in the dashboard, THE App SHALL query Meilisearch and return results within 100 milliseconds for indexes containing up to 100,000 documents.
6. THE App SHALL configure Meilisearch to listen only on `127.0.0.1:7700` and SHALL NOT expose the Meilisearch port publicly.

---

### Requirement 16: Security and Infrastructure

**User Story:** As a developer, I want the application infrastructure to be secure and resilient, so that merchant data is protected and the service remains available.

#### Acceptance Criteria

1. THE App SHALL terminate SSL at Nginx using Let's Encrypt certificates and redirect all HTTP traffic to HTTPS.
2. THE App SHALL configure UFW to allow only SSH (port 22) and Nginx Full (ports 80 and 443), blocking direct access to PostgreSQL (5432), Redis (6379), and Meilisearch (7700).
3. THE App SHALL store all secrets (API keys, database passwords, session secrets) exclusively in environment variables and SHALL NOT commit secret values to version control.
4. THE App SHALL use parameterized queries via Prisma ORM for all database operations to prevent SQL injection.
5. THE App SHALL validate and sanitize all user-supplied input before storing it in the database or passing it to external APIs.
6. THE App SHALL use PM2 in cluster mode with 2 instances to provide zero-downtime restarts and basic load distribution.
7. WHEN the application crashes, PM2 SHALL automatically restart the process within 5 seconds.
8. THE App SHALL send error events to Sentry for all unhandled exceptions in both the Remix application and BullMQ workers.
9. THE App SHALL use Nginx as a reverse proxy, forwarding requests to the Node.js application on `127.0.0.1:3000`.
10. THE App SHALL configure Nginx with WebSocket upgrade headers for the `/socket.io/` path to support live chat and FOMO real-time features.
11. THE Session secret SHALL be a randomly generated string of at least 32 characters.
12. THE Meilisearch master key SHALL be a randomly generated string of at least 16 characters.
