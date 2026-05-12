// Email template editor route
// Requirements: 7.1, 7.2

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, Link, useLocation } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { renderEmailHtml, type EmailBlock } from "~/utils/email-renderer.server";
import { Icon } from "~/components/Icon";
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
    <main className="p-lg max-w-container-max mx-auto font-sans pb-24">
      <EmailNav />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md mb-lg">
        <h1 className="text-display-lg font-bold text-on-surface">Email Templates</h1>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex items-center gap-xs bg-primary text-on-primary text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm"
        >
          <Icon name="add" size={18} />
          New Template
        </button>
      </div>

      {(actionData as { error?: string })?.error && (
        <div role="alert" className="mb-md px-sm py-xs rounded-lg bg-error-container text-on-error-container flex items-center gap-xs text-label-md">
          <Icon name="error" size={16} />
          {(actionData as { error: string }).error}
        </div>
      )}

      {(actionData as { message?: string })?.message && (
        <div role="status" className="mb-md px-sm py-xs rounded-lg bg-secondary-container text-on-secondary-container flex items-center gap-xs text-label-md">
          <Icon name="check_circle" size={16} />
          {(actionData as { message: string }).message}
        </div>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md mb-lg shadow-sm">
        <h2 className="text-headline-sm font-semibold text-on-surface mb-xs">Start from a prebuilt template</h2>
        <p className="text-body-md text-on-surface-variant mb-md">
          Clone any of these ready-to-use templates, then edit the copy to match your brand.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-md">
          {prebuiltTemplates.map((tpl) => (
            <div key={tpl.id} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-md flex flex-col gap-xs">
              <div className="text-label-md font-semibold text-on-surface">{tpl.name}</div>
              <div className="text-label-sm text-on-surface-variant min-h-[32px]">{tpl.description}</div>
              <div className="text-label-sm text-on-surface-variant opacity-70">
                Subject: {tpl.subject.length > 40 ? tpl.subject.slice(0, 37) + "..." : tpl.subject}
              </div>
              <button
                type="button"
                onClick={() => handleClonePrebuilt(tpl.id)}
                className="mt-auto w-full px-sm py-xs text-label-sm font-semibold border border-primary text-primary rounded-md hover:bg-primary-container transition-colors"
              >
                Clone Template
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        {/* Editor Panel */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-sm">
          <h2 className="text-headline-sm font-semibold text-on-surface mb-md">
            {editingId ? "Edit Template" : "New Template"}
          </h2>

          <div className="mb-md space-y-sm">
            <div>
              <label htmlFor="template-name" className="block text-label-md font-medium text-on-surface mb-xs">Name</label>
              <input
                id="template-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
                placeholder="Campaign name"
              />
            </div>

            <div>
              <label htmlFor="template-subject" className="block text-label-md font-medium text-on-surface mb-xs">Subject</label>
              <input
                id="template-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
                placeholder="Email subject line"
              />
            </div>

            <div>
              <label htmlFor="template-blocks" className="block text-label-md font-medium text-on-surface mb-xs">
                Blocks (JSON)
              </label>
              <textarea
                id="template-blocks"
                value={blocksText}
                onChange={(e) => setBlocksText(e.target.value)}
                rows={12}
                className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition font-mono text-label-sm"
              />
              <p className="text-label-sm text-on-surface-variant mt-xs">
                Block types: text, image, button, divider, product
              </p>
            </div>
          </div>

          <div className="flex gap-xs">
            <button
              type="button"
              onClick={handlePreview}
              className="px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-sm py-xs rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity"
            >
              Save Template
            </button>
          </div>
        </div>

        {/* Preview / Template List Panel */}
        <div className="space-y-md">
          {previewHtml && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-sm">
              <h3 className="text-headline-sm font-semibold text-on-surface mb-sm">Preview</h3>
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          )}

          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-sm">
            <h3 className="text-headline-sm font-semibold text-on-surface mb-md">Saved Templates</h3>
            {campaigns.length === 0 ? (
              <p className="text-body-md text-on-surface-variant">No templates yet. Create your first one!</p>
            ) : (
              <ul className="divide-y divide-outline-variant">
                {campaigns.map((c) => (
                  <li key={c.id} className="py-sm flex items-center justify-between gap-md">
                    <div>
                      <span className="text-body-md font-semibold text-on-surface">{c.name}</span>
                      <span className="ml-xs text-label-sm text-on-surface-variant">({c.status})</span>
                      <p className="text-body-sm text-on-surface-variant">{c.subject}</p>
                    </div>
                    <div className="flex gap-xs">
                      <button
                        type="button"
                        onClick={() => handleEdit(c)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-error-container text-on-error-container rounded-md hover:bg-error-container transition-colors"
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
    </main>
  );
}
