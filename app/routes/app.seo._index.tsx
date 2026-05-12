import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { Icon } from "~/components/Icon";

// Requirements: 12.4, 12.5, 12.6, 12.7, 12.9

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditFinding {
  id: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  issue: string;
  description: string;
  page: string;
}

interface AutomationSetting {
  key: "autoMetaTags" | "autoAltText" | "autoSchema";
  icon: string;
  title: string;
  description: string;
  enabled: boolean;
}

interface ConnectedChannel {
  id: string;
  name: string;
  icon: string;
  status: "connected" | "action_required" | "disconnected";
  detail: string;
}

// ---------------------------------------------------------------------------
// Mutable mock data
// ---------------------------------------------------------------------------

let mockAutomations: AutomationSetting[] = [
  {
    key: "autoMetaTags",
    icon: "description",
    title: "Dynamic Meta Tags",
    description: "Auto-generate SEO titles & descriptions for new products using AI.",
    enabled: true,
  },
  {
    key: "autoAltText",
    icon: "image_search",
    title: "Alt Text Optimization",
    description: "Fill missing image alt attributes via AI visual analysis.",
    enabled: true,
  },
  {
    key: "autoSchema",
    icon: "data_object",
    title: "JSON-LD Schema Markup",
    description: "Inject structured data for rich results in Google Search.",
    enabled: false,
  },
];

let mockAuditFindings: AuditFinding[] = [
  {
    id: "1",
    severity: "CRITICAL",
    issue: "Missing Meta Title",
    description: "14 products are missing SEO meta titles, reducing search visibility.",
    page: "/products/*",
  },
  {
    id: "2",
    severity: "CRITICAL",
    issue: "Duplicate Meta Descriptions",
    description: "7 pages share identical meta descriptions, causing keyword cannibalization.",
    page: "/collections/*",
  },
  {
    id: "3",
    severity: "WARNING",
    issue: "Images Missing Alt Text",
    description: "32 product images have no alt attribute, impacting accessibility and image SEO.",
    page: "/products/*",
  },
  {
    id: "4",
    severity: "WARNING",
    issue: "Slow Page Speed",
    description: "Homepage LCP is 4.2s (target < 2.5s). Compress images and defer scripts.",
    page: "/",
  },
  {
    id: "5",
    severity: "INFO",
    issue: "Schema Markup Not Detected",
    description: "No JSON-LD structured data found. Enable auto-schema to add rich results.",
    page: "Sitewide",
  },
  {
    id: "6",
    severity: "INFO",
    issue: "Sitemap Not Submitted",
    description: "Your XML sitemap has not been submitted to Google Search Console.",
    page: "/sitemap.xml",
  },
];

const mockChannels: ConnectedChannel[] = [
  {
    id: "gsc",
    name: "Google Search Console",
    icon: "travel_explore",
    status: "connected",
    detail: "Synced 2 hours ago",
  },
  {
    id: "bing",
    name: "Bing Webmaster Tools",
    icon: "public",
    status: "action_required",
    detail: "Verification token expired",
  },
];

