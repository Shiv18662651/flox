import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { isFeatureAvailable } from "~/utils/plan-limits.server";
import { Icon } from "~/components/Icon";

// Requirements: 8.1, 8.7, 8.8, 8.9

// ─── Mock / seed data for the UI ────────────────────────────────────────────

const MOCK_TRANSACTIONS = [
  { id: "1", initials: "SJ", name: "Sarah Johnson", date: "2024-01-15", action: "Purchase - Order #1234", points: 150, status: "completed" },
  { id: "2", initials: "MC", name: "Mike Chen",     date: "2024-01-14", action: "Points Redeemed",        points: -500, status: "completed" },
  { id: "3", initials: "EW", name: "Emma Wilson",   date: "2024-01-14", action: "Referral Bonus",         points: 200, status: "pending" },
  { id: "4", initials: "JD", name: "James Davis",   date: "2024-01-13", action: "Purchase - Order #1231", points: 320, status: "completed" },
  { id: "5", initials: "AL", name: "Anna Lee",      date: "2024-01-12", action: "Review Submitted",       points: 50,  status: "completed" },
];

const MOCK_TOP_MEMBERS = [
  { initials: "SJ", name: "Sarah Johnson", email: "sarah.j@email.com", points: 12450, tier: "Gold",   rank: 1 },
  { initials: "MC", name: "Mike Chen",     email: "m.chen@email.com",  points: 9820,  tier: "Silver", rank: 2 },
  { initials: "EW", name: "Emma Wilson",   email: "e.wilson@email.com",points: 7650,  tier: "Silver", rank: 3 },
];

const MOCK_INSIGHTS = [
  { label: "Avg Points per Member", value: "96.5" },
  { label: "Monthly Growth",        value: "+18.2%" },
  { label: "Redemption Rate",       value: "37.3%" },
  { label: "Active This Month",     value: "2,847" },
];

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  let program = await db.loyaltyProgram.findUnique({ where: { shopId: shop.id } });
  if (!program) {
    program = await db.loyaltyProgram.create({ data: { shopId: shop.id } });
  }

  const canUseVipTiers = isFeatureAvailable(shop.plan, "vip_tiers");

  return json({
    program,
    canUseVipTiers,
    plan: shop.plan,
    // Mock stats & lists — replace with real DB queries when ready
    stats: {
      totalMembers:  12842,
      pointsIssued:  1200000,
      redeemed:      452000,
      revenueImpact: 84200,
    },
    transactions: MOCK_TRANSACTIONS,
    topMembers:   MOCK_TOP_MEMBERS,
    insights:     MOCK_INSIGHTS,
  });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) return json({ error: "Shop not found", success: false }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "toggle") {
    const isActive = formData.get("isActive") === "true";
    await db.loyaltyProgram.upsert({
      where:  { shopId: shop.id },
      update: { isActive },
      create: { shopId: shop.id, isActive },
    });
    return json({ success: true, error: null });
  }

  if (intent === "settings") {
    const pointsPerDollar = parseInt(formData.get("pointsPerDollar") as string, 10);
    const rewardValue     = parseFloat(formData.get("rewardValue") as string);

    if (isNaN(pointsPerDollar) || pointsPerDollar < 0)
      return json({ error: "Invalid points per dollar", success: false }, { status: 400 });
    if (isNaN(rewardValue) || rewardValue <= 0)
      return json({ error: "Invalid reward value", success: false }, { status: 400 });

    await db.loyaltyProgram.upsert({
      where:  { shopId: shop.id },
      update: { pointsPerDollar, rewardValue },
      create: { shopId: shop.id, pointsPerDollar, rewardValue },
    });
    return json({ success: true, error: null });
  }

  return json({ error: "Unknown intent", success: false }, { status: 400 });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function rankBorderClass(rank: number) {
  if (rank === 1) return "border-yellow-400";
  if (rank === 2) return "border-gray-400";
  return "border-amber-600";
}

function rankLabel(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  return "🥉";
}

// ─── VIP Tier card data ───────────────────────────────────────────────────────

