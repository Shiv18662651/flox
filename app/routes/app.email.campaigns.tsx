// Email campaigns route - campaign management and scheduling
// Requirements: 7.3, 7.4, 7.13, 7.14

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import { parseAndValidateEmails } from "~/utils/email-parser.server";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { isWithinEmailQuota } from "~/utils/plan-limits.server";
import { emailQueue } from "../../workers/index";
import { renderEmailHtml, injectTracking, injectUnsubscribeLink, type EmailBlock } from "~/utils/email-renderer.server";
import { resolveRecipients, type RecipientMode, type SegmentFilters } from "~/utils/recipient-resolver.server";
import { checkCampaignQuota } from "~/utils/campaign-quota.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const campaigns = await db.campaign.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return json({ campaigns, shopId: shop.id, plan: shop.plan });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // --- Intent: create_and_send ---
  // Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9
  if (intent === "create_and_send") {
    const name = formData.get("name") as string;
    const subject = formData.get("subject") as string;
    const templateJson = formData.get("templateJson") as string;
    const recipientMode = formData.get("recipientMode") as RecipientMode;
    const segmentFiltersRaw = formData.get("segmentFilters") as string | null;
    const manualEmails = (formData.get("manualEmails") as string) || "";

    if (!name || !subject || !templateJson || !recipientMode) {
      return json({ error: "Missing required fields: name, subject, templateJson, recipientMode" }, { status: 400 });
    }

    const segmentFilters: SegmentFilters = segmentFiltersRaw
      ? JSON.parse(segmentFiltersRaw)
      : {};

    const blocks: EmailBlock[] = JSON.parse(templateJson);

    // Create campaign as draft initially
    const campaign = await db.campaign.create({
      data: {
        shopId: shop.id,
        name,
        subject,
        templateJson: JSON.parse(JSON.stringify({ blocks, recipientConfig: { mode: recipientMode, segmentFilters, manualEmails } })),
        status: "draft",
      },
    });

    // Resolve recipients based on mode
    const resolved = await resolveRecipients(shop.id, recipientMode, segmentFilters, manualEmails);

    // Reject if zero recipients (Requirement 7.9)
    if (resolved.count === 0) {
      await db.campaign.delete({ where: { id: campaign.id } });
      return json({ error: "No recipients found. Please adjust your recipient selection." }, { status: 400 });
    }

    // Quota check (Requirement 7.2)
    const quotaResult = await checkCampaignQuota(shop.id, shop.plan, resolved.count);
    if (!quotaResult.allowed) {
      await db.campaign.delete({ where: { id: campaign.id } });
      return json({
        error: `Email quota exceeded. You have ${quotaResult.remaining} emails remaining but need ${resolved.count}. Please upgrade your plan.`,
      }, { status: 400 });
    }

    // Render HTML from template blocks
    const htmlContent = renderEmailHtml(blocks);

    // Update campaign status to "sending" (Requirement 7.3)
    await db.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "sending",
        recipientCount: resolved.count,
        templateHtml: htmlContent,
      },
    });

    const baseUrl = process.env.SHOPIFY_APP_URL || "https://app.example.com";

    // Create EmailSend records and enqueue jobs (Requirement 7.4, 7.5)
    for (let i = 0; i < resolved.emails.length; i++) {
      const toEmail = resolved.emails[i];
      const customerId = resolved.customerIds[i] || undefined;

      const emailSend = await db.emailSend.create({
        data: {
          shopId: shop.id,
          campaignId: campaign.id,
          toEmail,
          subject,
          status: "queued",
          ...(customerId ? { customerId } : {}),
        },
      });

      // Inject tracking pixel, link wrapping, and unsubscribe link per recipient
      let personalizedHtml = injectTracking(htmlContent, emailSend.id, baseUrl);
      if (customerId) {
        personalizedHtml = injectUnsubscribeLink(personalizedHtml, customerId, baseUrl);
      }

      await emailQueue.add("campaign-email", {
        shopId: shop.id,
        campaignId: campaign.id,
        emailSendId: emailSend.id,
        toEmail,
        subject,
        htmlContent: personalizedHtml,
      });
    }

    // Update campaign status to "sent" (Requirement 7.6)
    await db.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "sent",
        sentAt: new Date(),
      },
    });

    return json({ success: true, message: `Campaign sent to ${resolved.count} recipients` });
  }

  // --- Intent: save_draft ---
  // Requirement: 2.8
  if (intent === "save_draft") {
    const name = formData.get("name") as string;
    const subject = formData.get("subject") as string;
    const templateJson = formData.get("templateJson") as string | null;
    const recipientMode = (formData.get("recipientMode") as RecipientMode | null) || undefined;
    const segmentFiltersRaw = formData.get("segmentFilters") as string | null;
    const manualEmails = (formData.get("manualEmails") as string) || "";
    const campaignId = formData.get("campaignId") as string | null;

    if (!name || !subject) {
      return json({ error: "Name and subject are required" }, { status: 400 });
    }

    const segmentFilters: SegmentFilters = segmentFiltersRaw
      ? JSON.parse(segmentFiltersRaw)
      : {};

    const blocks: EmailBlock[] = templateJson ? JSON.parse(templateJson) : [];

    // Store recipient config in templateJson wrapper structure
    const templateData = {
      blocks,
      recipientConfig: {
        mode: recipientMode || "all_subscribers",
        segmentFilters,
        manualEmails,
      },
    };

    // Serialize to plain JSON to satisfy Prisma's InputJsonValue type
    const templateJsonValue = JSON.parse(JSON.stringify(templateData));

    if (campaignId) {
      // Update existing draft
      const existing = await db.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, shopId: true, status: true },
      });

      if (!existing || existing.shopId !== shop.id) {
        return json({ error: "Campaign not found" }, { status: 404 });
      }

      if (existing.status !== "draft") {
        return json({ error: "Only draft campaigns can be updated" }, { status: 400 });
      }

      await db.campaign.update({
        where: { id: campaignId },
        data: {
          name,
          subject,
          templateJson: templateJsonValue,
          status: "draft",
        },
      });

      return json({ success: true, campaignId, message: "Draft saved" });
    } else {
      // Create new draft
      const campaign = await db.campaign.create({
        data: {
          shopId: shop.id,
          name,
          subject,
          templateJson: templateJsonValue,
          status: "draft",
        },
      });

      return json({ success: true, campaignId: campaign.id, message: "Draft saved" });
    }
  }

  // --- Intent: preview_count ---
  // Requirements: 3.2, 4.6, 5.4, 6.1, 6.2
  if (intent === "preview_count") {
    const recipientMode = formData.get("recipientMode") as RecipientMode;
    const segmentFiltersRaw = formData.get("segmentFilters") as string | null;
    const manualEmails = (formData.get("manualEmails") as string) || "";

    if (!recipientMode) {
      return json({ error: "recipientMode is required" }, { status: 400 });
    }

    const segmentFilters: SegmentFilters = segmentFiltersRaw
      ? JSON.parse(segmentFiltersRaw)
      : {};

    const resolved = await resolveRecipients(shop.id, recipientMode, segmentFilters, manualEmails);

    const quotaResult = await checkCampaignQuota(shop.id, shop.plan, resolved.count);

    return json({
      count: resolved.count,
      quotaRemaining: quotaResult.remaining,
      quotaExceeded: quotaResult.exceeded,
    });
  }

  if (intent === "schedule") {
    const campaignId = formData.get("campaignId") as string;
    const scheduledAt = formData.get("scheduledAt") as string;

    if (!campaignId) return json({ error: "Campaign ID required" }, { status: 400 });

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, shopId: true, subject: true, templateJson: true, templateHtml: true, status: true },
    });

    if (!campaign || campaign.shopId !== shop.id) {
      return json({ error: "Campaign not found" }, { status: 404 });
    }

    if (campaign.status !== "draft") {
      return json({ error: "Only draft campaigns can be scheduled" }, { status: 400 });
    }

    // Get all subscribed customers for this shop
    const subscribers = await db.customer.findMany({
      where: { shopId: shop.id, isSubscribed: true },
      select: { id: true, email: true },
    });

    const recipientCount = subscribers.length;

    if (recipientCount === 0) {
      return json({ error: "No subscribed recipients found" }, { status: 400 });
    }

    // Check email quota
    const quotaResult = await isWithinEmailQuota(shop.id, shop.plan, recipientCount);
    if (!quotaResult.allowed) {
      return json({
        error: `Email quota exceeded. Plan limit: ${quotaResult.limit}, used: ${quotaResult.used}, needed: ${recipientCount}. Please upgrade your plan.`,
      }, { status: 400 });
    }

    // Render HTML if not already cached
    let htmlContent = campaign.templateHtml;
    if (!htmlContent) {
      const blocks = campaign.templateJson as unknown as EmailBlock[];
      htmlContent = renderEmailHtml(blocks);
    }

    const baseUrl = process.env.SHOPIFY_APP_URL || "https://app.example.com";
    const scheduleTime = scheduledAt ? new Date(scheduledAt) : new Date();
    const delayMs = Math.max(0, scheduleTime.getTime() - Date.now());

    // Update campaign status to "sending"
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        status: "sending",
        scheduledAt: scheduleTime,
        recipientCount,
      },
    });

    // Create EmailSend records and enqueue jobs for each subscriber
    for (const subscriber of subscribers) {
      // Inject tracking and unsubscribe for each recipient
      const personalizedHtml = injectUnsubscribeLink(
        injectTracking(htmlContent, "PLACEHOLDER", baseUrl),
        subscriber.id,
        baseUrl
      );

      const emailSend = await db.emailSend.create({
        data: {
          shopId: shop.id,
          customerId: subscriber.id,
          campaignId,
          toEmail: subscriber.email,
          subject: campaign.subject,
          status: "queued",
        },
      });

      // Re-inject tracking with actual emailSend ID
      const finalHtml = injectUnsubscribeLink(
        injectTracking(htmlContent, emailSend.id, baseUrl),
        subscriber.id,
        baseUrl
      );

      await emailQueue.add(
        "campaign-email",
        {
          shopId: shop.id,
          toEmail: subscriber.email,
          subject: campaign.subject,
          htmlContent: finalHtml,
          campaignId,
          customerId: subscriber.id,
        },
        { delay: delayMs }
      );
    }

    // Update campaign status to "sent" (or "scheduled" if delayed)
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        status: delayMs > 0 ? "scheduled" : "sent",
        sentAt: delayMs === 0 ? new Date() : undefined,
      },
    });

    return json({ success: true, message: `Campaign scheduled for ${recipientCount} recipients` });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}


