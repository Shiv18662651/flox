// Analytics Dashboard
// Requirements: 10.5, 10.6, 10.7, 10.8

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevenuePoint {
  label: string;
  value: number;
}

interface FunnelStep {
  label: string;
  count: number;
  pct: number;
}

interface Channel {
  name: string;
  sessions: number;
  revenue: number;
  convRate: number;
}

interface TopProduct {
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
  imageColor: string; // tailwind bg color for placeholder
}

// ---------------------------------------------------------------------------
// Loader — mock data matching the design spec
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "2024-06-01";
  const end = url.searchParams.get("end") ?? "2024-06-30";

  const revenueOverTime: RevenuePoint[] = [
    { label: "Jun 1", value: 3200 },
    { label: "Jun 5", value: 4800 },
    { label: "Jun 8", value: 3900 },
    { label: "Jun 10", value: 6200 },
    { label: "Jun 12", value: 5100 },
    { label: "Jun 15", value: 7400 },
    { label: "Jun 17", value: 4600 },
    { label: "Jun 19", value: 8100 },
    { label: "Jun 21", value: 6700 },
    { label: "Jun 23", value: 9200 },
    { label: "Jun 25", value: 7800 },
    { label: "Jun 27", value: 10500 },
    { label: "Jun 29", value: 8900 },
    { label: "Jun 30", value: 11780 },
  ];

  const funnel: FunnelStep[] = [
    { label: "Page Views", count: 42890, pct: 100 },
    { label: "Add to Cart", count: 12430, pct: 29 },
    { label: "Checkout", count: 5210, pct: 12 },
    { label: "Purchase", count: 1429, pct: 3.33 },
  ];

  const channels: Channel[] = [
    { name: "Direct", sessions: 14320, revenue: 48200, convRate: 4.1 },
    { name: "Google Search", sessions: 18540, revenue: 42100, convRate: 3.8 },
    { name: "Facebook Ads", sessions: 7230, revenue: 24600, convRate: 2.9 },
    { name: "Email Campaigns", sessions: 2800, revenue: 13530, convRate: 5.2 },
  ];

  const topProducts: TopProduct[] = [
    {
      name: "Premium Wireless Headphones",
      category: "Electronics",
      unitsSold: 342,
      revenue: 41040,
      imageColor: "bg-secondary-container",
    },
    {
      name: "Ergonomic Office Chair",
      category: "Furniture",
      unitsSold: 128,
      revenue: 38400,
      imageColor: "bg-primary-fixed",
    },
    {
      name: "Organic Skincare Set",
      category: "Beauty",
      unitsSold: 519,
      revenue: 25950,
      imageColor: "bg-tertiary-fixed",
    },
  ];

  return json({
    dateRange: { start, end },
    metrics: {
      revenue: 128430,
      orders: 1429,
      uniqueVisitors: 42890,
      conversionRate: 3.33,
    },
    revenueOverTime,
    funnel,
    channels,
    topProducts,
    retention: { returning: 65, new: 35 },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

function fmtUSD(n: number) {
  return "$" + n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  trend?: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-md border border-outline-variant shadow-sm flex flex-col gap-xs">
      <div className="flex items-center justify-between">
        <span className="material-symbols-outlined text-primary text-[22px]">
          {icon}
        </span>
        {trend && (
          <span className="text-label-sm text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full">
            {trend}
          </span>
        )}
      </div>
      <p className="text-on-surface-variant text-label-md">{label}</p>
      <p className="text-headline-md font-bold text-on-surface">{value}</p>
      {sub && <p className="text-label-sm text-on-surface-variant">{sub}</p>}
    </div>
  );
}

function SectionCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden ${className}`}
    >
      <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low">
        <h2 className="text-headline-sm font-semibold text-on-surface">
          {title}
        </h2>
      </div>
      <div className="p-md">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue Bar Chart
// ---------------------------------------------------------------------------

function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-[6px] h-40 w-full">
      {data.map((point) => {
        const heightPct = Math.round((point.value / max) * 100);
        return (
          <div
            key={point.label}
            className="flex flex-col items-center flex-1 gap-1 group"
          >
            <div
              className="w-full rounded-t-sm bg-primary opacity-80 group-hover:opacity-100 transition-opacity relative"
              style={{ height: `${heightPct}%` }}
              title={`${point.label}: ${fmtUSD(point.value)}`}
            />
            <span className="text-[10px] text-on-surface-variant rotate-45 origin-left whitespace-nowrap hidden sm:block">
              {point.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversion Funnel
// ---------------------------------------------------------------------------

function ConversionFunnel({ steps }: { steps: FunnelStep[] }) {
  return (
    <div className="flex flex-col gap-sm">
      {steps.map((step, i) => (
        <div key={step.label} className="flex flex-col gap-[6px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-xs">
              <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span className="text-body-md text-on-surface font-medium">
                {step.label}
              </span>
            </div>
            <div className="flex items-center gap-sm">
              <span className="text-label-md text-on-surface-variant">
                {fmt(step.count)}
              </span>
              <span className="text-label-sm text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full min-w-[44px] text-center">
                {step.pct}%
              </span>
            </div>
          </div>
          <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${step.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel Attribution Table
// ---------------------------------------------------------------------------

function ChannelTable({ channels }: { channels: Channel[] }) {
  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-md">
        <thead>
          <tr className="border-b border-outline-variant">
            <th className="text-left py-xs px-sm text-label-md text-on-surface-variant font-semibold">
              Channel
            </th>
            <th className="text-right py-xs px-sm text-label-md text-on-surface-variant font-semibold">
              Sessions
            </th>
            <th className="text-right py-xs px-sm text-label-md text-on-surface-variant font-semibold">
              Revenue
            </th>
            <th className="text-right py-xs px-sm text-label-md text-on-surface-variant font-semibold">
              Conv. Rate
            </th>
            <th className="text-right py-xs px-sm text-label-md text-on-surface-variant font-semibold">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => {
            const share = Math.round((ch.revenue / totalRevenue) * 100);
            return (
              <tr
                key={ch.name}
                className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors"
              >
                <td className="py-sm px-sm font-medium text-on-surface">
                  {ch.name}
                </td>
                <td className="py-sm px-sm text-right text-on-surface-variant">
                  {fmt(ch.sessions)}
                </td>
                <td className="py-sm px-sm text-right font-semibold text-on-surface">
                  {fmtUSD(ch.revenue)}
                </td>
                <td className="py-sm px-sm text-right">
                  <span className="text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full text-label-sm">
                    {ch.convRate}%
                  </span>
                </td>
                <td className="py-sm px-sm text-right">
                  <div className="flex items-center justify-end gap-xs">
                    <div className="w-16 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className="text-label-sm text-on-surface-variant w-8 text-right">
                      {share}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retention Donut (SVG)
// ---------------------------------------------------------------------------

function RetentionDonut({
  returning: ret,
  newPct,
}: {
  returning: number;
  newPct: number;
}) {
  // SVG donut: r=40, cx=cy=50, circumference = 2π*40 ≈ 251.33
  const r = 40;
  const cx = 50;
  const cy = 50;
  const circ = 2 * Math.PI * r;
  const retDash = (ret / 100) * circ;
  const newDash = (newPct / 100) * circ;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-lg">
      <div className="relative shrink-0">
        <svg width="120" height="120" viewBox="0 0 100 100" aria-label="Customer retention donut chart">
          {/* Background ring */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--color-surface-container-high, #e5e9e5)"
            strokeWidth="14"
          />
          {/* Returning customers arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--color-primary, #005440)"
            strokeWidth="14"
            strokeDasharray={`${retDash} ${circ - retDash}`}
            strokeDashoffset={circ / 4} /* start at top */
            strokeLinecap="round"
          />
          {/* New customers arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--color-secondary-container, #83f5c6)"
            strokeWidth="14"
            strokeDasharray={`${newDash} ${circ - newDash}`}
            strokeDashoffset={circ / 4 - retDash}
            strokeLinecap="round"
          />
          {/* Center label */}
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            className="fill-on-surface"
            style={{ fontSize: "14px", fontWeight: 700, fontFamily: "Inter, sans-serif" }}
          >
            {ret}%
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            className="fill-on-surface-variant"
            style={{ fontSize: "8px", fontFamily: "Inter, sans-serif" }}
          >
            returning
          </text>
        </svg>
      </div>
      <div className="flex flex-col gap-sm flex-1">
        <div className="flex items-center gap-sm">
          <span className="w-3 h-3 rounded-full bg-primary shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between text-body-md">
              <span className="text-on-surface font-medium">Returning Customers</span>
              <span className="font-bold text-on-surface">{ret}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-container-high mt-1 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${ret}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-sm">
          <span className="w-3 h-3 rounded-full bg-secondary-container shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between text-body-md">
              <span className="text-on-surface font-medium">New Customers</span>
              <span className="font-bold text-on-surface">{newPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-container-high mt-1 overflow-hidden">
              <div
                className="h-full rounded-full bg-secondary-container"
                style={{ width: `${newPct}%` }}
              />
            </div>
          </div>
        </div>
        <p className="text-label-sm text-on-surface-variant mt-xs">
          Based on last 30 days of purchase data
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Products
// ---------------------------------------------------------------------------

function TopProducts({ products }: { products: TopProduct[] }) {
  return (
    <div className="flex flex-col gap-sm">
      {products.map((p, i) => (
        <div
          key={p.name}
          className="flex items-center gap-md p-sm rounded-lg hover:bg-surface-container-low transition-colors"
        >
          {/* Rank */}
          <span className="text-label-md font-bold text-on-surface-variant w-4 shrink-0">
            {i + 1}
          </span>
          {/* Image placeholder */}
          <div
            className={`w-10 h-10 rounded-lg ${p.imageColor} flex items-center justify-center shrink-0`}
          >
            <span className="material-symbols-outlined text-primary text-[20px]">
              inventory_2
            </span>
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-body-md font-semibold text-on-surface truncate">
              {p.name}
            </p>
            <p className="text-label-sm text-on-surface-variant">{p.category}</p>
          </div>
          {/* Stats */}
          <div className="text-right shrink-0">
            <p className="text-body-md font-bold text-on-surface">
              {fmtUSD(p.revenue)}
            </p>
            <p className="text-label-sm text-on-surface-variant">
              {fmt(p.unitsSold)} units
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UTM Link Builder
// ---------------------------------------------------------------------------

function UTMLinkBuilder() {
  const [form, setForm] = useState({
    url: "",
    source: "",
    medium: "",
    campaign: "",
    content: "",
    term: "",
  });
  const [copied, setCopied] = useState(false);

  const buildLink = () => {
    if (!form.url) return "";
    try {
      const u = new URL(form.url.startsWith("http") ? form.url : `https://${form.url}`);
      if (form.source) u.searchParams.set("utm_source", form.source);
      if (form.medium) u.searchParams.set("utm_medium", form.medium);
      if (form.campaign) u.searchParams.set("utm_campaign", form.campaign);
      if (form.content) u.searchParams.set("utm_content", form.content);
      if (form.term) u.searchParams.set("utm_term", form.term);
      return u.toString();
    } catch {
      return "";
    }
  };

  const generatedLink = buildLink();

  const handleCopy = async () => {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fields: { key: keyof typeof form; label: string; placeholder: string; required?: boolean }[] = [
    { key: "url", label: "Destination URL", placeholder: "https://yourstore.com/products/...", required: true },
    { key: "source", label: "UTM Source", placeholder: "e.g. google, newsletter", required: true },
    { key: "medium", label: "UTM Medium", placeholder: "e.g. cpc, email, social" },
    { key: "campaign", label: "UTM Campaign", placeholder: "e.g. summer_sale" },
    { key: "content", label: "UTM Content", placeholder: "e.g. banner_a" },
    { key: "term", label: "UTM Term", placeholder: "e.g. running+shoes" },
  ];

  return (
    <div className="flex flex-col gap-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-[6px]">
            <label
              htmlFor={`utm-${f.key}`}
              className="text-label-md font-semibold text-on-surface"
            >
              {f.label}
              {f.required && <span className="text-error ml-0.5">*</span>}
            </label>
            <input
              id={`utm-${f.key}`}
              type="text"
              value={form[f.key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
            />
          </div>
        ))}
      </div>

      {generatedLink && (
        <div className="mt-xs rounded-lg bg-surface-container-low border border-outline-variant p-sm flex items-start gap-sm">
          <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">
            link
          </span>
          <p className="text-body-md text-on-surface break-all flex-1 font-mono text-[13px]">
            {generatedLink}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 flex items-center gap-xs text-label-md font-semibold text-primary hover:text-on-primary hover:bg-primary px-sm py-xs rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">
              {copied ? "check_circle" : "content_copy"}
            </span>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      {!generatedLink && (
        <p className="text-label-sm text-on-surface-variant mt-xs">
          Fill in the Destination URL and UTM Source to generate your link.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AnalyticsDashboard() {
  const { dateRange, metrics, revenueOverTime, funnel, channels, topProducts, retention } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  const handleDateChange = (key: "start" | "end", value: string) => {
    setSearchParams((prev) => {
      prev.set(key, value);
      return prev;
    });
  };

  return (
    <main className="p-lg max-w-container-max mx-auto font-sans">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md mb-lg">
        <div>
          <h1 className="text-display-lg font-bold text-on-surface">Analytics</h1>
          <p className="text-body-lg text-on-surface-variant mt-xs">
            Track revenue, visitors, and channel performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          {/* Date range */}
          <div className="flex items-center gap-xs bg-surface-container-lowest border border-outline-variant rounded-lg px-sm py-xs shadow-sm">
            <span className="material-symbols-outlined text-on-surface-variant text-[18px]">
              calendar_today
            </span>
            <input
              type="date"
              defaultValue={dateRange.start}
              onChange={(e) => handleDateChange("start", e.target.value)}
              className="text-body-md text-on-surface bg-transparent border-none outline-none cursor-pointer"
              aria-label="Start date"
            />
            <span className="text-on-surface-variant text-body-md">–</span>
            <input
              type="date"
              defaultValue={dateRange.end}
              onChange={(e) => handleDateChange("end", e.target.value)}
              className="text-body-md text-on-surface bg-transparent border-none outline-none cursor-pointer"
              aria-label="End date"
            />
          </div>
          {/* Export */}
          <button
            type="button"
            className="flex items-center gap-xs bg-primary text-on-primary text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export Data
          </button>
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
        <MetricCard
          icon="payments"
          label="Revenue"
          value={fmtUSD(metrics.revenue)}
          sub="Last 30 days"
          trend="+12.4%"
        />
        <MetricCard
          icon="shopping_bag"
          label="Orders"
          value={fmt(metrics.orders)}
          sub="Last 30 days"
          trend="+8.1%"
        />
        <MetricCard
          icon="group"
          label="Unique Visitors"
          value={fmt(metrics.uniqueVisitors)}
          sub="Last 30 days"
          trend="+5.7%"
        />
        <MetricCard
          icon="conversion_path"
          label="Conversion Rate"
          value={`${metrics.conversionRate}%`}
          sub="Orders / Visitors"
          trend="+0.2%"
        />
      </div>

      {/* ── Revenue Chart + Funnel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-lg mb-lg">
        <div className="lg:col-span-8">
          <SectionCard title="Revenue Over Time">
            <RevenueChart data={revenueOverTime} />
            <div className="flex items-center gap-xs mt-sm">
              <span className="w-3 h-3 rounded-sm bg-primary" />
              <span className="text-label-sm text-on-surface-variant">Daily Revenue (USD)</span>
            </div>
          </SectionCard>
        </div>
        <div className="lg:col-span-4">
          <SectionCard title="Conversion Funnel" className="h-full">
            <ConversionFunnel steps={funnel} />
          </SectionCard>
        </div>
      </div>

      {/* ── Channel Attribution ── */}
      <div className="mb-lg">
        <SectionCard title="Channel Attribution">
          <ChannelTable channels={channels} />
        </SectionCard>
      </div>

      {/* ── Retention + Top Products ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-lg mb-lg">
        <div className="lg:col-span-5">
          <SectionCard title="Customer Retention" className="h-full">
            <RetentionDonut returning={retention.returning} newPct={retention.new} />
          </SectionCard>
        </div>
        <div className="lg:col-span-7">
          <SectionCard title="Top Products" className="h-full">
            <TopProducts products={topProducts} />
          </SectionCard>
        </div>
      </div>

      {/* ── UTM Link Builder ── */}
      <div className="mb-lg">
        <SectionCard title="UTM Link Builder">
          <UTMLinkBuilder />
        </SectionCard>
      </div>
    </main>
  );
}
