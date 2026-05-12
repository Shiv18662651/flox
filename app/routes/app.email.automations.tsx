// Email automations route - automation management
// Requirements: 7.7, 7.8, 7.9

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation, Link, useLocation } from "@remix-run/react";
import { useState, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { renderEmailHtml, type EmailBlock } from "~/utils/email-renderer.server";
import { generateFlowFromDescription } from "~/ai.server";

const TRIGGER_OPTIONS = [
  { value: "abandoned_cart", label: "Abandoned Cart" },
  { value: "welcome", label: "Welcome (New Customer)" },
  { value: "post_purchase", label: "Post Purchase" },
  { value: "win_back", label: "Win Back (Inactive Customer)" },
  { value: "birthday", label: "Birthday" },
] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const automations = await db.automation.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return json({ automations, shopId: shop.id });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = formData.get("name") as string;
    const trigger = formData.get("trigger") as string;
    const subject = formData.get("subject") as string;
    const delayMinutes = parseInt(formData.get("delayMinutes") as string) || 60;
    const blocksJson = formData.get("blocks") as string;

    if (!name || !trigger || !subject || !blocksJson) {
      return json({ error: "All fields are required" }, { status: 400 });
    }

    let blocks: EmailBlock[];
    try {
      blocks = JSON.parse(blocksJson) as EmailBlock[];
    } catch {
      return json({ error: "Invalid blocks JSON" }, { status: 400 });
    }

    const templateHtml = renderEmailHtml(blocks);

    await db.automation.create({
      data: {
        shopId: shop.id,
        name,
        trigger,
        subject,
        delayMinutes,
        templateJson: blocks as unknown as Record<string, unknown>[],
        templateHtml,
        isActive: false,
      },
    });

    return json({ success: true, message: "Automation created" });
  }

  if (intent === "generate") {
    const description = formData.get("description") as string;
    if (!description || description.trim().length < 5) {
      return json({ error: "Please describe your flow (at least 5 characters)" }, { status: 400 });
    }

    try {
      const generated = await generateFlowFromDescription(description);
      return json({ success: true, generated, error: null });
    } catch {
      return json({ error: "AI generation failed. Please try again." }, { status: 500 });
    }
  }

  if (intent === "toggle") {
    const automationId = formData.get("automationId") as string;
    if (!automationId) return json({ error: "Automation ID required" }, { status: 400 });

    const automation = await db.automation.findUnique({
      where: { id: automationId },
      select: { id: true, shopId: true, isActive: true },
    });

    if (!automation || automation.shopId !== shop.id) {
      return json({ error: "Automation not found" }, { status: 404 });
    }

    await db.automation.update({
      where: { id: automationId },
      data: { isActive: !automation.isActive },
    });

    return json({ success: true, message: `Automation ${automation.isActive ? "deactivated" : "activated"}` });
  }

  if (intent === "delete") {
    const automationId = formData.get("automationId") as string;
    if (!automationId) return json({ error: "Automation ID required" }, { status: 400 });

    await db.automation.delete({ where: { id: automationId } });
    return json({ success: true, message: "Automation deleted" });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

const DEFAULT_BLOCKS: EmailBlock[] = [
  { type: "text", content: "Hi there! Thanks for being a customer." },
];

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
    <div style={{ display: "flex", gap: "4px", marginBottom: "24px", borderBottom: "1px solid #e5e7eb", paddingBottom: "12px" }}>
      {EMAIL_NAV.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: isActive ? "600" : "400",
              color: isActive ? "#3b82f6" : "#6b7280",
              borderBottom: isActive ? "2px solid #3b82f6" : "2px solid transparent",
              textDecoration: "none",
              marginBottom: "-14px",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export default function EmailAutomationsPage() {
  const { automations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("welcome");
  const [subject, setSubject] = useState("");
  const [delayMinutes, setDelayMinutes] = useState("60");
  const [blocksText, setBlocksText] = useState(JSON.stringify(DEFAULT_BLOCKS, null, 2));

  // AI Builder state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerated, setAiGenerated] = useState<{
    name: string;
    trigger: string;
    delayMinutes: number;
    subject: string;
    blocks: unknown[];
  } | null>(null);

  const isGenerating = navigation.state === "submitting" && navigation.formData?.get("intent") === "generate";

  // Apply AI-generated content when actionData returns it
  useEffect(() => {
    if (actionData && "generated" in actionData && actionData.generated) {
      const g = actionData.generated as typeof aiGenerated;
      setAiGenerated(g);
      setName(g?.name || "");
      setTrigger(g?.trigger || "welcome");
      setSubject(g?.subject || "");
      setDelayMinutes(String(g?.delayMinutes || 60));
      setBlocksText(JSON.stringify(g?.blocks || DEFAULT_BLOCKS, null, 2));
      setShowAiModal(false);
      setShowForm(true);
    }
  }, [actionData]);

  const handleCreate = () => {
    const formData = new FormData();
    formData.set("intent", "create");
    formData.set("name", name);
    formData.set("trigger", trigger);
    formData.set("subject", subject);
    formData.set("delayMinutes", delayMinutes);
    formData.set("blocks", blocksText);
    submit(formData, { method: "post" });
    setShowForm(false);
  };

  const handleToggle = (automationId: string) => {
    const formData = new FormData();
    formData.set("intent", "toggle");
    formData.set("automationId", automationId);
    submit(formData, { method: "post" });
  };

  const handleDelete = (automationId: string) => {
    if (!confirm("Delete this automation?")) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("automationId", automationId);
    submit(formData, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <EmailNav />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Email Automations</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setShowAiModal(true)}
            style={{ padding: "8px 16px", backgroundColor: "#7c3aed", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>✨</span> AI Builder
          </button>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
          >
            {showForm ? "Cancel" : "New Automation"}
          </button>
        </div>
      </div>

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

      {showAiModal && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", marginBottom: "24px", backgroundColor: "#faf5ff" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>✨</span> AI Flow Builder
          </h2>
          <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "12px" }}>
            Describe the automation you want and let AI build it for you.
          </p>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Send a welcome email to new customers with a 10% discount code, 1 hour after they sign up"
            style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px", marginBottom: "12px" }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => {
                const fd = new FormData();
                fd.set("intent", "generate");
                fd.set("description", aiPrompt);
                submit(fd, { method: "post" });
              }}
              style={{ padding: "8px 16px", backgroundColor: "#7c3aed", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", opacity: isGenerating ? 0.6 : 1 }}
            >
              {isGenerating ? "Generating..." : "Generate Flow"}
            </button>
            <button
              type="button"
              onClick={() => setShowAiModal(false)}
              style={{ padding: "8px 16px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", marginBottom: "24px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>
            {aiGenerated ? "✨ AI-Generated Flow (Review & Save)" : "Create Automation"}
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label htmlFor="auto-name" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Name</label>
              <input id="auto-name" type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} placeholder="Automation name" />
            </div>
            <div>
              <label htmlFor="auto-trigger" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Trigger</label>
              <select id="auto-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}>
                {TRIGGER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="auto-subject" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Subject</label>
              <input id="auto-subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} placeholder="Email subject" />
            </div>
            <div>
              <label htmlFor="auto-delay" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Delay (minutes)</label>
              <input id="auto-delay" type="number" value={delayMinutes} onChange={(e) => setDelayMinutes(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label htmlFor="auto-blocks" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Template Blocks (JSON)</label>
            <textarea id="auto-blocks" value={blocksText} onChange={(e) => setBlocksText(e.target.value)} rows={6} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px", fontFamily: "monospace", fontSize: "12px" }} />
          </div>

          <button type="button" onClick={handleCreate} style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}>
            Create Automation
          </button>
        </div>
      )}

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Name</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Trigger</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Subject</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Delay</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Sent</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Status</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {automations.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>
                  No automations yet. Create your first one!
                </td>
              </tr>
            ) : (
              automations.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "12px 16px", fontSize: "14px" }}>{a.name}</td>
                  <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                    {TRIGGER_OPTIONS.find((t) => t.value === a.trigger)?.label || a.trigger}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "14px", color: "#6b7280" }}>{a.subject}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>{a.delayMinutes}m</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>{a.totalSent}</td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: "500",
                      backgroundColor: a.isActive ? "#d1fae5" : "#e5e7eb",
                      color: a.isActive ? "#065f46" : "#374151",
                    }}>
                      {a.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                      <button
                        type="button"
                        onClick={() => handleToggle(a.id)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #d1d5db", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff" }}
                      >
                        {a.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #fca5a5", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff", color: "#dc2626" }}
                      >
                        Delete
                      </button>
                    </div>
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
