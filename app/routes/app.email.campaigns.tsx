// Email campaigns route - campaign management and scheduling
// Requirements: 7.3, 7.4, 7.13, 7.14

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "@remix-run/react";
import { parseAndValidateEmails } from "~/utils/email-parser";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { isWithinEmailQuota } from "~/utils/plan-limits.server";
import { emailQueue } from "../../workers/index";
import { renderEmailHtml, injectTracking, injectUnsubscribeLink, type EmailBlock } from "~/utils/email-renderer.server";
import { Icon } from "~/components/Icon";
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

  // Fetch variants for campaigns that have A/B tests
  const campaignIds = campaigns.filter((c: any) => c.isAbTest).map((c: any) => c.id);
  const variants = campaignIds.length > 0
    ? await (db as any).campaignVariant.findMany({
        where: { campaignId: { in: campaignIds } },
      })
    : [];

  const campaignsWithVariants = campaigns.map((c: any) => ({
    ...c,
    abVariants: c.isAbTest ? variants.filter((v: any) => v.campaignId === c.id) : [],
  }));

  return json({ campaigns: campaignsWithVariants as any, shopId: shop.id, plan: shop.plan });
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
    const recipientMode = formData.get("recipientMode") as RecipientMode;
    const segmentFiltersRaw = formData.get("segmentFilters") as string | null;
    const manualEmails = (formData.get("manualEmails") as string) || "";
    const isAbTest = formData.get("isAbTest") === "true";

    let subject: string;
    let templateJson: string;
    let variantASubject: string | undefined;
    let variantBSubject: string | undefined;
    let variantAContent: string | undefined;
    let variantBContent: string | undefined;

    if (isAbTest) {
      variantASubject = formData.get("variantASubject") as string;
      variantBSubject = formData.get("variantBSubject") as string;
      variantAContent = formData.get("variantAContent") as string;
      variantBContent = formData.get("variantBContent") as string;
      if (!variantASubject || !variantBSubject || !variantAContent || !variantBContent) {
        return json({ error: "Both A/B variants require subject and content" }, { status: 400 });
      }
      subject = variantASubject; // default subject for campaign record
      templateJson = JSON.stringify([{ type: "html", content: variantAContent }]);
    } else {
      subject = formData.get("subject") as string;
      templateJson = formData.get("templateJson") as string;
      if (!name || !subject || !templateJson || !recipientMode) {
        return json({ error: "Missing required fields: name, subject, templateJson, recipientMode" }, { status: 400 });
      }
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
        isAbTest: isAbTest,
      } as any,
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

    const baseUrl = process.env.SHOPIFY_APP_URL || "https://app.example.com";

    if (isAbTest && variantASubject && variantBSubject && variantAContent && variantBContent) {
      // Create variants
      const variantAHtml = renderEmailHtml([{ type: "html" as any, content: variantAContent }]);
      const variantBHtml = renderEmailHtml([{ type: "html" as any, content: variantBContent }]);

      const variantA = await (db as any).campaignVariant.create({
        data: {
          campaignId: campaign.id,
          name: "A",
          subject: variantASubject,
          templateJson: [{ type: "html", content: variantAContent }],
          templateHtml: variantAHtml,
          splitPercent: 50,
        },
      });

      const variantB = await (db as any).campaignVariant.create({
        data: {
          campaignId: campaign.id,
          name: "B",
          subject: variantBSubject,
          templateJson: [{ type: "html", content: variantBContent }],
          templateHtml: variantBHtml,
          splitPercent: 50,
        },
      });

      // Split recipients 50/50
      const mid = Math.floor(resolved.emails.length / 2);
      const aEmails = resolved.emails.slice(0, mid);
      const aCustomerIds = resolved.customerIds.slice(0, mid);
      const bEmails = resolved.emails.slice(mid);
      const bCustomerIds = resolved.customerIds.slice(mid);

      // Update campaign
      await db.campaign.update({
        where: { id: campaign.id },
        data: {
          status: "sending",
          recipientCount: resolved.count,
          templateHtml: variantAHtml,
        },
      });

      // Send Variant A
      for (let i = 0; i < aEmails.length; i++) {
        const toEmail = aEmails[i];
        const customerId = aCustomerIds[i] || undefined;
        const emailSend = await db.emailSend.create({
          data: {
            shopId: shop.id,
            campaignId: campaign.id,
            toEmail,
            subject: variantASubject,
            status: "queued",
            ...(customerId ? { customerId } : {}),
          },
        });
        let personalizedHtml = injectTracking(variantAHtml, emailSend.id, baseUrl);
        if (customerId) {
          personalizedHtml = injectUnsubscribeLink(personalizedHtml, customerId, baseUrl);
        }
        await emailQueue.add("campaign-email", {
          shopId: shop.id,
          campaignId: campaign.id,
          emailSendId: emailSend.id,
          toEmail,
          subject: variantASubject,
          htmlContent: personalizedHtml,
        });
      }

      // Send Variant B
      for (let i = 0; i < bEmails.length; i++) {
        const toEmail = bEmails[i];
        const customerId = bCustomerIds[i] || undefined;
        const emailSend = await db.emailSend.create({
          data: {
            shopId: shop.id,
            campaignId: campaign.id,
            toEmail,
            subject: variantBSubject,
            status: "queued",
            ...(customerId ? { customerId } : {}),
          },
        });
        let personalizedHtml = injectTracking(variantBHtml, emailSend.id, baseUrl);
        if (customerId) {
          personalizedHtml = injectUnsubscribeLink(personalizedHtml, customerId, baseUrl);
        }
        await emailQueue.add("campaign-email", {
          shopId: shop.id,
          campaignId: campaign.id,
          emailSendId: emailSend.id,
          toEmail,
          subject: variantBSubject,
          htmlContent: personalizedHtml,
        });
      }

      // Update variant counts
      await (db as any).campaignVariant.update({ where: { id: variantA.id }, data: { recipientCount: aEmails.length } });
      await (db as any).campaignVariant.update({ where: { id: variantB.id }, data: { recipientCount: bEmails.length } });
    } else {
      // Regular campaign send
      const htmlContent = renderEmailHtml(blocks);

      await db.campaign.update({
        where: { id: campaign.id },
        data: {
          status: "sending",
          recipientCount: resolved.count,
          templateHtml: htmlContent,
        },
      });

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
    }

    // Update campaign status to "sent" (Requirement 7.6)
    await db.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "sent",
        sentAt: new Date(),
      },
    });

    return json({ success: true, message: `Campaign sent to ${resolved.count} recipients${isAbTest ? " (A/B test)" : ""}` });
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

