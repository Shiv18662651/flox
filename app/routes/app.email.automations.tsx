// Email automations route - automation management
// Requirements: 7.7, 7.8, 7.9

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation, Link, useLocation } from "@remix-run/react";
import { useState, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { renderEmailHtml, type EmailBlock } from "~/utils/email-renderer.server";
import { Icon } from "~/components/Icon";
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
    <main className="p-lg max-w-container-max mx-auto font-sans pb-24">
      <EmailNav />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md mb-lg">
        <h1 className="text-display-lg font-bold text-on-surface">Email Automations</h1>
        <div className="flex gap-xs">
          <button
            type="button"
            onClick={() => setShowAiModal(true)}
            className="inline-flex items-center gap-xs bg-tertiary-container text-on-tertiary-container text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm"
          >
            <Icon name="auto_awesome" size={18} />
            AI Builder
          </button>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-xs bg-primary text-on-primary text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm"
          >
            {showForm ? "Cancel" : "New Automation"}
          </button>
        </div>
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

      {showAiModal && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md mb-lg shadow-sm">
          <h2 className="text-headline-sm font-semibold text-on-surface mb-sm flex items-center gap-xs">
            <Icon name="auto_awesome" size={20} className="text-tertiary" />
            AI Flow Builder
          </h2>
          <p className="text-body-md text-on-surface-variant mb-md">
            Describe the automation you want and let AI build it for you.
          </p>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Send a welcome email to new customers with a 10% discount code, 1 hour after they sign up"
            className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition mb-md"
          />
          <div className="flex gap-xs">
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => {
                const fd = new FormData();
                fd.set("intent", "generate");
                fd.set("description", aiPrompt);
                submit(fd, { method: "post" });
              }}
              className="px-sm py-xs rounded-lg bg-tertiary-container text-on-tertiary-container text-label-md font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? "Generating..." : "Generate Flow"}
            </button>
            <button
              type="button"
              onClick={() => setShowAiModal(false)}
              className="px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md mb-lg shadow-sm">
          <h2 className="text-headline-sm font-semibold text-on-surface mb-md">
            {aiGenerated ? "AI-Generated Flow (Review & Save)" : "Create Automation"}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md mb-md">
            <div>
              <label htmlFor="auto-name" className="block text-label-md font-medium text-on-surface mb-xs">Name</label>
              <input id="auto-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" placeholder="Automation name" />
            </div>
            <div>
              <label htmlFor="auto-trigger" className="block text-label-md font-medium text-on-surface mb-xs">Trigger</label>
              <select id="auto-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition appearance-none">
                {TRIGGER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="auto-subject" className="block text-label-md font-medium text-on-surface mb-xs">Subject</label>
              <input id="auto-subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" placeholder="Email subject" />
            </div>
            <div>
              <label htmlFor="auto-delay" className="block text-label-md font-medium text-on-surface mb-xs">Delay (minutes)</label>
              <input id="auto-delay" type="number" value={delayMinutes} onChange={(e) => setDelayMinutes(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" />
            </div>
          </div>

          <div className="mb-md">
            <label htmlFor="auto-blocks" className="block text-label-md font-medium text-on-surface mb-xs">Template Blocks (JSON)</label>
            <textarea id="auto-blocks" value={blocksText} onChange={(e) => setBlocksText(e.target.value)} rows={6} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition font-mono text-label-sm" />
          </div>

          <button type="button" onClick={handleCreate} className="px-sm py-xs rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity">
            Create Automation
          </button>
        </div>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Name</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Trigger</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Subject</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Delay</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Sent</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Status</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {automations.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-xl px-md text-center text-on-surface-variant">
                  <div className="flex flex-col items-center justify-center gap-sm">
                    <Icon name="bolt" size={48} className="opacity-40" />
                    <p className="text-body-lg font-medium">No automations yet</p>
                    <p className="text-body-md">Create your first one!</p>
                  </div>
                </td>
              </tr>
            ) : (
              automations.map((a) => (
                <tr key={a.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-md py-sm text-body-md text-on-surface">{a.name}</td>
                  <td className="px-md py-sm text-body-md text-on-surface">
                    {TRIGGER_OPTIONS.find((t) => t.value === a.trigger)?.label || a.trigger}
                  </td>
                  <td className="px-md py-sm text-body-md text-on-surface-variant">{a.subject}</td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">{a.delayMinutes}m</td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">{a.totalSent}</td>
                  <td className="px-md py-sm text-center">
                    <span className={`inline-block px-sm py-[2px] rounded-full text-label-sm font-semibold ${
                      a.isActive ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"
                    }`}>
                      {a.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-md py-sm text-center">
                    <div className="flex gap-xs justify-center">
                      <button
                        type="button"
                        onClick={() => handleToggle(a.id)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors"
                      >
                        {a.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-error-container text-on-error-container rounded-md hover:bg-error-container transition-colors"
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
    </main>
  );
}