// --- Wizard Step Types ---
type WizardStep = "subject" | "content" | "recipients" | "review";

const WIZARD_STEPS: WizardStep[] = ["subject", "content", "recipients", "review"];
const STEP_LABELS: Record<WizardStep, string> = {
  subject: "Subject",
  content: "Content",
  recipients: "Recipients",
  review: "Review",
};

export default function EmailCampaignsPage() {
  const { campaigns } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const countFetcher = useFetcher<{ count?: number; quotaRemaining?: number; quotaExceeded?: boolean }>();

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>("subject");
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("all_subscribers");
  const [segmentFilters, setSegmentFilters] = useState<SegmentFilters>({});
  const [manualEmails, setManualEmails] = useState("");
  const [recipientCount, setRecipientCount] = useState(0);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [sending, setSending] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  // Manual email parsing state
  const [parsedEmails, setParsedEmails] = useState<{ valid: string[]; invalid: string[]; duplicatesRemoved: number }>({ valid: [], invalid: [], duplicatesRemoved: 0 });

  // Update parsed emails when manual input changes
  useEffect(() => {
    if (recipientMode === "manual_entry" && manualEmails.trim()) {
      const result = parseAndValidateEmails(manualEmails);
      setParsedEmails(result);
      setRecipientCount(result.valid.length);
    } else if (recipientMode === "manual_entry") {
      setParsedEmails({ valid: [], invalid: [], duplicatesRemoved: 0 });
      setRecipientCount(0);
    }
  }, [manualEmails, recipientMode]);

  // Fetch preview count for all_subscribers and customer_segment modes
  const fetchPreviewCount = useCallback(() => {
    if (recipientMode === "manual_entry") return;
    const formData = new FormData();
    formData.set("intent", "preview_count");
    formData.set("recipientMode", recipientMode);
    if (recipientMode === "customer_segment") {
      formData.set("segmentFilters", JSON.stringify(segmentFilters));
    }
    countFetcher.submit(formData, { method: "post" });
  }, [recipientMode, segmentFilters]);

  // Update count from fetcher response
  useEffect(() => {
    if (countFetcher.data && countFetcher.data.count !== undefined) {
      setRecipientCount(countFetcher.data.count);
      setQuotaRemaining(countFetcher.data.quotaRemaining ?? null);
      setQuotaExceeded(countFetcher.data.quotaExceeded ?? false);
    }
  }, [countFetcher.data]);

  // Fetch count when entering recipients step or when mode/filters change
  useEffect(() => {
    if (currentStep === "recipients" && recipientMode !== "manual_entry") {
      fetchPreviewCount();
    }
  }, [currentStep, recipientMode, segmentFilters, fetchPreviewCount]);

  // Handle successful send from actionData
  useEffect(() => {
    if (actionData && (actionData as { success?: boolean }).success && (actionData as { message?: string }).message) {
      const msg = (actionData as { message: string }).message;
      if (msg.includes("Campaign sent")) {
        setSuccessMessage(msg);
        resetWizard();
      }
    }
  }, [actionData]);

  const resetWizard = () => {
    setWizardOpen(false);
    setCurrentStep("subject");
    setCampaignName("");
    setSubject("");
    setHtmlContent("");
    setRecipientMode("all_subscribers");
    setSegmentFilters({});
    setManualEmails("");
    setRecipientCount(0);
    setQuotaRemaining(null);
    setQuotaExceeded(false);
    setSending(false);
    setParsedEmails({ valid: [], invalid: [], duplicatesRemoved: 0 });
  };

  const handleWizardClose = () => {
    // Auto-save as draft when closing (Requirement 2.8)
    if (campaignName.trim() && subject.trim()) {
      const formData = new FormData();
      formData.set("intent", "save_draft");
      formData.set("name", campaignName.trim());
      formData.set("subject", subject.trim());
      formData.set("templateJson", JSON.stringify([{ type: "html", content: htmlContent }]));
      formData.set("recipientMode", recipientMode);
      formData.set("segmentFilters", JSON.stringify(segmentFilters));
      formData.set("manualEmails", manualEmails);
      submit(formData, { method: "post" });
    }
    resetWizard();
  };

  const handleSendCampaign = () => {
    setSending(true);
    const formData = new FormData();
    formData.set("intent", "create_and_send");
    formData.set("name", campaignName.trim());
    formData.set("subject", subject.trim());
    formData.set("templateJson", JSON.stringify([{ type: "html", content: htmlContent }]));
    formData.set("recipientMode", recipientMode);
    formData.set("segmentFilters", JSON.stringify(segmentFilters));
    formData.set("manualEmails", manualEmails);
    submit(formData, { method: "post" });
  };

  const handleSchedule = (campaignId: string) => {
    const formData = new FormData();
    formData.set("intent", "schedule");
    formData.set("campaignId", campaignId);
    formData.set("scheduledAt", new Date().toISOString());
    submit(formData, { method: "post" });
  };

  // Validation helpers
  const isSubjectStepValid = campaignName.trim().length > 0 && subject.trim().length > 0;
  const isContentStepValid = htmlContent.trim().length > 0;
  const isRecipientsStepValid = recipientCount > 0;

  const canGoNext = (): boolean => {
    switch (currentStep) {
      case "subject": return isSubjectStepValid;
      case "content": return isContentStepValid;
      case "recipients": return isRecipientsStepValid;
      default: return false;
    }
  };

  const goNext = () => {
    const idx = WIZARD_STEPS.indexOf(currentStep);
    if (idx < WIZARD_STEPS.length - 1) {
      setCurrentStep(WIZARD_STEPS[idx + 1]);
    }
  };

  const goBack = () => {
    const idx = WIZARD_STEPS.indexOf(currentStep);
    if (idx > 0) {
      setCurrentStep(WIZARD_STEPS[idx - 1]);
    }
  };

  const getRecipientModeLabel = (mode: RecipientMode): string => {
    switch (mode) {
      case "all_subscribers": return "All Subscribers";
      case "customer_segment": return "Customer Segments";
      case "manual_entry": return "Manual Entry";
    }
  };

  // --- Render ---
  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Page Header with New Campaign button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: 0 }}>Email Campaigns</h1>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          style={{
            padding: "10px 20px",
            fontSize: "14px",
            fontWeight: "600",
            backgroundColor: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          New Campaign
        </button>
      </div>

      {/* Success message */}
      {successMessage && (
        <div role="status" style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#d1fae5", borderRadius: "8px", color: "#065f46" }}>
          {successMessage}
        </div>
      )}

      {(actionData as { error?: string })?.error && (
        <div role="alert" style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#fee2e2", borderRadius: "8px", color: "#991b1b" }}>
          {(actionData as { error: string }).error}
        </div>
      )}

      {(actionData as { message?: string })?.message && !successMessage && (
        <div role="status" style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#d1fae5", borderRadius: "8px", color: "#065f46" }}>
          {(actionData as { message: string }).message}
        </div>
      )}

      {/* Campaigns Table */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Name</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Subject</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Status</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Recipients</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Opens</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Clicks</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Revenue</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "48px 24px", textAlign: "center", color: "#6b7280" }}>
                  <p style={{ fontSize: "16px", marginBottom: "8px" }}>No campaigns yet.</p>
                  <p style={{ fontSize: "14px" }}>Click "New Campaign" above to create your first campaign.</p>
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "12px 16px", fontSize: "14px" }}>{c.name}</td>
                  <td style={{ padding: "12px 16px", fontSize: "14px", color: "#6b7280" }}>{c.subject}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: "500",
                      backgroundColor: c.status === "sent" ? "#d1fae5" : c.status === "draft" ? "#e5e7eb" : "#fef3c7",
                      color: c.status === "sent" ? "#065f46" : c.status === "draft" ? "#374151" : "#92400e",
                    }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>{c.recipientCount}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>
                    {c.recipientCount > 0 ? `${((c.openCount / c.recipientCount) * 100).toFixed(1)}%` : "\u2014"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>
                    {c.recipientCount > 0 ? `${((c.clickCount / c.recipientCount) * 100).toFixed(1)}%` : "\u2014"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>
                    ${c.revenue.toFixed(2)}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    {c.status === "draft" && (
                      <button
                        type="button"
                        onClick={() => handleSchedule(c.id)}
                        style={{ padding: "4px 12px", fontSize: "12px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                      >
                        Send Now
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Campaign Wizard Modal */}
      {wizardOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: "#fff",
            borderRadius: "12px",
            width: "90%",
            maxWidth: "680px",
            maxHeight: "90vh",
            overflow: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            {/* Modal Header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>New Campaign</h2>
              <button
                type="button"
                onClick={handleWizardClose}
                style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#6b7280", lineHeight: 1 }}
                aria-label="Close wizard"
              >
                &times;
              </button>
            </div>

            {/* Step Indicator */}
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: "4px" }}>
              {WIZARD_STEPS.map((step, idx) => (
                <div key={step} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{
                    height: "4px",
                    borderRadius: "2px",
                    backgroundColor: WIZARD_STEPS.indexOf(currentStep) >= idx ? "#3b82f6" : "#e5e7eb",
                    marginBottom: "6px",
                  }} />
                  <span style={{
                    fontSize: "12px",
                    fontWeight: WIZARD_STEPS.indexOf(currentStep) === idx ? "600" : "400",
                    color: WIZARD_STEPS.indexOf(currentStep) >= idx ? "#1f2937" : "#9ca3af",
                  }}>
                    {STEP_LABELS[step]}
                  </span>
                </div>
              ))}
            </div>

            {/* Step Content */}
            <div style={{ padding: "24px" }}>
              {/* --- Subject Step (Task 7.2) --- */}
              {currentStep === "subject" && (
                <div>
                  <div style={{ marginBottom: "20px" }}>
                    <label htmlFor="campaign-name" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "6px", color: "#374151" }}>
                      Campaign Name
                    </label>
                    <input
                      id="campaign-name"
                      type="text"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      placeholder="e.g., Summer Sale Announcement"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        fontSize: "14px",
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    {campaignName.length > 0 && campaignName.trim().length === 0 && (
                      <p style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>Campaign name cannot be only whitespace</p>
                    )}
                  </div>
                  <div style={{ marginBottom: "20px" }}>
                    <label htmlFor="email-subject" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "6px", color: "#374151" }}>
                      Email Subject Line
                    </label>
                    <input
                      id="email-subject"
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="e.g., Don't miss our biggest sale of the year!"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        fontSize: "14px",
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    {subject.length > 0 && subject.trim().length === 0 && (
                      <p style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>Subject line cannot be only whitespace</p>
                    )}
                  </div>
                </div>
              )}

              {/* --- Content Step (Task 7.3) --- */}
              {currentStep === "content" && (
                <div>
                  <div style={{ marginBottom: "20px" }}>
                    <label htmlFor="html-content" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "6px", color: "#374151" }}>
                      Email HTML Content
                    </label>
                    <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}>
                      Paste or write your email HTML content below.
                    </p>
                    <textarea
                      id="html-content"
                      value={htmlContent}
                      onChange={(e) => setHtmlContent(e.target.value)}
                      placeholder="<h1>Hello!</h1><p>Your email content here...</p>"
                      rows={12}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        fontSize: "13px",
                        fontFamily: "monospace",
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        outline: "none",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                    {htmlContent.length > 0 && htmlContent.trim().length === 0 && (
                      <p style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>Content cannot be only whitespace</p>
                    )}
                  </div>
                </div>
              )}

              {/* --- Recipients Step (Task 7.4) --- */}
              {currentStep === "recipients" && (
                <div>
                  {/* Mode Selector */}
                  <div style={{ marginBottom: "20px" }}>
                    <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "10px", color: "#374151" }}>
                      Select Recipients
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {(["all_subscribers", "customer_segment", "manual_entry"] as RecipientMode[]).map((mode) => (
                        <label
                          key={mode}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "12px",
                            border: `2px solid ${recipientMode === mode ? "#3b82f6" : "#e5e7eb"}`,
                            borderRadius: "8px",
                            cursor: "pointer",
                            backgroundColor: recipientMode === mode ? "#eff6ff" : "#fff",
                          }}
                        >
                          <input
                            type="radio"
                            name="recipientMode"
                            value={mode}
                            checked={recipientMode === mode}
                            onChange={() => {
                              setRecipientMode(mode);
                              setRecipientCount(0);
                              setQuotaRemaining(null);
                              setQuotaExceeded(false);
                            }}
                            style={{ accentColor: "#3b82f6" }}
                          />
                          <span style={{ fontSize: "14px", fontWeight: "500" }}>{getRecipientModeLabel(mode)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* All Subscribers Mode */}
                  {recipientMode === "all_subscribers" && (
                    <div style={{ padding: "12px", backgroundColor: "#f9fafb", borderRadius: "8px", marginBottom: "16px" }}>
                      {countFetcher.state === "submitting" || countFetcher.state === "loading" ? (
                        <p style={{ fontSize: "14px", color: "#6b7280" }}>Loading subscriber count...</p>
                      ) : (
                        <p style={{ fontSize: "14px", color: "#374151" }}>
                          Total subscribed customers: <strong>{recipientCount}</strong>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Customer Segment Mode */}
                  {recipientMode === "customer_segment" && (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                        <div>
                          <label htmlFor="filter-loyalty" style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px", color: "#6b7280" }}>
                            Loyalty Tier
                          </label>
                          <input
                            id="filter-loyalty"
                            type="text"
                            value={segmentFilters.loyaltyTier || ""}
                            onChange={(e) => setSegmentFilters((prev) => ({ ...prev, loyaltyTier: e.target.value || undefined }))}
                            placeholder="e.g., gold"
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              fontSize: "13px",
                              border: "1px solid #d1d5db",
                              borderRadius: "6px",
                              outline: "none",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                        <div>
                          <label htmlFor="filter-orders" style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px", color: "#6b7280" }}>
                            Min Total Orders
                          </label>
                          <input
                            id="filter-orders"
                            type="number"
                            min="0"
                            value={segmentFilters.minTotalOrders ?? ""}
                            onChange={(e) => setSegmentFilters((prev) => ({ ...prev, minTotalOrders: e.target.value ? Number(e.target.value) : undefined }))}
                            placeholder="0"
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              fontSize: "13px",
                              border: "1px solid #d1d5db",
                              borderRadius: "6px",
                              outline: "none",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                        <div>
                          <label htmlFor="filter-spent" style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px", color: "#6b7280" }}>
                            Min Total Spent ($)
                          </label>
                          <input
                            id="filter-spent"
                            type="number"
                            min="0"
                            value={segmentFilters.minTotalSpent ?? ""}
                            onChange={(e) => setSegmentFilters((prev) => ({ ...prev, minTotalSpent: e.target.value ? Number(e.target.value) : undefined }))}
                            placeholder="0"
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              fontSize: "13px",
                              border: "1px solid #d1d5db",
                              borderRadius: "6px",
                              outline: "none",
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ padding: "12px", backgroundColor: "#f9fafb", borderRadius: "8px" }}>
                        {countFetcher.state === "submitting" || countFetcher.state === "loading" ? (
                          <p style={{ fontSize: "14px", color: "#6b7280" }}>Calculating matching customers...</p>
                        ) : (
                          <p style={{ fontSize: "14px", color: "#374151" }}>
                            Matching customers: <strong>{recipientCount}</strong>
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Manual Entry Mode */}
                  {recipientMode === "manual_entry" && (
                    <div style={{ marginBottom: "16px" }}>
                      <label htmlFor="manual-emails" style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px", color: "#6b7280" }}>
                        Enter email addresses (separated by commas, semicolons, or newlines)
                      </label>
                      <textarea
                        id="manual-emails"
                        value={manualEmails}
                        onChange={(e) => setManualEmails(e.target.value)}
                        placeholder="john@example.com, jane@example.com"
                        rows={5}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          fontSize: "13px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          outline: "none",
                          resize: "vertical",
                          boxSizing: "border-box",
                        }}
                      />
                      {manualEmails.trim() && (
                        <div style={{ marginTop: "8px", fontSize: "13px" }}>
                          <span style={{ color: "#059669" }}>Valid: {parsedEmails.valid.length}</span>
                          {parsedEmails.invalid.length > 0 && (
                            <span style={{ color: "#dc2626", marginLeft: "12px" }}>Invalid: {parsedEmails.invalid.length}</span>
                          )}
                          {parsedEmails.duplicatesRemoved > 0 && (
                            <span style={{ color: "#6b7280", marginLeft: "12px" }}>Duplicates removed: {parsedEmails.duplicatesRemoved}</span>
                          )}
                        </div>
                      )}
                      {parsedEmails.invalid.length > 0 && (
                        <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#fef2f2", borderRadius: "6px", fontSize: "12px", color: "#991b1b" }}>
                          Invalid entries: {parsedEmails.invalid.join(", ")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recipient Count Preview (Requirement 6.1) */}
                  <div style={{
                    padding: "16px",
                    backgroundColor: quotaExceeded ? "#fef2f2" : "#f0fdf4",
                    borderRadius: "8px",
                    border: `1px solid ${quotaExceeded ? "#fecaca" : "#bbf7d0"}`,
                    marginBottom: "12px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <p style={{ fontSize: "24px", fontWeight: "700", margin: 0, color: quotaExceeded ? "#dc2626" : "#059669" }}>
                          {recipientCount}
                        </p>
                        <p style={{ fontSize: "12px", color: "#6b7280", margin: "4px 0 0" }}>Recipients</p>
                      </div>
                      {quotaRemaining !== null && (
                        <div style={{ textAlign: "right" }}>
                          <p style={{ fontSize: "14px", fontWeight: "500", margin: 0, color: "#374151" }}>
                            {quotaRemaining} remaining
                          </p>
                          <p style={{ fontSize: "12px", color: "#6b7280", margin: "2px 0 0" }}>Email quota</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quota exceeded warning (Requirement 6.3) */}
                  {quotaExceeded && (
                    <div style={{
                      padding: "12px",
                      backgroundColor: "#fef3c7",
                      borderRadius: "8px",
                      border: "1px solid #fde68a",
                      fontSize: "13px",
                      color: "#92400e",
                    }}>
                      <strong>Warning:</strong> This campaign exceeds your email quota. Please reduce recipients or upgrade your plan.
                    </div>
                  )}

                  {recipientCount === 0 && recipientMode !== "manual_entry" && countFetcher.state === "idle" && countFetcher.data && (
                    <p style={{ fontSize: "13px", color: "#dc2626", marginTop: "8px" }}>
                      No recipients found. Please adjust your selection.
                    </p>
                  )}
                </div>
              )}

              {/* --- Review Step (Task 7.5) --- */}
              {currentStep === "review" && (
                <div>
                  <div style={{ marginBottom: "20px" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", color: "#1f2937" }}>Campaign Summary</h3>
                    <div style={{ display: "grid", gap: "12px" }}>
                      <div style={{ padding: "12px", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                        <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px" }}>Campaign Name</p>
                        <p style={{ fontSize: "14px", fontWeight: "500", margin: 0, color: "#1f2937" }}>{campaignName}</p>
                      </div>
                      <div style={{ padding: "12px", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                        <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px" }}>Subject Line</p>
                        <p style={{ fontSize: "14px", fontWeight: "500", margin: 0, color: "#1f2937" }}>{subject}</p>
                      </div>
                      <div style={{ padding: "12px", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                        <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px" }}>Content Preview</p>
                        <div
                          style={{ fontSize: "13px", color: "#374151", maxHeight: "120px", overflow: "auto", marginTop: "4px" }}
                          dangerouslySetInnerHTML={{ __html: htmlContent.substring(0, 500) }}
                        />
                      </div>
                      <div style={{ padding: "12px", backgroundColor: "#f9fafb", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px" }}>Recipients</p>
                          <p style={{ fontSize: "14px", fontWeight: "500", margin: 0, color: "#1f2937" }}>
                            {getRecipientModeLabel(recipientMode)}
                          </p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <p style={{ fontSize: "24px", fontWeight: "700", margin: 0, color: "#059669" }}>{recipientCount}</p>
                          <p style={{ fontSize: "11px", color: "#6b7280", margin: 0 }}>recipients</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Send error feedback */}
                  {(actionData as { error?: string })?.error && sending && (
                    <div style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#fee2e2", borderRadius: "8px", color: "#991b1b", fontSize: "13px" }}>
                      {(actionData as { error: string }).error}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer with navigation buttons */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {currentStep !== "subject" && (
                  <button
                    type="button"
                    onClick={goBack}
                    style={{
                      padding: "8px 16px",
                      fontSize: "14px",
                      backgroundColor: "#fff",
                      color: "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Back
                  </button>
                )}
              </div>
              <div>
                {currentStep !== "review" ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!canGoNext()}
                    style={{
                      padding: "8px 20px",
                      fontSize: "14px",
                      fontWeight: "500",
                      backgroundColor: canGoNext() ? "#3b82f6" : "#9ca3af",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: canGoNext() ? "pointer" : "not-allowed",
                      opacity: canGoNext() ? 1 : 0.7,
                    }}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendCampaign}
                    disabled={sending}
                    style={{
                      padding: "8px 20px",
                      fontSize: "14px",
                      fontWeight: "600",
                      backgroundColor: sending ? "#9ca3af" : "#059669",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: sending ? "not-allowed" : "pointer",
                    }}
                  >
                    {sending ? "Sending..." : "Send Campaign"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
