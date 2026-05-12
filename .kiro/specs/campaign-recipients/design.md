# Design Document: Campaign Recipients

## Overview

This feature extends the existing Email Campaigns page (`app/routes/app.email.campaigns.tsx`) with a campaign creation wizard and recipient selection capabilities. The implementation adds a "New Campaign" button, a multi-step wizard modal (Subject → Content → Recipients → Review), three recipient selection modes (All Subscribers, Customer Segments, Manual Entry), a recipient count preview, and a send action that resolves recipients and delivers emails via the existing Brevo integration.

The design leverages the existing Prisma Campaign model, Customer model, EmailSend model, BullMQ email queue, and `brevo.server.ts` utility. No schema migrations are required — the existing `Campaign` model already has all necessary fields. The recipient selection logic is implemented as a server-side resolver that runs at send time to ensure freshness.

## Architecture

```mermaid
graph TD
    A[Campaigns List Page] -->|Click "New Campaign"| B[Campaign Wizard Modal]
    B --> C[Step 1: Subject]
    C --> D[Step 2: Content]
    D --> E[Step 3: Recipients]
    E --> F[Step 4: Review]
    
    E --> G[Recipient Selector]
    G --> H[All Subscribers]
    G --> I[Customer Segments]
    G --> J[Manual Entry]
    
    F -->|Send Campaign| K[Campaign Send Action]
    K --> L[Resolve Recipients]
    L --> M[Quota Check]
    M --> N[Create EmailSend Records]
    N --> O[Enqueue BullMQ Jobs]
    O --> P[Email Worker]
    P --> Q[Brevo API]
```

The architecture follows the existing pattern in the codebase:
- **UI Layer**: Remix route with Polaris components, wizard state managed in React state
- **Action Layer**: Remix action handler processes form submissions for draft saves and campaign sends
- **Resolver Layer**: Server-side functions that resolve recipient lists based on mode and filters
- **Queue Layer**: BullMQ EMAIL queue (already exists) processes individual email deliveries
- **Delivery Layer**: Existing `email.worker.ts` sends via Brevo API

## Components and Interfaces

### 1. Campaign Wizard Component

A modal-based multi-step wizard rendered within the campaigns page.

```typescript
// Wizard state interface
interface CampaignWizardState {
  currentStep: 'subject' | 'content' | 'recipients' | 'review';
  name: string;
  subject: string;
  templateJson: EmailBlock[];
  recipientMode: RecipientMode;
  segmentFilters: SegmentFilters;
  manualEmails: string;
  recipientCount: number;
}

type RecipientMode = 'all_subscribers' | 'customer_segment' | 'manual_entry';

interface SegmentFilters {
  loyaltyTier?: string;
  minTotalOrders?: number;
  minTotalSpent?: number;
}
```

### 2. Recipient Resolver (Server-side)

```typescript
// app/utils/recipient-resolver.server.ts

interface ResolvedRecipients {
  emails: string[];
  count: number;
  customerIds: string[]; // empty for manual entry mode
}

function resolveRecipients(
  shopId: string,
  mode: RecipientMode,
  segmentFilters: SegmentFilters,
  manualEmails: string
): Promise<ResolvedRecipients>;

function resolveAllSubscribers(shopId: string): Promise<ResolvedRecipients>;

function resolveSegment(
  shopId: string,
  filters: SegmentFilters
): Promise<ResolvedRecipients>;

function parseManualEmails(input: string): ResolvedRecipients;
```

### 3. Recipient Count Preview (Server-side)

```typescript
// Fetcher-based count preview
// POST /app/email/campaigns?intent=preview_count
interface PreviewCountRequest {
  intent: 'preview_count';
  recipientMode: RecipientMode;
  segmentFilters?: string; // JSON stringified SegmentFilters
  manualEmails?: string;
}

interface PreviewCountResponse {
  count: number;
  quotaRemaining: number;
  quotaExceeded: boolean;
}
```

### 4. Campaign Send Action (Server-side)

Extends the existing action handler in `app.email.campaigns.tsx` with a new `create_and_send` intent.

```typescript
// POST /app/email/campaigns
interface CreateAndSendRequest {
  intent: 'create_and_send';
  name: string;
  subject: string;
  templateJson: string; // JSON stringified EmailBlock[]
  recipientMode: RecipientMode;
  segmentFilters?: string; // JSON stringified
  manualEmails?: string;
}
```

### 5. Email Parsing Utility

```typescript
// app/utils/email-parser.server.ts

interface ParsedEmails {
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
}

function parseAndValidateEmails(input: string): ParsedEmails;
function isValidEmail(email: string): boolean;
```

## Data Models

No schema changes are required. The existing models support this feature:

### Campaign (existing)
```prisma
model Campaign {
  id              String   @id @default(cuid())
  shopId          String
  name            String
  subject         String
  previewText     String?
  templateJson    Json
  templateHtml    String?
  status          String   @default("draft") // draft | sending | sent | scheduled
  scheduledAt     DateTime?
  sentAt          DateTime?
  recipientCount  Int      @default(0)
  openCount       Int      @default(0)
  clickCount      Int      @default(0)
  revenue         Float    @default(0)
  // ...
}
```

### Recipient Mode Storage

