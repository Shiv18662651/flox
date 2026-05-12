# Requirements Document

## Introduction

This feature adds recipient selection capabilities to the Email Campaigns page in the Nexify Shopify Super-App. Currently, the campaigns page lists existing campaigns and allows scheduling sends to all subscribers, but lacks a campaign creation flow and granular recipient targeting. This feature introduces a "New Campaign" button, a multi-step campaign creation wizard (subject, content, recipients, review), and three recipient selection modes: all subscribers, customer segments (by loyalty tier, total orders, total spent), and manual email entry. A recipient count preview is shown before sending, and the campaign send action resolves recipients and delivers emails via the existing Brevo API integration.

---

## Glossary

- **App**: The Nexify Shopify Super-App platform.
- **Merchant**: The owner or operator of a Shop who creates and sends campaigns.
- **Campaign_Wizard**: The multi-step UI flow for creating a new campaign (subject, content, recipients, review).
- **Recipient_Selector**: The UI component within the Campaign_Wizard that allows the Merchant to choose recipients.
- **Recipient_Mode**: One of three selection strategies: All_Subscribers, Customer_Segment, or Manual_Entry.
- **All_Subscribers**: A Recipient_Mode that targets all Customers with `isSubscribed` set to true.
- **Customer_Segment**: A Recipient_Mode that targets Customers matching filter criteria (loyalty tier, total orders threshold, total spent threshold).
- **Manual_Entry**: A Recipient_Mode that targets a list of email addresses typed or pasted by the Merchant.
- **Recipient_Count_Preview**: A numeric display showing how many email addresses will receive the campaign before the Merchant confirms sending.
- **Campaign_Send_Action**: The server-side operation that resolves the final recipient list, creates EmailSend records, and enqueues email jobs via BullMQ for delivery through Brevo.
- **Brevo**: The third-party transactional and marketing email delivery service.
- **BullMQ_Worker**: A background job processor that consumes jobs from Redis queues.
- **EmailSend**: A database record tracking an individual email delivery attempt.

---

## Requirements

### Requirement 1: New Campaign Button

**User Story:** As a Merchant, I want a "New Campaign" button on the campaigns list page, so that I can initiate the campaign creation flow directly from the campaigns overview.

#### Acceptance Criteria

1. WHEN the Merchant navigates to the Email Campaigns page, THE App SHALL display a "New Campaign" button in the page header area above the campaigns table.
2. WHEN the Merchant clicks the "New Campaign" button, THE App SHALL open the Campaign_Wizard starting at the first step (subject).
3. WHILE no campaigns exist in the campaigns table, THE App SHALL display the "New Campaign" button alongside an empty state message encouraging the Merchant to create their first campaign.

---

### Requirement 2: Campaign Creation Wizard

**User Story:** As a Merchant, I want a multi-step wizard for creating campaigns, so that I can configure subject, content, recipients, and review my campaign before sending.

#### Acceptance Criteria

1. THE Campaign_Wizard SHALL present four sequential steps: Subject, Content, Recipients, and Review.
2. WHEN the Merchant completes the Subject step, THE Campaign_Wizard SHALL require a non-empty campaign name and a non-empty email subject line before allowing progression to the Content step.
3. WHEN the Merchant completes the Content step, THE Campaign_Wizard SHALL require at least one content block in the email template before allowing progression to the Recipients step.
4. WHEN the Merchant completes the Recipients step, THE Campaign_Wizard SHALL require at least one valid recipient selection before allowing progression to the Review step.
5. WHEN the Merchant reaches the Review step, THE Campaign_Wizard SHALL display a summary showing the campaign name, subject line, content preview, selected recipient mode, and recipient count.
6. WHEN the Merchant clicks "Send Campaign" on the Review step, THE App SHALL execute the Campaign_Send_Action.
7. WHEN the Merchant clicks a previous step indicator, THE Campaign_Wizard SHALL navigate back to that step while preserving all previously entered data.
8. IF the Merchant closes the Campaign_Wizard before sending, THEN THE App SHALL save the campaign as a draft with all entered data preserved.

---

### Requirement 3: All Subscribers Recipient Mode

**User Story:** As a Merchant, I want to send a campaign to all my email subscribers, so that I can reach my entire opted-in audience with a single action.

#### Acceptance Criteria

1. WHEN the Merchant selects the "All Subscribers" option in the Recipient_Selector, THE App SHALL query all Customer records for the Shop where `isSubscribed` equals true.
2. WHEN the "All Subscribers" option is selected, THE App SHALL display the total count of subscribed Customers as the Recipient_Count_Preview.
3. WHEN the Campaign_Send_Action executes with "All Subscribers" mode, THE App SHALL resolve the recipient list by querying all Customers with `isSubscribed` equal to true at the time of sending.
4. IF no Customers have `isSubscribed` set to true, THEN THE App SHALL display a message indicating zero subscribers are available and prevent the Merchant from proceeding to the Review step.

