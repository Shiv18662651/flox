// Email campaigns route - campaign management and scheduling
// Requirements: 7.3, 7.4, 7.13, 7.14

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { isWithinEmailQuota } from "~/utils/plan-limits.server";
import { emailQueue } from "../../workers/index";
import { renderEmailHtml, injectTracking, injectUnsubscribeLink, type EmailBlock } from "~/utils/email-renderer.server";

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

export default function EmailCampaignsPage() {
  const { campaigns } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const handleSchedule = (campaignId: string) => {
    const formData = new FormData();
    formData.set("intent", "schedule");
    formData.set("campaignId", campaignId);
    // Schedule immediately
    formData.set("scheduledAt", new Date().toISOString());
    submit(formData, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "24px" }}>Email Campaigns</h1>

      {(actionData as { error?: string })?.error && (
        <div role="alert" style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#fee2e2", borderRadius: "8px", color: "#991b1b" }}>
          {(actionData as { error: string }).error}
        </div>
      )}

      {(actionData as { message?: string })?.message && (
        <div role="status" style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#d1fae5", borderRadius: "8px", color: "#065f46" }}>
          {(actionData as { message: string }).message}
        </div>
      )}

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
                <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>
                  No campaigns yet. Create a template first, then schedule it here.
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
                    {c.recipientCount > 0 ? `${((c.openCount / c.recipientCount) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>
                    {c.recipientCount > 0 ? `${((c.clickCount / c.recipientCount) * 100).toFixed(1)}%` : "—"}
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
    </div>
  );
}