The recipient mode and filters are stored in the Campaign's `templateJson` field as metadata alongside the email blocks, or as a separate JSON field. Since the schema doesn't have a dedicated `recipientConfig` field, we'll store it within a wrapper structure:

```typescript
interface CampaignData {
  blocks: EmailBlock[];
  recipientConfig: {
    mode: RecipientMode;
    segmentFilters?: SegmentFilters;
    manualEmails?: string[];
  };
}
```

This is stored in `templateJson` and parsed at send time.

### Customer (existing, used for queries)
```prisma
model Customer {
  email           String
  isSubscribed    Boolean  @default(true)
  loyaltyTier     String?
  totalOrders     Int      @default(0)
  totalSpent      Float    @default(0)
  // ...
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Wizard subject step validation

*For any* pair of strings (name, subject), the wizard SHALL allow progression from the Subject step if and only if both strings are non-empty after trimming whitespace.

**Validates: Requirements 2.2**

### Property 2: Review step displays all campaign data

*For any* valid campaign wizard state (with non-empty name, subject, at least one block, and at least one recipient), the review step summary SHALL contain the campaign name, subject line, recipient mode label, and recipient count.

**Validates: Requirements 2.5**

### Property 3: Wizard state preservation on navigation

*For any* campaign wizard state at any step, navigating backward to a previous step and then forward again SHALL produce a state identical to the original state for all fields entered in prior steps.

**Validates: Requirements 2.7**

### Property 4: All Subscribers resolution returns exactly subscribed customers

*For any* set of Customer records belonging to a shop, the All Subscribers resolver SHALL return exactly those customers whose `isSubscribed` field is true, and the count SHALL equal the length of the returned list.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Segment filter AND composition with subscription check

*For any* set of Customer records and any combination of segment filters (loyaltyTier, minTotalOrders, minTotalSpent), the segment resolver SHALL return exactly those customers who satisfy ALL active filters AND have `isSubscribed` equal to true. The returned count SHALL equal the length of the returned list.

**Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6**

### Property 6: Email parsing, validation, and deduplication

*For any* input string containing email addresses separated by commas, semicolons, or newlines, the email parser SHALL extract all substrings, validate each against the email format, deduplicate valid entries (case-insensitive), and return a count equal to the number of unique valid addresses.

**Validates: Requirements 5.2, 5.3, 5.4, 5.5**

### Property 7: Quota exceeded detection

*For any* recipient count and remaining email quota, the quota check SHALL flag the send as exceeding quota if and only if the recipient count is strictly greater than the remaining quota.

**Validates: Requirements 6.3, 7.2**

### Property 8: EmailSend records equal recipient count

*For any* resolved recipient list with N recipients, after the Campaign_Send_Action completes the enqueue phase, there SHALL exist exactly N EmailSend records with status "queued" linked to that campaign, and exactly N jobs in the email queue.

**Validates: Requirements 7.4**

### Property 9: Personalized HTML contains required elements

*For any* recipient and campaign HTML content, the personalized HTML produced for that recipient SHALL contain a tracking pixel URL, at least one wrapped link URL, and an unsubscribe link URL unique to that recipient.

**Validates: Requirements 7.5**

## Error Handling

| Error Condition | Handling Strategy |
|---|---|
| Zero subscribers for All Subscribers mode | Display inline error, disable "Next" button on Recipients step |
| Zero matches for segment filters | Display inline error, disable "Next" button |
| All manual emails invalid | Display validation errors per email, disable "Next" button |
| Email quota exceeded | Display warning banner with upgrade CTA, disable "Send Campaign" button |
| Brevo API failure for individual recipient | Mark EmailSend as "failed", BullMQ retries up to 3 times with exponential backoff |
| Campaign send with zero resolved recipients | Return error response from action, display error toast |
| Network error during recipient count preview | Show stale count with "unable to refresh" indicator, allow retry |
| Wizard closed without saving | Auto-save as draft via form submission on modal close |
| Invalid campaign name or subject (empty) | Inline validation error on the field, disable "Next" button |

## Testing Strategy

### Unit Tests (Example-based)
- Wizard step rendering and navigation
- "New Campaign" button presence and click behavior
- Empty state rendering
- Filter control rendering for segment mode
- Manual entry text area rendering
- Review step summary rendering
- Draft save on wizard close
- Error message display for zero recipients

### Property-Based Tests
- **Library**: [fast-check](https://github.com/dubzzz/fast-check) (already compatible with the project's TypeScript/Vitest setup)
- **Minimum iterations**: 100 per property
- **Tag format**: `Feature: campaign-recipients, Property N: [title]`

Properties to implement:
1. Subject step validation (pure function)
2. Review step data completeness (render function)
3. Wizard state preservation (state management)
4. All Subscribers resolution (database query logic, tested with mock data)
5. Segment filter composition (database query logic, tested with mock data)
6. Email parsing and deduplication (pure function)
7. Quota exceeded detection (pure function)
8. EmailSend record count invariant (action logic with mocked DB)
9. Personalized HTML content (pure function)

### Integration Tests
- Full campaign creation flow (wizard → send → email delivery)
- Brevo API error handling and retry behavior
- BullMQ job processing with real worker
- Quota enforcement across plan tiers