const EMAIL_NAV = [
  { label: "Campaigns", path: "/app/email/campaigns" },
  { label: "Templates", path: "/app/email/templates" },
  { label: "Automations", path: "/app/email/automations" },
  { label: "Subscribers", path: "/app/email/subscribers" },
  { label: "Signup Forms", path: "/app/email/signup-forms" },
];

function EmailNav() {
  const location = useLocation();
  return (
    <div className="flex gap-xs mb-lg border-b border-outline-variant pb-sm">
      {EMAIL_NAV.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`px-md py-xs text-label-md font-medium border-b-2 -mb-[2px] transition-colors ${
              isActive
                ? "text-primary border-primary"
                : "text-on-surface-variant border-transparent hover:text-on-surface"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export default function EmailCampaignsPage() {
  const { campaigns } = useLoaderData<typeof loader>() as { campaigns: any[] };
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

  // A/B Testing state
  const [isAbTest, setIsAbTest] = useState(false);
  const [variantASubject, setVariantASubject] = useState("");
  const [variantBSubject, setVariantBSubject] = useState("");
  const [variantAContent, setVariantAContent] = useState("");
  const [variantBContent, setVariantBContent] = useState("");

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
    setIsAbTest(false);
    setVariantASubject("");
    setVariantBSubject("");
    setVariantAContent("");
    setVariantBContent("");
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
    if (isAbTest) {
      formData.set("isAbTest", "true");
      formData.set("variantASubject", variantASubject.trim());
      formData.set("variantBSubject", variantBSubject.trim());
      formData.set("variantAContent", variantAContent.trim());
      formData.set("variantBContent", variantBContent.trim());
    } else {
      formData.set("subject", subject.trim());
      formData.set("templateJson", JSON.stringify([{ type: "html", content: htmlContent }]));
    }
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
  const isSubjectStepValid = isAbTest
    ? campaignName.trim().length > 0 && variantASubject.trim().length > 0 && variantBSubject.trim().length > 0
    : campaignName.trim().length > 0 && subject.trim().length > 0;
  const isContentStepValid = isAbTest
    ? variantAContent.trim().length > 0 && variantBContent.trim().length > 0
    : htmlContent.trim().length > 0;
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
    <main className="p-lg max-w-container-max mx-auto font-sans pb-24">
      <EmailNav />

      {/* Page Header with New Campaign button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md mb-lg">
        <h1 className="text-display-lg font-bold text-on-surface">Email Campaigns</h1>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-xs bg-primary text-on-primary text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm"
        >
          <Icon name="add" size={18} />
          New Campaign
        </button>
      </div>

      {/* Success message */}
      {successMessage && (
        <div role="status" className="mb-md px-sm py-xs rounded-lg bg-secondary-container text-on-secondary-container flex items-center gap-xs text-label-md">
          <Icon name="check_circle" size={16} />
          {successMessage}
        </div>
      )}

      {(actionData as { error?: string })?.error && (
        <div role="alert" className="mb-md px-sm py-xs rounded-lg bg-error-container text-on-error-container flex items-center gap-xs text-label-md">
          <Icon name="error" size={16} />
          {(actionData as { error: string }).error}
        </div>
      )}

      {(actionData as { message?: string })?.message && !successMessage && (
        <div role="status" className="mb-md px-sm py-xs rounded-lg bg-secondary-container text-on-secondary-container flex items-center gap-xs text-label-md">
          <Icon name="check_circle" size={16} />
          {(actionData as { message: string }).message}
        </div>
      )}

      {/* Campaigns Table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Name</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Subject</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Status</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Recipients</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Opens</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Clicks</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Revenue</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-xl px-md text-center text-on-surface-variant">
                  <div className="flex flex-col items-center justify-center gap-sm">
                    <Icon name="mail" size={48} className="opacity-40" />
                    <p className="text-body-lg font-medium">No campaigns yet.</p>
                    <p className="text-body-md">Click "New Campaign" above to create your first campaign.</p>
                  </div>
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-md py-sm text-body-md text-on-surface">{c.name}</td>
                  <td className="px-md py-sm text-body-md text-on-surface-variant">{c.subject}</td>
                  <td className="px-md py-sm">
                    <div className="flex flex-col gap-xs items-start">
                      <span className={`inline-block px-sm py-[2px] rounded-full text-label-sm font-semibold ${
                        c.status === "sent" ? "bg-secondary-container text-on-secondary-container" :
                        c.status === "draft" ? "bg-surface-container-high text-on-surface-variant" :
                        "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                      }`}>
                        {c.status}
                      </span>
                      {c.isAbTest && (
                        <span className="inline-block px-xs py-[2px] rounded-full text-label-sm font-semibold bg-primary-container text-on-primary-container uppercase">
                          A/B Test
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">{c.recipientCount}</td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">
                    {c.recipientCount > 0 ? `${((c.openCount / c.recipientCount) * 100).toFixed(1)}%` : "\u2014"}
                  </td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">
                    {c.recipientCount > 0 ? `${((c.clickCount / c.recipientCount) * 100).toFixed(1)}%` : "\u2014"}
                  </td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">
                    ${c.revenue.toFixed(2)}
                  </td>
                  <td className="px-md py-sm text-center">
                    {c.status === "draft" && (
                      <button
                        type="button"
                        onClick={() => handleSchedule(c.id)}
                        className="px-sm py-[4px] text-label-sm font-semibold bg-primary text-on-primary rounded-md hover:opacity-90 transition-opacity"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-sm">
          <div className="bg-surface-container-lowest rounded-xl shadow-xl w-[90%] max-w-2xl max-h-[90vh] overflow-auto">
            {/* Modal Header */}
            <div className="px-md py-sm border-b border-outline-variant flex items-center justify-between">
              <h2 className="text-headline-sm font-semibold text-on-surface">New Campaign</h2>
              <button
                type="button"
                onClick={handleWizardClose}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
                aria-label="Close wizard"
              >
                <Icon name="close" size={24} />
              </button>
            </div>

            {/* Step Indicator */}
            <div className="px-md py-sm border-b border-outline-variant flex gap-xs">
              {WIZARD_STEPS.map((step, idx) => (
                <div key={step} className="flex-1 text-center">
                  <div className={`h-1 rounded-full mb-xs ${
                    WIZARD_STEPS.indexOf(currentStep) >= idx ? "bg-primary" : "bg-surface-container-high"
                  }`} />
                  <span className={`text-label-sm ${
                    WIZARD_STEPS.indexOf(currentStep) === idx ? "font-semibold text-on-surface" :
                    WIZARD_STEPS.indexOf(currentStep) >= idx ? "text-on-surface-variant" : "text-on-surface-variant opacity-50"
                  }`}>
                    {STEP_LABELS[step]}
                  </span>
                </div>
              ))}
            </div>

            {/* Step Content */}
            <div className="p-md">
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

                  {/* A/B Test Toggle */}
                  <div style={{ marginBottom: "20px", padding: "12px", backgroundColor: "#f9fafb", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isAbTest}
                        onChange={(e) => {
                          setIsAbTest(e.target.checked);
                          if (e.target.checked) {
                            setVariantASubject(subject);
                            setVariantBSubject(subject);
                            setVariantAContent(htmlContent);
                            setVariantBContent(htmlContent);
                          }
                        }}
                        style={{ width: "18px", height: "18px", accentColor: "#3b82f6" }}
                      />
                      <span style={{ fontSize: "14px", fontWeight: "500", color: "#374151" }}>Enable A/B Testing</span>
                      <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "4px" }}>(Test 2 subject lines or content variations)</span>
                    </label>
                  </div>

                  {!isAbTest ? (
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
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                      <div style={{ padding: "16px", backgroundColor: "#eff6ff", borderRadius: "8px", border: "1px solid #bfdbfe" }}>
                        <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "8px", color: "#1e40af" }}>
                          Variant A (50%)
                        </label>
                        <input
                          type="text"
                          value={variantASubject}
                          onChange={(e) => setVariantASubject(e.target.value)}
                          placeholder="Subject line A"
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            fontSize: "14px",
                            border: "1px solid #d1d5db",
                            borderRadius: "6px",
                            outline: "none",
                            boxSizing: "border-box",
                            marginBottom: "8px",
                          }}
                        />
                      </div>
                      <div style={{ padding: "16px", backgroundColor: "#fef3c7", borderRadius: "8px", border: "1px solid #fde68a" }}>
                        <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "8px", color: "#92400e" }}>
                          Variant B (50%)
                        </label>
                        <input
                          type="text"
                          value={variantBSubject}
                          onChange={(e) => setVariantBSubject(e.target.value)}
                          placeholder="Subject line B"
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            fontSize: "14px",
                            border: "1px solid #d1d5db",
                            borderRadius: "6px",
                            outline: "none",
                            boxSizing: "border-box",
                            marginBottom: "8px",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* --- Content Step (Task 7.3) --- */}
              {currentStep === "content" && (
                <div>
                  {!isAbTest ? (
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
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                      <div style={{ padding: "16px", backgroundColor: "#eff6ff", borderRadius: "8px", border: "1px solid #bfdbfe" }}>
                        <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "8px", color: "#1e40af" }}>
                          Variant A Content
                        </label>
                        <textarea
                          value={variantAContent}
                          onChange={(e) => setVariantAContent(e.target.value)}
                          placeholder="<h1>Hello!</h1><p>Variant A content...</p>"
                          rows={10}
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
                      </div>
                      <div style={{ padding: "16px", backgroundColor: "#fef3c7", borderRadius: "8px", border: "1px solid #fde68a" }}>
                        <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "8px", color: "#92400e" }}>
                          Variant B Content
                        </label>
                        <textarea
                          value={variantBContent}
                          onChange={(e) => setVariantBContent(e.target.value)}
                          placeholder="<h1>Hello!</h1><p>Variant B content...</p>"
                          rows={10}
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
                      </div>
                    </div>
                  )}
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
                      {isAbTest ? (
                        <>
                          <div style={{ padding: "12px", backgroundColor: "#eff6ff", borderRadius: "6px", border: "1px solid #bfdbfe" }}>
                            <p style={{ fontSize: "12px", color: "#1e40af", margin: "0 0 4px", fontWeight: "600" }}>Variant A</p>
                            <p style={{ fontSize: "14px", fontWeight: "500", margin: "0 0 4px", color: "#1f2937" }}>{variantASubject}</p>
                            <div style={{ fontSize: "12px", color: "#6b7280" }} dangerouslySetInnerHTML={{ __html: variantAContent.substring(0, 200) }} />
                          </div>
                          <div style={{ padding: "12px", backgroundColor: "#fef3c7", borderRadius: "6px", border: "1px solid #fde68a" }}>
                            <p style={{ fontSize: "12px", color: "#92400e", margin: "0 0 4px", fontWeight: "600" }}>Variant B</p>
                            <p style={{ fontSize: "14px", fontWeight: "500", margin: "0 0 4px", color: "#1f2937" }}>{variantBSubject}</p>
                            <div style={{ fontSize: "12px", color: "#6b7280" }} dangerouslySetInnerHTML={{ __html: variantBContent.substring(0, 200) }} />
                          </div>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
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
            <div className="px-md py-sm border-t border-outline-variant flex items-center justify-between">
              <div>
                {currentStep !== "subject" && (
                  <button
                    type="button"
                    onClick={goBack}
                    className="px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
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
                    className="px-sm py-xs rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendCampaign}
                    disabled={sending}
                    className="px-sm py-xs rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {sending ? "Sending..." : isAbTest ? "Send A/B Test" : "Send Campaign"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
