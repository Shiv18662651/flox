// Email template editor route
// Requirements: 7.1, 7.2

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { renderEmailHtml, type EmailBlock } from "~/utils/email-renderer.server";
import {
  PREBUILT_TEMPLATE_LIST,
  getPrebuiltTemplate,
} from "~/utils/email-templates.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  // Load campaigns that can serve as templates (draft campaigns)
  const campaigns = await db.campaign.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      name: true,
      subject: true,
      templateJson: true,
      templateHtml: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return json({ campaigns, shopId: shop.id, prebuiltTemplates: PREBUILT_TEMPLATE_LIST });
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

  if (intent === "save") {
    const name = formData.get("name") as string;
    const subject = formData.get("subject") as string;
    const blocksJson = formData.get("blocks") as string;
    const campaignId = formData.get("campaignId") as string | null;

    if (!name || !subject || !blocksJson) {
      return json({ error: "Name, subject, and blocks are required" }, { status: 400 });
    }

    let blocks: EmailBlock[];
    try {
      blocks = JSON.parse(blocksJson) as EmailBlock[];
    } catch {
      return json({ error: "Invalid blocks JSON" }, { status: 400 });
    }

    // Render blocks to HTML
    const templateHtml = renderEmailHtml(blocks);

    if (campaignId) {
      // Update existing campaign
      await db.campaign.update({
        where: { id: campaignId },
        data: {
          name,
          subject,
          templateJson: blocks as unknown as Record<string, unknown>[],
          templateHtml,
        },
      });
    } else {
      // Create new campaign as draft
      await db.campaign.create({
        data: {
          shopId: shop.id,
          name,
          subject,
          templateJson: blocks as unknown as Record<string, unknown>[],
          templateHtml,
          status: "draft",
        },
      });
    }

    return json({ success: true, message: "Template saved successfully" });
  }

  if (intent === "delete") {
    const campaignId = formData.get("campaignId") as string;
    if (!campaignId) return json({ error: "Campaign ID required" }, { status: 400 });

    await db.campaign.delete({ where: { id: campaignId } });
    return json({ success: true, message: "Template deleted" });
  }

  if (intent === "clone-prebuilt") {
    const prebuiltId = formData.get("prebuiltId") as string;
    const template = getPrebuiltTemplate(prebuiltId);
    if (!template) {
      return json({ error: "Unknown prebuilt template" }, { status: 400 });
    }

    const templateHtml = renderEmailHtml(template.blocks);

    await db.campaign.create({
      data: {
        shopId: shop.id,
        name: template.name,
        subject: template.subject,
        templateJson: template.blocks as unknown as Record<string, unknown>[],
        templateHtml,
        status: "draft",
      },
    });

    return json({
      success: true,
      message: `"${template.name}" template cloned — edit it below`,
    });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

const DEFAULT_BLOCKS: EmailBlock[] = [
  { type: "text", content: "Hello! Here's our latest update." },
  { type: "divider" },
  { type: "button", text: "Shop Now", url: "https://example.com" },
];

export default function EmailTemplatesPage() {
  const { campaigns, prebuiltTemplates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [blocksText, setBlocksText] = useState(JSON.stringify(DEFAULT_BLOCKS, null, 2));
  const [previewHtml, setPreviewHtml] = useState("");

  const handleClonePrebuilt = (prebuiltId: string) => {
    const formData = new FormData();
    formData.set("intent", "clone-prebuilt");
    formData.set("prebuiltId", prebuiltId);
    submit(formData, { method: "post" });
  };

  const handleEdit = (campaign: typeof campaigns[0]) => {
    setEditingId(campaign.id);
    setName(campaign.name);
    setSubject(campaign.subject);
    setBlocksText(JSON.stringify(campaign.templateJson, null, 2));
    setPreviewHtml(campaign.templateHtml || "");
  };

  const handleNew = () => {
    setEditingId(null);
    setName("");
    setSubject("");
    setBlocksText(JSON.stringify(DEFAULT_BLOCKS, null, 2));
    setPreviewHtml("");
  };

  const handlePreview = () => {
    try {
      const blocks = JSON.parse(blocksText) as EmailBlock[];
      // Client-side preview: we'll just show the raw blocks info
      setPreviewHtml(`<p>Preview: ${blocks.length} blocks configured. Save to generate full HTML.</p>`);
    } catch {
      setPreviewHtml("<p style='color:red;'>Invalid JSON</p>");
    }
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.set("intent", "save");
    formData.set("name", name);
    formData.set("subject", subject);
    formData.set("blocks", blocksText);
    if (editingId) formData.set("campaignId", editingId);
    submit(formData, { method: "post" });
  };

  const handleDelete = (campaignId: string) => {
    if (!confirm("Delete this template?")) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("campaignId", campaignId);
    submit(formData, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Email Templates</h1>
        <button
          type="button"
          onClick={handleNew}
          style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
        >
          New Template
        </button>
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

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", marginBottom: "24px", backgroundColor: "#fafafa" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "4px" }}>Start from a prebuilt template</h2>
        <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "12px" }}>
          Clone any of these ready-to-use templates, then edit the copy to match your brand.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          {prebuiltTemplates.map((tpl) => (
            <div key={tpl.id} style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "12px", backgroundColor: "#fff" }}>
              <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "4px" }}>{tpl.name}</div>
              <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px", minHeight: "32px" }}>{tpl.description}</div>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "8px" }}>
                Subject: {tpl.subject.length > 40 ? tpl.subject.slice(0, 37) + "..." : tpl.subject}
              </div>
              <button
                type="button"
                onClick={() => handleClonePrebuilt(tpl.id)}
                style={{ width: "100%", padding: "6px 10px", fontSize: "12px", border: "1px solid #3b82f6", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff", color: "#3b82f6", fontWeight: "500" }}
              >
                Clone Template
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Editor Panel */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>
            {editingId ? "Edit Template" : "New Template"}
          </h2>

          <div style={{ marginBottom: "12px" }}>
            <label htmlFor="template-name" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Name</label>
            <input
              id="template-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}
              placeholder="Campaign name"
            />
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label htmlFor="template-subject" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Subject</label>
            <input
              id="template-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}
              placeholder="Email subject line"
            />
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label htmlFor="template-blocks" style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>
              Blocks (JSON)
            </label>
            <textarea
              id="template-blocks"
              value={blocksText}
              onChange={(e) => setBlocksText(e.target.value)}
              rows={12}
              style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px", fontFamily: "monospace", fontSize: "12px" }}
            />
            <p style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
              Block types: text, image, button, divider, product
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={handlePreview}
              style={{ padding: "8px 16px", backgroundColor: "#6b7280", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
            >
              Save Template
            </button>
          </div>
        </div>

        {/* Preview / Template List Panel */}
        <div>
          {previewHtml && (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>Preview</h3>
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          )}

          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>Saved Templates</h3>
            {campaigns.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No templates yet. Create your first one!</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {campaigns.map((c) => (
                  <li key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong>{c.name}</strong>
                      <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6b7280" }}>({c.status})</span>
                      <br />
                      <span style={{ fontSize: "13px", color: "#6b7280" }}>{c.subject}</span>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        type="button"
                        onClick={() => handleEdit(c)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #d1d5db", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff" }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #fca5a5", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff", color: "#dc2626" }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
