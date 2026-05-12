# Implementation Plan: Campaign Recipients

## Overview

This plan implements the campaign recipient selection feature by building from the bottom up: utility functions first (email parsing, recipient resolution, quota checking), then the server-side action handlers, and finally the UI wizard. Each step builds on the previous one, ensuring no orphaned code.

## Tasks

- [x] 1. Create email parsing utility
  - [x] 1.1 Create `app/utils/email-parser.server.ts` with `parseAndValidateEmails` and `isValidEmail` functions
    - Accept input string, split by commas, semicolons, or newlines
    - Validate each entry against email format regex
    - Deduplicate valid entries (case-insensitive)
    - Return `{ valid: string[], invalid: string[], duplicatesRemoved: number }`
    - _Requirements: 5.2, 5.3, 5.4, 5.5_
  - [ ]* 1.2 Write property test for email parsing and deduplication
    - **Property 6: Email parsing, validation, and deduplication**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**

- [ ] 2. Create recipient resolver utility
  - [-] 2.1 Create `app/utils/recipient-resolver.server.ts` with resolver functions
    - Implement `resolveAllSubscribers(shopId)` — queries customers with `isSubscribed=true`
    - Implement `resolveSegment(shopId, filters)` — queries customers matching all active filters AND `isSubscribed=true`
    - Implement `resolveManualEmails(input)` — delegates to email parser, returns valid unique emails
    - Implement `resolveRecipients(shopId, mode, segmentFilters, manualEmails)` — dispatches to correct resolver based on mode
    - Return `{ emails: string[], count: number, customerIds: string[] }`
    - _Requirements: 3.1, 3.3, 4.2, 4.3, 4.4, 4.5, 7.1_
  - [ ]* 2.2 Write property test for All Subscribers resolution
    - **Property 4: All Subscribers resolution returns exactly subscribed customers**
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [ ]* 2.3 Write property test for segment filter composition
    - **Property 5: Segment filter AND composition with subscription check**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6**

- [ ] 3. Create quota check utility
  - [-] 3.1 Create `app/utils/campaign-quota.server.ts` with `checkCampaignQuota` function
    - Accept `shopId`, `plan`, and `recipientCount`
    - Use existing `isWithinEmailQuota` from `plan-limits.server.ts`
    - Return `{ allowed: boolean, remaining: number, exceeded: boolean }`
    - _Requirements: 6.3, 7.2_
  - [ ]* 3.2 Write property test for quota exceeded detection
    - **Property 7: Quota exceeded detection**
    - **Validates: Requirements 6.3, 7.2**

- [~] 4. Checkpoint - Ensure all utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement campaign send action
  - [~] 5.1 Add `create_and_send` intent to the action handler in `app/routes/app.email.campaigns.tsx`
    - Parse form data: name, subject, templateJson, recipientMode, segmentFilters, manualEmails
    - Create Campaign record with status "draft"
    - Call `resolveRecipients` to get final recipient list
    - Reject with error if zero recipients
    - Call quota check, reject if exceeded
    - Update campaign status to "sending", set recipientCount
    - Render HTML from template blocks using existing `renderEmailHtml`
    - Create EmailSend records per recipient
    - Inject tracking pixel, link wrapping, and unsubscribe link per recipient using existing utilities
    - Enqueue EMAIL jobs in BullMQ queue per recipient
    - Update campaign status to "sent", set sentAt
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9_
  - [~] 5.2 Add `save_draft` intent to the action handler
    - Parse form data: name, subject, templateJson, recipientMode, segmentFilters, manualEmails
    - Create or update Campaign record with status "draft"
    - Store recipient config in templateJson wrapper structure
    - _Requirements: 2.8_
  - [~] 5.3 Add `preview_count` intent to the action handler
    - Parse recipientMode, segmentFilters, manualEmails from form data
    - Call `resolveRecipients` to get count (without full email list for performance)
    - Return count and quota info
    - _Requirements: 3.2, 4.6, 5.4, 6.1, 6.2_
  - [ ]* 5.4 Write property test for EmailSend record count invariant
    - **Property 8: EmailSend records equal recipient count**
    - **Validates: Requirements 7.4**
  - [ ]* 5.5 Write property test for personalized HTML content
    - **Property 9: Personalized HTML contains required elements**
    - **Validates: Requirements 7.5**

- [~] 6. Checkpoint - Ensure send action tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement Campaign Wizard UI
  - [~] 7.1 Add "New Campaign" button and wizard modal shell to `app/routes/app.email.campaigns.tsx`
    - Add "New Campaign" button in page header (visible always, including empty state)
    - Create modal component with step indicator (Subject, Content, Recipients, Review)
    - Manage wizard state in React useState
    - Wire modal open/close to button click
    - _Requirements: 1.1, 1.2, 1.3, 2.1_
  - [~] 7.2 Implement Subject step
    - Campaign name text input with validation (non-empty after trim)
    - Email subject line text input with validation (non-empty after trim)
    - "Next" button disabled until both fields are valid
    - _Requirements: 2.2_
  - [~] 7.3 Implement Content step
    - Integrate with existing email template block editor (reuse from templates page)
    - "Next" button disabled until at least one block exists
    - "Back" button preserves subject step data
    - _Requirements: 2.3, 2.7_
  - [~] 7.4 Implement Recipients step with mode selector
    - Radio group for three modes: All Subscribers, Customer Segments, Manual Entry
    - All Subscribers: display subscriber count via fetcher calling `preview_count`
    - Customer Segments: filter controls for loyaltyTier (select), minTotalOrders (number input), minTotalSpent (number input); count updates via fetcher on filter change
    - Manual Entry: textarea for email input, parse and show valid/invalid counts
    - Recipient count preview displayed prominently
    - Quota remaining shown alongside count
    - Warning banner if count exceeds quota
    - "Next" button disabled if zero valid recipients
    - _Requirements: 3.1, 3.2, 3.4, 4.1, 4.6, 4.7, 5.1, 5.6, 6.1, 6.2, 6.3, 6.4_
  - [~] 7.5 Implement Review step
    - Display campaign name, subject, content preview (rendered HTML in iframe or sanitized div)
    - Display recipient mode label and count
    - "Send Campaign" button triggers form submission with `create_and_send` intent
    - "Back" button preserves all data
    - Success/error feedback after send
    - _Requirements: 2.4, 2.5, 2.6_
  - [ ]* 7.6 Write property test for wizard subject step validation
    - **Property 1: Wizard subject step validation**
    - **Validates: Requirements 2.2**
  - [ ]* 7.7 Write unit tests for wizard UI
    - Test "New Campaign" button renders
    - Test empty state shows button + message
    - Test step navigation preserves state
    - Test review step shows all required fields
    - _Requirements: 1.1, 1.3, 2.1, 2.5, 2.7_

- [~] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The existing `renderEmailHtml`, `injectTracking`, and `injectUnsubscribeLink` utilities are reused without modification
- The existing `emailQueue` and `email.worker.ts` handle actual Brevo delivery — no changes needed there
- No Prisma schema migration is required; the existing Campaign model supports all needed fields
- The recipient config (mode + filters + manual emails) is stored in the Campaign's `templateJson` field as a wrapper object
- Property tests use fast-check library with minimum 100 iterations each