let mockHealthScore = 82;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const stats = {
    criticalCount: mockAuditFindings.filter((f) => f.severity === "CRITICAL").length,
    warningCount: mockAuditFindings.filter((f) => f.severity === "WARNING").length,
    infoCount: mockAuditFindings.filter((f) => f.severity === "INFO").length,
  };

  return json({
    healthScore: mockHealthScore,
    automations: mockAutomations,
    auditFindings: mockAuditFindings,
    channels: mockChannels,
    stats,
    lastAudit: "Today, 08:45 AM",
  });
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "run-audit") {
    // Simulate audit improving the score slightly
    mockHealthScore = Math.min(100, mockHealthScore + Math.floor(Math.random() * 5));
    return json({ success: true, message: "SEO audit completed. Health score updated.", error: null });
  }

  if (intent === "fix-issue") {
    const issueId = formData.get("issueId") as string;
    const idx = mockAuditFindings.findIndex((f) => f.id === issueId);
    if (idx === -1) {
      return json({ error: "Issue not found", success: false }, { status: 404 });
    }
    // Remove fixed issue and improve score
    mockAuditFindings.splice(idx, 1);
    mockHealthScore = Math.min(100, mockHealthScore + 3);
    return json({ success: true, message: `Issue #${issueId} fixed successfully.`, error: null });
  }

  if (intent === "toggle-automation") {
    const key = formData.get("key") as AutomationSetting["key"];
    const value = formData.get("value") === "true";
    const automation = mockAutomations.find((a) => a.key === key);
    if (automation) {
      automation.enabled = value;
    }
    return json({ success: true, message: `${automation?.title ?? "Setting"} ${value ? "enabled" : "disabled"}.`, error: null });
  }

  if (intent === "generate-meta") {
    mockHealthScore = Math.min(100, mockHealthScore + 2);
    return json({ success: true, message: "AI meta content generated successfully.", error: null });
  }

  return json({ error: "Unknown intent", success: false }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityConfig(severity: AuditFinding["severity"]) {
  switch (severity) {
    case "CRITICAL":
      return {
        badge: "bg-error-container text-on-error-container",
        icon: "report",
        dot: "bg-error",
      };
    case "WARNING":
      return {
        badge: "bg-tertiary-fixed text-tertiary",
        icon: "warning",
        dot: "bg-tertiary",
      };
    case "INFO":
    default:
      return {
        badge: "bg-secondary-container text-on-secondary-container",
        icon: "info",
        dot: "bg-secondary",
      };
  }
}

function channelStatusConfig(status: ConnectedChannel["status"]) {
  switch (status) {
    case "connected":
      return {
        pill: "bg-secondary-container text-on-secondary-container",
        label: "Connected",
        icon: "check_circle",
      };
    case "action_required":
      return {
        pill: "bg-tertiary-fixed text-tertiary",
        label: "Action Required",
        icon: "error_outline",
      };
    case "disconnected":
    default:
      return {
        pill: "bg-surface-container text-on-surface-variant",
        label: "Disconnected",
        icon: "cancel",
      };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Circular progress ring using CSS conic-gradient */
function HealthScoreRing({ score }: { score: number }) {
  const label = score >= 80 ? "EXCELLENT" : score >= 60 ? "GOOD" : "NEEDS WORK";
  const ringColor =
    score >= 80
      ? "var(--tw-color-secondary, #006c4e)"
      : score >= 60
      ? "var(--tw-color-tertiary, #78352b)"
      : "var(--tw-color-error, #ba1a1a)";

  return (
    <div className="flex flex-col items-center gap-md">
      {/* Conic-gradient ring */}
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: 160,
          height: 160,
          background: `conic-gradient(${ringColor} ${score * 3.6}deg, #e0e3e0 0deg)`,
          borderRadius: "50%",
        }}
        role="img"
        aria-label={`SEO health score: ${score}%`}
      >
        {/* Inner white circle */}
        <div
          className="absolute bg-surface-container-lowest rounded-full flex flex-col items-center justify-center"
          style={{ width: 128, height: 128 }}
        >
          <span
            className="font-bold leading-none"
            style={{
              fontSize: 36,
              color: score >= 80 ? "#006c4e" : score >= 60 ? "#78352b" : "#ba1a1a",
            }}
          >
            {score}%
          </span>
          <span className="text-label-sm text-on-surface-variant font-semibold tracking-wider mt-1">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Toggle switch */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        checked ? "bg-primary" : "bg-outline-variant"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SeoPage() {
  const { healthScore, automations, auditFindings, channels, stats, lastAudit } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isRunningAudit =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "run-audit";

  // Local toggle state (optimistic)
  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(automations.map((a) => [a.key, a.enabled]))
  );

  const handleRunAudit = () => {
    const fd = new FormData();
    fd.set("intent", "run-audit");
    submit(fd, { method: "post" });
  };

  const handleToggle = (key: string, value: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: value }));
    const fd = new FormData();
    fd.set("intent", "toggle-automation");
    fd.set("key", key);
    fd.set("value", String(value));
    submit(fd, { method: "post" });
  };

  const handleFixIssue = (issueId: string) => {
    const fd = new FormData();
    fd.set("intent", "fix-issue");
    fd.set("issueId", issueId);
    submit(fd, { method: "post" });
  };

  const handleGenerateMeta = () => {
    const fd = new FormData();
    fd.set("intent", "generate-meta");
    submit(fd, { method: "post" });
  };

  return (
    <main className="p-lg max-w-container-max mx-auto font-sans space-y-lg">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md">
        <div>
          <h1 className="text-display-lg font-bold text-on-surface">SEO Automation</h1>
          <p className="text-body-lg text-on-surface-variant mt-xs">
            <Icon name="schedule" size={16} className="inline align-middle mr-1 text-outline" />
            Last audit:{" "}
            <span className="font-semibold text-on-surface">{lastAudit}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleRunAudit}
          disabled={isRunningAudit}
          className="inline-flex items-center gap-xs bg-primary text-on-primary text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm disabled:opacity-60 self-start sm:self-auto"
        >
          <Icon name={isRunningAudit ? "hourglass_top" : "manage_search"} size={18} />
          {isRunningAudit ? "Running Audit…" : "Run Audit Now"}
        </button>
      </div>

      {/* ── Toast notifications ── */}
      {(actionData as { message?: string } | null)?.message && (
        <div
          role="status"
          className="flex items-center gap-xs bg-secondary-container text-on-secondary-container px-sm py-xs rounded-lg text-label-md"
        >
          <Icon name="check_circle" size={18} />
          {(actionData as { message: string }).message}
        </div>
      )}
      {actionData?.error && (
        <div
          role="alert"
          className="flex items-center gap-xs bg-error-container text-on-error-container px-sm py-xs rounded-lg text-label-md"
        >
          <Icon name="error" size={18} />
          {actionData.error}
        </div>
      )}

      {/* ── Row 1: Health Score (5 cols) + Auto-Fix Automation (7 cols) ── */}
      <div className="grid grid-cols-12 gap-md">
        {/* SEO Health Score card */}
        <div className="col-span-12 lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-xl p-lg shadow-sm flex flex-col items-center text-center gap-md">
          <div className="w-full flex items-center justify-between">
            <h2 className="text-headline-sm font-semibold text-on-surface">SEO Health Score</h2>
            <span className="text-label-sm text-on-secondary-container bg-secondary-container px-xs py-0.5 rounded-full font-semibold">
              Updated today
            </span>
          </div>

          <HealthScoreRing score={healthScore} />

          <p className="text-body-md text-on-surface-variant max-w-xs">
            Your store's SEO is performing well. Fix the critical issues below to push your score
            above 90.
          </p>

          {/* Mini stat row */}
          <div className="grid grid-cols-3 gap-sm w-full">
            <div className="bg-error-container rounded-lg p-xs text-center">
              <span className="text-headline-sm font-bold text-on-error-container">
                {stats.criticalCount}
              </span>
              <p className="text-label-sm text-on-error-container opacity-80 mt-0.5">Critical</p>
            </div>
            <div className="bg-tertiary-fixed rounded-lg p-xs text-center">
              <span className="text-headline-sm font-bold text-tertiary">
                {stats.warningCount}
              </span>
              <p className="text-label-sm text-tertiary opacity-80 mt-0.5">Warnings</p>
            </div>
            <div className="bg-secondary-container rounded-lg p-xs text-center">
              <span className="text-headline-sm font-bold text-on-secondary-container">
                {stats.infoCount}
              </span>
              <p className="text-label-sm text-on-secondary-container opacity-80 mt-0.5">Info</p>
            </div>
          </div>
        </div>

        {/* Auto-Fix Automation card */}
        <div className="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded-xl p-lg shadow-sm flex flex-col gap-md">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-sm font-semibold text-on-surface">Auto-Fix Automation</h2>
            <span className="bg-secondary-container text-on-secondary-container px-xs py-0.5 rounded-full text-label-sm font-bold uppercase tracking-wide">
              Active
            </span>
          </div>
          <p className="text-body-md text-on-surface-variant -mt-xs">
            Enable automations to let Nexify AI continuously fix SEO issues in the background.
          </p>

          <div className="flex flex-col gap-sm flex-1 justify-center">
            {automations.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between p-sm border border-outline-variant rounded-xl hover:border-primary transition-colors"
              >
                <div className="flex items-center gap-sm">
                  <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center shrink-0">
                    <Icon name={item.icon} size={22} className="text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-xs">
                      <p className="text-label-md font-semibold text-on-surface">{item.title}</p>
                      {toggles[item.key] ? (
                        <Icon name="check_circle" size={16} className="text-secondary" />
                      ) : (
                        <Icon name="cancel" size={16} className="text-outline" />
                      )}
                    </div>
                    <p className="text-label-sm text-on-surface-variant">{item.description}</p>
                  </div>
                </div>
                <Toggle
                  checked={toggles[item.key]}
                  onChange={(v) => handleToggle(item.key, v)}
                  label={`Toggle ${item.title}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 2: Audit Findings (full width) ── */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-sm">
        {/* Table header */}
        <div className="px-lg py-md bg-surface-container-low border-b border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-sm">
          <h2 className="text-headline-sm font-semibold text-on-surface">Audit Findings</h2>
          <div className="flex flex-wrap items-center gap-sm text-label-md">
            <span className="flex items-center gap-xs">
              <span className="w-2 h-2 rounded-full bg-error inline-block" />
              <span className="text-on-surface-variant">
                {stats.criticalCount} Critical
              </span>
            </span>
            <span className="flex items-center gap-xs">
              <span className="w-2 h-2 rounded-full bg-tertiary inline-block" />
              <span className="text-on-surface-variant">
                {stats.warningCount} Warnings
              </span>
            </span>
            <span className="flex items-center gap-xs">
              <span className="w-2 h-2 rounded-full bg-secondary inline-block" />
              <span className="text-on-surface-variant">
                {stats.infoCount} Info
              </span>
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low">
                <th className="text-left px-lg py-xs text-label-md text-on-surface-variant font-semibold w-28">
                  Severity
                </th>
                <th className="text-left px-md py-xs text-label-md text-on-surface-variant font-semibold">
                  Issue
                </th>
                <th className="text-left px-md py-xs text-label-md text-on-surface-variant font-semibold hidden md:table-cell">
                  Affected Page
                </th>
                <th className="text-right px-lg py-xs text-label-md text-on-surface-variant font-semibold w-36">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {auditFindings.map((finding) => {
                const cfg = severityConfig(finding.severity);
                return (
                  <tr
                    key={finding.id}
                    className="hover:bg-surface-container-low transition-colors"
                  >
                    {/* Severity badge */}
                    <td className="px-lg py-sm">
                      <span
                        className={`inline-flex items-center gap-xs px-xs py-0.5 rounded text-label-sm font-bold ${cfg.badge}`}
                      >
                        <Icon name={cfg.icon} size={14} />
                        {finding.severity}
                      </span>
                    </td>

                    {/* Issue + description */}
                    <td className="px-md py-sm">
                      <p className="text-label-md font-semibold text-on-surface">
                        {finding.issue}
                      </p>
                      <p className="text-label-sm text-on-surface-variant mt-0.5">
                        {finding.description}
                      </p>
                    </td>

                    {/* Page */}
                    <td className="px-md py-sm hidden md:table-cell">
                      <span className="text-label-sm text-on-surface-variant font-mono bg-surface-container px-xs py-0.5 rounded">
                        {finding.page}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="px-lg py-sm text-right">
                      <button
                        type="button"
                        onClick={() => handleFixIssue(finding.id)}
                        className="inline-flex items-center gap-xs text-label-sm font-semibold text-primary border border-primary px-sm py-0.5 rounded-lg hover:bg-primary hover:text-on-primary transition-colors"
                      >
                        <Icon name="auto_fix_high" size={14} />
                        Auto-Fix
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Row 3: AI Meta Generator (8 cols) + Connected Channels (4 cols) ── */}
      <div className="grid grid-cols-12 gap-md">
        {/* AI Meta Generator card */}
        <div className="col-span-12 lg:col-span-8 bg-primary-container rounded-xl overflow-hidden shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 h-full">
            {/* Left: content */}
            <div className="p-lg flex flex-col gap-md">
              {/* Label */}
              <div className="flex items-center gap-xs">
                <Icon name="auto_awesome" size={20} className="text-on-primary-container" />
                <span className="text-label-sm font-bold text-on-primary-container uppercase tracking-widest">
                  Nexify AI Engine
                </span>
              </div>

              {/* Headline */}
              <div>
                <h2 className="text-headline-md font-bold text-on-primary-container leading-snug">
                  AI-Powered Meta Generator
                </h2>
                <p className="text-body-md text-on-primary-container opacity-80 mt-xs">
                  Generate optimised meta titles and descriptions for your entire product catalogue
                  in seconds. Trained on top-performing e-commerce copy.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex flex-wrap gap-sm mt-auto">
                <button
                  type="button"
                  onClick={handleGenerateMeta}
                  className="inline-flex items-center gap-xs bg-on-primary-container text-primary-container text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm"
                >
                  <Icon name="bolt" size={18} />
                  Generate Now
                </button>

              </div>
            </div>

            {/* Right: mock code preview */}
            <div className="bg-black bg-opacity-30 p-md flex flex-col gap-xs font-mono text-[12px] overflow-hidden">
              <div className="flex items-center gap-xs mb-xs">
                <span className="w-3 h-3 rounded-full bg-error opacity-70" />
                <span className="w-3 h-3 rounded-full bg-tertiary-fixed opacity-70" />
                <span className="w-3 h-3 rounded-full bg-secondary-container opacity-70" />
                <span className="text-on-primary-container opacity-50 ml-xs text-[11px]">
                  meta-output.json
                </span>
              </div>
              <pre className="text-on-primary-container opacity-90 leading-relaxed overflow-hidden whitespace-pre-wrap break-all">
{`{
  "product": "Wireless Headphones Pro",
  "metaTitle": "Wireless Headphones Pro
    – Premium Sound | YourStore",
  "metaDescription": "Experience
    studio-quality audio with 40h
    battery life. Free shipping on
    orders over $50.",
  "keywords": [
    "wireless headphones",
    "noise cancelling",
    "bluetooth audio"
  ]
}`}
              </pre>
            </div>
          </div>
        </div>

        {/* Connected Channels card */}
        <div className="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl p-lg shadow-sm flex flex-col gap-md">
          <h2 className="text-headline-sm font-semibold text-on-surface">Connected Channels</h2>
          <p className="text-body-md text-on-surface-variant -mt-xs">
            Sync your SEO data with search engine tools.
          </p>

          <div className="flex flex-col gap-sm flex-1">
            {channels.map((ch) => {
              const cfg = channelStatusConfig(ch.status);
              return (
                <div
                  key={ch.id}
                  className="flex items-center justify-between p-sm border border-outline-variant rounded-xl"
                >
                  <div className="flex items-center gap-sm">
                    <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center shrink-0">
                      <Icon name={ch.icon} size={22} className="text-primary" />
                    </div>
                    <div>
                      <p className="text-label-md font-semibold text-on-surface">{ch.name}</p>
                      <p className="text-label-sm text-on-surface-variant">{ch.detail}</p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-xs px-xs py-0.5 rounded-full text-label-sm font-semibold shrink-0 ${cfg.pill}`}
                  >
                    <Icon name={cfg.icon} size={14} />
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>


        </div>
      </div>
    </main>
  );
}
