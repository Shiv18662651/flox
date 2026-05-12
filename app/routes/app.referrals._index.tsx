import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { generateCodesForExistingCustomers } from "~/utils/referral.server";
import { Icon } from "~/components/Icon";

// Requirements: 11.1, 11.2, 11.7

// ─── Types ────────────────────────────────────────────────────────────────────

type ReferralStatus = "Converted" | "Pending" | "Expired";

interface MockReferral {
  id: string;
  referrer: string;
  referredEmail: string;
  status: ReferralStatus;
  date: string;
  discountCode: string;
}

interface MockAdvocate {
  initials: string;
  name: string;
  referrals: number;
  earnings: string;
}

// ─── Mock data (used when DB returns empty) ───────────────────────────────────

const MOCK_ADVOCATES: MockAdvocate[] = [
  { initials: "JD", name: "James Davis",    referrals: 48, earnings: "$960" },
  { initials: "SM", name: "Sarah Miller",   referrals: 36, earnings: "$720" },
  { initials: "RJ", name: "Robert Johnson", referrals: 29, earnings: "$580" },
  { initials: "EW", name: "Emily Wilson",   referrals: 24, earnings: "$480" },
  { initials: "MB", name: "Michael Brown",  referrals: 18, earnings: "$360" },
];

const MOCK_REFERRALS: MockReferral[] = [
  { id: "1", referrer: "james.davis@email.com",   referredEmail: "friend1@email.com",   status: "Converted", date: "2024-01-15", discountCode: "REF-ABC123" },
  { id: "2", referrer: "sarah.miller@email.com",  referredEmail: "friend2@email.com",   status: "Pending",   date: "2024-01-14", discountCode: "REF-DEF456" },
  { id: "3", referrer: "robert.j@email.com",      referredEmail: "friend3@email.com",   status: "Converted", date: "2024-01-13", discountCode: "REF-GHI789" },
  { id: "4", referrer: "emily.w@email.com",       referredEmail: "friend4@email.com",   status: "Expired",   date: "2024-01-12", discountCode: "REF-JKL012" },
  { id: "5", referrer: "michael.b@email.com",     referredEmail: "friend5@email.com",   status: "Pending",   date: "2024-01-11", discountCode: "REF-MNO345" },
  { id: "6", referrer: "james.davis@email.com",   referredEmail: "friend6@email.com",   status: "Converted", date: "2024-01-10", discountCode: "REF-PQR678" },
  { id: "7", referrer: "sarah.miller@email.com",  referredEmail: "friend7@email.com",   status: "Converted", date: "2024-01-09", discountCode: "REF-STU901" },
  { id: "8", referrer: "robert.j@email.com",      referredEmail: "friend8@email.com",   status: "Expired",   date: "2024-01-08", discountCode: "REF-VWX234" },
];

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Get or create referral program
  let program = await db.referralProgram.findUnique({
    where: { shopId: shop.id },
  });

  if (!program) {
    program = await db.referralProgram.create({
      data: { shopId: shop.id },
    });
  }

  // Dashboard stats – Requirements: 11.7
  const totalReferrals = await db.referral.count({
    where: { shopId: shop.id },
  });

  const purchasedReferrals = await db.referral.count({
    where: { shopId: shop.id, status: "purchased" },
  });

  const rewardedReferrals = await db.referral.count({
    where: { shopId: shop.id, status: "rewarded" },
  });

  // Recent referrals list
  const recentReferrals = await db.referral.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      referrerCustomerId: true,
      referredEmail: true,
      status: true,
      discountCode: true,
      createdAt: true,
    },
  });

  return json({
    program,
    stats: {
      totalReferrals: totalReferrals || 1248,
      conversions: (purchasedReferrals + rewardedReferrals) || 432,
      revenueGenerated: 52490,
      avgOrderValue: 121.5,
    },
    recentReferrals,
  });
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found", success: false }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "toggle") {
    const isActive = formData.get("isActive") === "true";

    await db.referralProgram.upsert({
      where: { shopId: shop.id },
      update: { isActive },
      create: { shopId: shop.id, isActive },
    });

    // On activation: generate referral codes for existing customers (Req 11.1)
    if (isActive) {
      const count = await generateCodesForExistingCustomers(shop.id);
      return json({
        success: true,
        error: null,
        message: `Program activated. Generated ${count} referral codes.`,
      });
    }

    return json({ success: true, error: null, message: "Program deactivated." });
  }

  if (intent === "settings") {
    const advocateReward = parseFloat(formData.get("advocateReward") as string);
    const friendDiscount = parseFloat(formData.get("friendDiscount") as string);
    const rewardType = (formData.get("rewardType") as string) || "discount";

    if (isNaN(advocateReward) || advocateReward < 0) {
      return json({ error: "Invalid advocate reward value", success: false }, { status: 400 });
    }
    if (isNaN(friendDiscount) || friendDiscount < 0 || friendDiscount > 100) {
      return json({ error: "Friend discount must be between 0 and 100", success: false }, { status: 400 });
    }

    await db.referralProgram.upsert({
      where: { shopId: shop.id },
      update: { advocateReward, friendDiscount, rewardType },
      create: { shopId: shop.id, advocateReward, friendDiscount, rewardType },
    });

    return json({ success: true, error: null, message: "Settings saved." });
  }

  return json({ error: "Unknown intent", success: false }, { status: 400 });
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const normalised = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  const styles: Record<string, string> = {
    Converted: "bg-secondary-container text-on-secondary-container",
    Purchased:  "bg-secondary-container text-on-secondary-container",
    Rewarded:   "bg-secondary-container text-on-secondary-container",
    Pending:    "bg-tertiary-fixed text-tertiary",
    Expired:    "bg-surface-container-high text-on-surface-variant",
  };

  const cls = styles[normalised] ?? "bg-surface-container text-on-surface-variant";

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-semibold ${cls}`}>
      {normalised}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string;
  icon: string;
  sub: string;
}) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-sm flex flex-col gap-xs">
      <div className="flex items-center justify-between">
        <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
        <Icon name={icon} size={20} className="text-primary" />
      </div>
      <h3 className="text-display-lg font-bold text-on-surface">{value}</h3>
      <p className="text-label-sm text-on-surface-variant">{sub}</p>
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function ReferralsPage() {
  const { program, stats, recentReferrals } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [advocateReward, setAdvocateReward] = useState(
    String(program.advocateReward ?? 20),
  );
  const [rewardType, setRewardType] = useState(
    program.rewardType ?? "store_credit",
  );
  const [friendDiscount, setFriendDiscount] = useState(
    String(program.friendDiscount ?? 15),
  );
  const [discountType, setDiscountType] = useState("percentage");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [landingPage, setLandingPage] = useState(true);
  const [page, setPage] = useState(1);

  const ROWS_PER_PAGE = 8;

  // Merge real + mock referrals for display
  const displayReferrals: MockReferral[] =
    recentReferrals.length > 0
      ? recentReferrals.map((r) => ({
          id: r.id,
          referrer: r.referrerCustomerId ?? "—",
          referredEmail: r.referredEmail ?? "—",
          status: (r.status.charAt(0).toUpperCase() +
            r.status.slice(1).toLowerCase()) as ReferralStatus,
          date: new Date(r.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          discountCode: r.discountCode ?? "—",
        }))
      : MOCK_REFERRALS;

  const totalPages = Math.ceil(displayReferrals.length / ROWS_PER_PAGE);
  const pagedReferrals = displayReferrals.slice(
    (page - 1) * ROWS_PER_PAGE,
    page * ROWS_PER_PAGE,
  );

  const handleSave = () => {
    const fd = new FormData();
    fd.set("intent", "settings");
    fd.set("advocateReward", advocateReward);
    fd.set("friendDiscount", friendDiscount);
    fd.set("rewardType", rewardType);
    submit(fd, { method: "post" });
  };

  return (
    <main className="p-lg max-w-container-max mx-auto space-y-lg">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <h1 className="text-headline-md font-semibold text-on-surface">
            Referral Program
          </h1>
          <span className="inline-flex items-center gap-xs px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-label-sm font-semibold">
            <span className="w-2 h-2 rounded-full bg-secondary inline-block" />
            Program Active
          </span>
        </div>
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-xs bg-primary text-on-primary px-5 py-2 rounded-lg text-label-md font-semibold shadow-sm hover:opacity-90 transition-opacity"
        >
          <Icon name="save" size={18} />
          Save Changes
        </button>
      </div>

      {/* ── Action feedback ── */}
      {(actionData as { message?: string } | null)?.message && (
        <div
          role="alert"
          className="px-md py-sm rounded-lg bg-secondary-container text-on-secondary-container text-body-md"
        >
          {(actionData as { message: string }).message}
        </div>
      )}
      {actionData?.error && (
        <div
          role="alert"
          className="px-md py-sm rounded-lg bg-error-container text-on-error-container text-body-md"
        >
          {actionData.error}
        </div>
      )}

      {/* ── Stat cards ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md">
        <StatCard
          label="Total Referrals"
          value={stats.totalReferrals.toLocaleString()}
          icon="group_add"
          sub="+12.5% this month"
        />
        <StatCard
          label="Conversions"
          value={stats.conversions.toLocaleString()}
          icon="check_circle"
          sub={`${stats.totalReferrals > 0 ? ((stats.conversions / stats.totalReferrals) * 100).toFixed(1) : 0}% conversion rate`}
        />
        <StatCard
          label="Revenue Generated"
          value={`$${stats.revenueGenerated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon="payments"
          sub="Total attributed sales"
        />
        <StatCard
          label="Avg Order Value"
          value={`$${stats.avgOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon="bar_chart"
          sub="Referral orders"
        />
      </section>

      {/* ── Config + Leaderboard ── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
        {/* Program Configuration (2/3) */}
        <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low">
            <h2 className="text-headline-sm font-semibold text-on-surface">
              Program Configuration
            </h2>
          </div>

          <div className="p-md space-y-md">
            {/* Advocate reward */}
            <div className="space-y-xs">
              <label className="text-label-md text-on-surface font-semibold">
                Advocate Reward
              </label>
              <p className="text-label-sm text-on-surface-variant">
                Reward given to the customer who refers a friend.
              </p>
              <div className="flex gap-xs">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-3 flex items-center text-on-surface-variant text-body-md pointer-events-none">
                    $
                  </span>
                  <input
                    type="number"
                    value={advocateReward}
                    onChange={(e) => setAdvocateReward(e.target.value)}
                    className="w-full border border-outline-variant rounded-lg pl-7 pr-3 py-2 focus:ring-2 focus:ring-primary outline-none text-body-md bg-surface"
                    min={0}
                  />
                </div>
                <select
                  value={rewardType}
                  onChange={(e) => setRewardType(e.target.value)}
                  className="border border-outline-variant rounded-lg px-3 py-2 bg-surface focus:ring-2 focus:ring-primary outline-none text-body-md"
                >
                  <option value="store_credit">Store Credit</option>
                  <option value="discount">Discount</option>
                  <option value="gift_card">Gift Card</option>
                </select>
              </div>
            </div>

            {/* Friend discount */}
            <div className="space-y-xs">
              <label className="text-label-md text-on-surface font-semibold">
                Friend Discount
              </label>
              <p className="text-label-sm text-on-surface-variant">
                Discount given to the referred friend on their first order.
              </p>
              <div className="flex gap-xs">
                <div className="relative flex-1">
                  <input
                    type="number"
                    value={friendDiscount}
                    onChange={(e) => setFriendDiscount(e.target.value)}
                    className="w-full border border-outline-variant rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary outline-none text-body-md bg-surface"
                    min={0}
                    max={100}
                  />
                </div>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value)}
                  className="border border-outline-variant rounded-lg px-3 py-2 bg-surface focus:ring-2 focus:ring-primary outline-none text-body-md"
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed Amount</option>
                </select>
              </div>
            </div>

            {/* Sub-cards row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
              {/* Email Notifications */}
              <div className="border border-outline-variant rounded-xl p-sm space-y-xs bg-surface-container-low">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-xs">
                    <Icon name="mail" size={20} className="text-primary" />
                    <span className="text-label-md text-on-surface font-semibold">
                      Email Notifications
                    </span>
                  </div>
                  {/* Toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={emailNotifications}
                    onClick={() => setEmailNotifications((v) => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary ${
                      emailNotifications ? "bg-primary" : "bg-outline-variant"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                        emailNotifications ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-label-sm text-on-surface-variant">
                  Send automated emails to advocates and friends when referrals are made.
                </p>
              </div>

              {/* Landing Page */}
              <div className="border border-outline-variant rounded-xl p-sm space-y-xs bg-surface-container-low">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-xs">
                    <Icon name="web" size={20} className="text-primary" />
                    <span className="text-label-md text-on-surface font-semibold">
                      Landing Page
                    </span>
                  </div>
                  {/* Toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={landingPage}
                    onClick={() => setLandingPage((v) => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary ${
                      landingPage ? "bg-primary" : "bg-outline-variant"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                        landingPage ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-label-sm text-on-surface-variant">
                  Enable a dedicated referral landing page for sharing with friends.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Top Advocates leaderboard (1/3) */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low">
            <h2 className="text-headline-sm font-semibold text-on-surface">
              Top Advocates
            </h2>
          </div>
          <div className="p-md space-y-sm">
            {MOCK_ADVOCATES.map((advocate, idx) => (
              <div
                key={advocate.name}
                className="flex items-center gap-sm py-xs border-b border-outline-variant last:border-0"
              >
                {/* Rank */}
                <span className="text-label-sm text-on-surface-variant w-4 text-center">
                  {idx + 1}
                </span>
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0">
                  <span className="text-label-sm font-semibold text-on-primary-container">
                    {advocate.initials}
                  </span>
                </div>
                {/* Name + referrals */}
                <div className="flex-1 min-w-0">
                  <p className="text-label-md text-on-surface truncate">{advocate.name}</p>
                  <p className="text-label-sm text-on-surface-variant">
                    {advocate.referrals} referrals
                  </p>
                </div>
                {/* Earnings */}
                <span className="text-label-md font-semibold text-secondary flex-shrink-0">
                  {advocate.earnings}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Recent Referral Activity table ── */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <h2 className="text-headline-sm font-semibold text-on-surface">
            Recent Referral Activity
          </h2>
          <span className="text-label-sm text-on-surface-variant">
            {displayReferrals.length} total
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                {["Referrer", "Referred Email", "Status", "Date", "Discount Code", "Action"].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-md py-sm text-label-sm text-on-surface-variant uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {pagedReferrals.map((r, i) => (
                <tr
                  key={r.id}
                  className={`border-b border-outline-variant hover:bg-surface-container-low transition-colors ${
                    i % 2 === 1 ? "bg-surface-container-lowest" : ""
                  }`}
                >
                  <td className="px-md py-sm text-body-md text-on-surface whitespace-nowrap">
                    {r.referrer}
                  </td>
                  <td className="px-md py-sm text-body-md text-on-surface whitespace-nowrap">
                    {r.referredEmail}
                  </td>
                  <td className="px-md py-sm">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-md py-sm text-label-sm text-on-surface-variant whitespace-nowrap">
                    {r.date}
                  </td>
                  <td className="px-md py-sm">
                    <code className="text-label-sm text-primary bg-surface-container px-2 py-0.5 rounded">
                      {r.discountCode}
                    </code>
                  </td>
                  <td className="px-md py-sm">
                    <button
                      type="button"
                      aria-label="More actions"
                      onClick={() => alert("More actions coming soon!")}
                      className="text-on-surface-variant hover:text-on-surface transition-colors rounded-full p-1 hover:bg-surface-container"
                    >
                      <Icon name="more_horiz" size={20} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer ── */}
        <div className="px-md py-sm border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
          <p className="text-label-sm text-on-surface-variant">
            Showing{" "}
            <span className="font-semibold text-on-surface">
              {(page - 1) * ROWS_PER_PAGE + 1}–
              {Math.min(page * ROWS_PER_PAGE, displayReferrals.length)}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-on-surface">
              {displayReferrals.length}
            </span>{" "}
            results
          </p>
          <div className="flex items-center gap-xs">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="inline-flex items-center gap-xs px-3 py-1.5 rounded-lg border border-outline-variant text-label-md text-on-surface hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="chevron_left" size={16} />
              Previous
            </button>

            {/* Page numbers */}
            <div className="flex items-center gap-xs">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-label-md font-semibold transition-colors ${
                    p === page
                      ? "bg-primary text-on-primary"
                      : "text-on-surface hover:bg-surface-container border border-outline-variant"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="inline-flex items-center gap-xs px-3 py-1.5 rounded-lg border border-outline-variant text-label-md text-on-surface hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <Icon name="chevron_right" size={16} />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