const VIP_TIERS = [
  {
    name: "Bronze",
    level: "Level 1",
    requirement: "Join program",
    borderColor: "border-t-amber-600",
    bgBadge: "bg-amber-100 text-amber-800",
    perks: ["5 points per $1 spent", "Birthday bonus points", "Early access to sales"],
    popular: false,
  },
  {
    name: "Silver",
    level: "Level 2",
    requirement: "$500+ spent",
    borderColor: "border-t-gray-400",
    bgBadge: "bg-gray-100 text-gray-700",
    perks: ["10 points per $1 spent", "Free shipping on orders $50+", "Exclusive member discounts", "Priority customer support"],
    popular: false,
  },
  {
    name: "Gold",
    level: "Level 3",
    requirement: "$2,000+ spent",
    borderColor: "border-t-yellow-400",
    bgBadge: "bg-yellow-100 text-yellow-800",
    perks: ["15 points per $1 spent", "Free shipping on all orders", "VIP early access", "Dedicated account manager", "Quarterly bonus rewards"],
    popular: true,
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function LoyaltyDashboard() {
  const { program, stats, transactions, topMembers, insights } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit     = useSubmit();

  const [activeTab, setActiveTab] = useState<"overview" | "rules">("overview");

  const handleToggle = () => {
    const fd = new FormData();
    fd.set("intent", "toggle");
    fd.set("isActive", String(!program.isActive));
    submit(fd, { method: "post" });
  };

  const handleSettingsSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("intent", "settings");
    submit(fd, { method: "post" });
  };

  return (
    <main className="min-h-screen bg-background pb-24">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="bg-surface-container-lowest border-b border-outline-variant px-lg py-sm sticky top-0 z-10">
        <div className="max-w-container-max mx-auto flex items-center justify-between gap-md">
          {/* Title + tabs */}
          <div className="flex items-center gap-lg">
            <div>
              <h1 className="text-headline-md font-semibold text-on-surface">Loyalty Program</h1>
              <p className="text-body-md text-on-surface-variant">Manage rewards, tiers, and member activity</p>
            </div>
            <nav className="flex gap-xs bg-surface-container rounded-xl p-1" aria-label="Loyalty tabs">
              {(["overview", "rules"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-label-md font-semibold capitalize transition-colors ${
                    activeTab === tab
                      ? "bg-primary text-on-primary shadow-sm"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {tab === "overview" ? "Overview" : "Program Rules"}
                </button>
              ))}
            </nav>
          </div>

          {/* Save button */}
          <button
            form="settings-form"
            type="submit"
            className="flex items-center gap-xs bg-primary text-on-primary px-5 py-2 rounded-xl text-label-md font-semibold shadow-sm hover:opacity-90 transition-opacity"
          >
            <Icon name="save" size={18} />
            Save Changes
          </button>
        </div>
      </div>

      {/* ── Toast feedback ──────────────────────────────────────────────── */}
      {actionData?.success && (
        <div role="alert" className="max-w-container-max mx-auto mt-sm px-lg">
          <div className="flex items-center gap-xs bg-secondary-container text-on-secondary-container px-md py-sm rounded-xl text-body-md">
            <Icon name="check_circle" size={18} />
            Settings saved successfully.
          </div>
        </div>
      )}
      {actionData?.error && (
        <div role="alert" className="max-w-container-max mx-auto mt-sm px-lg">
          <div className="flex items-center gap-xs bg-error-container text-on-error-container px-md py-sm rounded-xl text-body-md">
            <Icon name="error" size={18} />
            {actionData.error}
          </div>
        </div>
      )}

      <div className="max-w-container-max mx-auto px-lg mt-lg space-y-lg">

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-md" aria-label="Program statistics">
          {[
            { label: "Total Members",   value: fmtNumber(stats.totalMembers),  icon: "group",          sub: "+8.2% this month" },
            { label: "Points Issued",   value: fmtNumber(stats.pointsIssued),  icon: "stars",          sub: "All time" },
            { label: "Redeemed",        value: fmtNumber(stats.redeemed),      icon: "redeem",         sub: "37.7% redemption rate" },
            { label: "Revenue Impact",  value: `$${fmtNumber(stats.revenueImpact)}`, icon: "payments", sub: "Attributed revenue" },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-sm flex flex-col gap-xs"
            >
              <div className="flex items-center justify-between">
                <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">{card.label}</p>
                <Icon name={card.icon} size={20} className="text-primary-container" />
              </div>
              <p className="text-display-lg font-bold text-on-surface">{card.value}</p>
              <p className="text-label-sm text-on-surface-variant">{card.sub}</p>
            </div>
          ))}
        </section>

        {/* ── Main content + sidebar ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg items-start">

          {/* ── Left / centre column ──────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-lg">

            {/* Program Settings card */}
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
              <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low flex items-center gap-xs">
                <Icon name="settings" size={20} className="text-primary" />
                <h2 className="text-headline-sm font-semibold text-on-surface">Program Settings</h2>
              </div>

              <form id="settings-form" onSubmit={handleSettingsSubmit} className="p-md space-y-md">
                {/* Active toggle */}
                <div className="flex items-center justify-between py-sm border-b border-outline-variant">
                  <div>
                    <p className="text-label-md font-semibold text-on-surface">Program Active</p>
                    <p className="text-body-md text-on-surface-variant">Enable or disable the loyalty program for your store</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={program.isActive}
                    onClick={handleToggle}
                    className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                      program.isActive ? "bg-primary" : "bg-outline-variant"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                        program.isActive ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Points per dollar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
                  <div className="space-y-xs">
                    <label htmlFor="pointsPerDollar" className="text-label-md text-on-surface">
                      Points per dollar
                    </label>
                    <div className="relative">
                      <Icon name="toll" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                      <input
                        id="pointsPerDollar"
                        name="pointsPerDollar"
                        type="number"
                        min={0}
                        defaultValue={program.pointsPerDollar}
                        className="w-full border border-outline-variant rounded-xl pl-9 pr-4 py-2 text-body-md bg-surface focus:ring-2 focus:ring-primary-container outline-none"
                      />
                    </div>
                    <p className="text-label-sm text-on-surface-variant">Points earned per $1 spent</p>
                  </div>

                  <div className="space-y-xs">
                    <label htmlFor="rewardValue" className="text-label-md text-on-surface">
                      Reward value
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-semibold text-body-md">$</span>
                      <input
                        id="rewardValue"
                        name="rewardValue"
                        type="number"
                        step="0.01"
                        min={0.01}
                        defaultValue={program.rewardValue}
                        className="w-full border border-outline-variant rounded-xl pl-7 pr-4 py-2 text-body-md bg-surface focus:ring-2 focus:ring-primary-container outline-none"
                      />
                    </div>
                    <p className="text-label-sm text-on-surface-variant">Dollar value per point redeemed</p>
                  </div>
                </div>
              </form>
            </section>

            {/* VIP Tiers */}
            <section aria-label="VIP Tiers">
              <div className="flex items-center justify-between mb-md">
                <div>
                  <h2 className="text-headline-sm font-semibold text-on-surface">VIP Tiers</h2>
                  <p className="text-body-md text-on-surface-variant">Customers are automatically assigned the highest tier they qualify for</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-md">
                {VIP_TIERS.map((tier) => (
                  <div
                    key={tier.name}
                    className={`relative bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden border-t-4 ${tier.borderColor}`}
                  >
                    {tier.popular && (
                      <div className="absolute top-3 right-3">
                        <span className="bg-primary text-on-primary text-label-sm font-semibold px-2 py-0.5 rounded-full">
                          Popular
                        </span>
                      </div>
                    )}
                    <div className="p-md">
                      <div className="flex items-center gap-xs mb-xs">
                        <span className={`text-label-sm font-semibold px-2 py-0.5 rounded-full ${tier.bgBadge}`}>
                          {tier.level}
                        </span>
                      </div>
                      <h3 className="text-headline-sm font-semibold text-on-surface">{tier.name}</h3>
                      <p className="text-label-sm text-on-surface-variant mb-md">{tier.requirement}</p>

                      <ul className="space-y-xs">
                        {tier.perks.map((perk) => (
                          <li key={perk} className="flex items-start gap-xs text-body-md text-on-surface">
                            <Icon name="check_circle" size={16} className="text-primary mt-0.5 flex-shrink-0" />
                            {perk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Recent Transactions */}
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
              <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
                <div className="flex items-center gap-xs">
                  <Icon name="receipt_long" size={20} className="text-primary" />
                  <h2 className="text-headline-sm font-semibold text-on-surface">Recent Transactions</h2>
                </div>

              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface-container-low border-b border-outline-variant">
                    <tr>
                      {["Customer", "Date", "Action", "Points", "Status"].map((h) => (
                        <th key={h} className="text-left px-md py-sm text-label-sm text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx, i) => (
                      <tr
                        key={tx.id}
                        className={`border-b border-outline-variant transition-colors hover:bg-surface-container-low ${
                          i % 2 === 1 ? "bg-surface-container-lowest" : ""
                        }`}
                      >
                        {/* Customer */}
                        <td className="px-md py-sm">
                          <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0">
                              <span className="text-label-sm font-semibold text-on-primary-container">{tx.initials}</span>
                            </div>
                            <span className="text-body-md text-on-surface font-medium">{tx.name}</span>
                          </div>
                        </td>
                        {/* Date */}
                        <td className="px-md py-sm text-body-md text-on-surface-variant whitespace-nowrap">
                          {new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        {/* Action */}
                        <td className="px-md py-sm text-body-md text-on-surface">{tx.action}</td>
                        {/* Points */}
                        <td className="px-md py-sm">
                          <span className={`text-label-md font-semibold ${tx.points > 0 ? "text-secondary" : "text-tertiary"}`}>
                            {tx.points > 0 ? `+${tx.points.toLocaleString()}` : tx.points.toLocaleString()}
                          </span>
                        </td>
                        {/* Status */}
                        <td className="px-md py-sm">
                          <span className={`inline-flex items-center gap-xs px-2 py-0.5 rounded-full text-label-sm font-semibold ${
                            tx.status === "completed"
                              ? "bg-secondary-container text-on-secondary-container"
                              : "bg-tertiary-fixed text-tertiary"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${tx.status === "completed" ? "bg-secondary" : "bg-tertiary"}`} />
                            {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* ── Right sidebar ─────────────────────────────────────────────── */}
          <aside className="space-y-lg">

            {/* Top Members leaderboard */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
              <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low flex items-center gap-xs">
                <Icon name="leaderboard" size={20} className="text-primary" />
                <h2 className="text-headline-sm font-semibold text-on-surface">Top Members</h2>
              </div>

              <div className="p-md space-y-sm">
                {topMembers.map((member) => (
                  <div
                    key={member.rank}
                    className={`flex items-center gap-sm p-sm rounded-xl border-2 ${rankBorderClass(member.rank)} bg-surface-container-low`}
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center">
                        <span className="text-label-md font-semibold text-on-primary-container">{member.initials}</span>
                      </div>
                      <span className="absolute -bottom-1 -right-1 text-sm leading-none">{rankLabel(member.rank)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-label-md font-semibold text-on-surface truncate">{member.name}</p>
                      <p className="text-label-sm text-on-surface-variant truncate">{member.email}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-label-md font-semibold text-primary">{member.points.toLocaleString()}</p>
                      <p className="text-label-sm text-on-surface-variant">{member.tier}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Program Insights */}
            <div className="bg-primary-container rounded-xl shadow-sm overflow-hidden">
              <div className="px-md py-sm border-b border-on-primary-container/20 flex items-center gap-xs">
                <Icon name="insights" size={20} className="text-on-primary-container" />
                <h2 className="text-headline-sm font-semibold text-on-primary-container">Program Insights</h2>
              </div>

              <div className="p-md space-y-sm">
                {insights.map((item) => (
                  <div key={item.label} className="flex items-center justify-between py-xs border-b border-on-primary-container/20 last:border-0">
                    <p className="text-body-md text-on-primary-container/80">{item.label}</p>
                    <p className="text-label-md font-semibold text-on-primary-container">{item.value}</p>
                  </div>
                ))}

                <div className="pt-xs">

                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>


    </main>
  );
}