---

### Requirement 4: Customer Segment Recipient Mode

**User Story:** As a Merchant, I want to send a campaign to a specific customer segment, so that I can target customers based on their loyalty tier, order count, or spending level.

#### Acceptance Criteria

1. WHEN the Merchant selects the "Customer Segment" option in the Recipient_Selector, THE App SHALL display filter controls for loyalty tier, minimum total orders, and minimum total spent.
2. WHEN the Merchant sets a loyalty tier filter, THE App SHALL include only Customers whose `loyaltyTier` field matches the selected tier value.
3. WHEN the Merchant sets a minimum total orders filter, THE App SHALL include only Customers whose `totalOrders` field is greater than or equal to the specified threshold.
4. WHEN the Merchant sets a minimum total spent filter, THE App SHALL include only Customers whose `totalSpent` field is greater than or equal to the specified threshold.
5. WHEN multiple segment filters are applied simultaneously, THE App SHALL combine them with AND logic, returning only Customers who satisfy all active filters and have `isSubscribed` equal to true.
6. WHEN segment filters are applied, THE App SHALL display the matching Customer count as the Recipient_Count_Preview, updating within 2 seconds of filter changes.
7. IF no Customers match the applied segment filters, THEN THE App SHALL display a message indicating zero matching recipients and prevent the Merchant from proceeding to the Review step.

---

### Requirement 5: Manual Entry Recipient Mode

**User Story:** As a Merchant, I want to manually enter email addresses for a campaign, so that I can send to specific people who may not be in my customer database.

#### Acceptance Criteria

1. WHEN the Merchant selects the "Manual Entry" option in the Recipient_Selector, THE App SHALL display a text input area where the Merchant can type or paste email addresses.
2. WHEN the Merchant enters email addresses, THE App SHALL accept addresses separated by commas, semicolons, or newlines.
3. WHEN email addresses are entered, THE App SHALL validate each address against a standard email format pattern and visually indicate invalid entries.
4. WHEN valid email addresses are entered, THE App SHALL display the count of valid unique addresses as the Recipient_Count_Preview.
5. WHEN duplicate email addresses are entered, THE App SHALL deduplicate them and count each unique address only once.
6. IF all entered email addresses are invalid, THEN THE App SHALL display an error message and prevent the Merchant from proceeding to the Review step.

---

### Requirement 6: Recipient Count Preview

**User Story:** As a Merchant, I want to see how many recipients will receive my campaign before I send it, so that I can verify my targeting is correct and check against my email quota.

#### Acceptance Criteria

1. WHEN a Recipient_Mode is selected and configured, THE App SHALL display the Recipient_Count_Preview as a prominent numeric value on the Recipients step.
2. WHEN the Recipient_Count_Preview is displayed, THE App SHALL also show the Merchant's remaining email quota for the current billing period.
3. IF the Recipient_Count_Preview exceeds the remaining email quota, THEN THE App SHALL display a warning indicating the campaign will exceed the plan limit and suggest upgrading.
4. WHEN the Merchant changes the Recipient_Mode or adjusts segment filters, THE App SHALL update the Recipient_Count_Preview to reflect the new selection.

---

### Requirement 7: Campaign Send Action

**User Story:** As a Merchant, I want my campaign to actually deliver emails to the resolved recipients via Brevo, so that my subscribers receive the campaign content in their inbox.

#### Acceptance Criteria

1. WHEN the Campaign_Send_Action is triggered, THE App SHALL resolve the final recipient list based on the selected Recipient_Mode and current filter criteria.
2. WHEN the recipient list is resolved, THE App SHALL check the Shop's email quota via the `isWithinEmailQuota` function and reject the send if the quota would be exceeded.
3. WHEN the quota check passes, THE App SHALL update the Campaign status to "sending" and set the `recipientCount` field to the resolved recipient count.
4. WHEN the Campaign status is set to "sending", THE App SHALL create one EmailSend record per recipient with status "queued" and enqueue one EMAIL job per recipient in the BullMQ EMAIL queue.
5. WHEN each EMAIL job is enqueued, THE App SHALL include the personalized HTML content with tracking pixel, wrapped links, and unsubscribe link injected for each recipient.
6. WHEN all EMAIL jobs are enqueued, THE App SHALL update the Campaign status to "sent" and record the `sentAt` timestamp.
7. WHEN the BullMQ_Worker processes each EMAIL job, THE App SHALL deliver the email via the existing `sendEmail` function in `brevo.server.ts` and update the EmailSend record with the Brevo message ID.
8. IF the Brevo API returns an error for a specific recipient, THEN THE App SHALL mark that EmailSend record as "failed" and allow BullMQ to retry the job up to 3 times with exponential backoff.
9. IF the recipient list resolution returns zero recipients, THEN THE App SHALL reject the send and display an error message to the Merchant.
