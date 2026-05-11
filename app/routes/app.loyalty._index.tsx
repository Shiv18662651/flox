import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { isFeatureAvailable } from "~/utils/plan-limits.server";
import type { Plan } from "@prisma/client";

// Requirements: 8.1, 8.7, 8.8, 8.9

interface VipTier {
  name: string;
  minPoints: number;
}

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

  // Get or create loyalty program
  let program = await db.loyaltyProgram.findUnique({
    where: { shopId: shop.id },
  });

  if (!program) {
    program = await db.loyaltyProgram.create({
      data: { shopId: shop.id },
    });
  }

  // Dashboard stats
  const totalIssued = await db.loyaltyTransaction.aggregate({
    where: { shopId: shop.id, type: "earn" },
    _sum: { points: true },
  });

  const totalRedeemed = await db.loyaltyTransaction.aggregate({
    where: { shopId: shop.id, type: "redeem" },
    _sum: { points: true },
  });

  // Top earners
  const topEarners = await db.customer.findMany({
    where: { shopId: shop.id, loyaltyPoints: { gt: 0 } },
    orderBy: { loyaltyPoints: "desc" },
    take: 10,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      loyaltyPoints: true,
      loyaltyTier: true,
    },
  });

  const canUseVipTiers = isFeatureAvailable(shop.plan, "vip_tiers");

  return json({
    program,
    stats: {
      totalIssued: totalIssued._sum.points || 0,
      totalRedeemed: Math.abs(totalRedeemed._sum.points || 0),
    },
    topEarners,
    canUseVipTiers,
    plan: shop.plan,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({ error: "Shop not found", success: false }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "toggle") {
    const isActive = formData.get("isActive") === "true";
    await db.loyaltyProgram.upsert({
      where: { shopId: shop.id },
      update: { isActive },
      create: { shopId: shop.id, isActive },
    });
    return json({ success: true, error: null });
  }

  if (intent === "settings") {
    const pointsPerDollar = parseInt(formData.get("pointsPerDollar") as string, 10);
    const pointsForSignup = parseInt(formData.get("pointsForSignup") as string, 10);
    const pointsForReview = parseInt(formData.get("pointsForReview") as string, 10);
    const pointsForReferral = parseInt(formData.get("pointsForReferral") as string, 10);
    const rewardValue = parseFloat(formData.get("rewardValue") as string);

    if (isNaN(pointsPerDollar) || pointsPerDollar < 0) {
      return json({ error: "Invalid points per dollar", success: false }, { status: 400 });
    }
    if (isNaN(rewardValue) || rewardValue <= 0) {
      return json({ error: "Invalid reward value", success: false }, { status: 400 });
    }

    await db.loyaltyProgram.upsert({
      where: { shopId: shop.id },
      update: {
        pointsPerDollar,
        pointsForSignup: isNaN(pointsForSignup) ? 0 : pointsForSignup,
        pointsForReview: isNaN(pointsForReview) ? 0 : pointsForReview,
        pointsForReferral: isNaN(pointsForReferral) ? 0 : pointsForReferral,
        rewardValue,
      },
      create: {
        shopId: shop.id,
        pointsPerDollar,
        pointsForSignup: isNaN(pointsForSignup) ? 0 : pointsForSignup,
        pointsForReview: isNaN(pointsForReview) ? 0 : pointsForReview,
        pointsForReferral: isNaN(pointsForReferral) ? 0 : pointsForReferral,
        rewardValue,
      },
    });

    return json({ success: true, error: null });
  }

  if (intent === "tiers") {
    const canUseVipTiers = isFeatureAvailable(shop.plan, "vip_tiers");
    if (!canUseVipTiers) {
      return json({ error: "VIP tiers require Growth or Pro plan", success: false }, { status: 403 });
    }

    const tiersJson = formData.get("tiers") as string;
    let tiers: VipTier[] = [];
    try {
      tiers = JSON.parse(tiersJson);
      if (!Array.isArray(tiers)) throw new Error("Tiers must be an array");
      for (const tier of tiers) {
        if (!tier.name || typeof tier.minPoints !== "number" || tier.minPoints < 0) {
          throw new Error("Each tier must have a name and non-negative minPoints");
        }
      }
    } catch (e) {
      return json({ error: `Invalid tiers JSON: ${(e as Error).message}`, success: false }, { status: 400 });
    }

    await db.loyaltyProgram.update({
      where: { shopId: shop.id },
      data: { tiers: tiers as unknown as any },
    });

    return json({ success: true, error: null });
  }

  return json({ error: "Unknown intent", success: false }, { status: 400 });
}

export default function LoyaltyDashboard() {
  const { program, stats, topEarners, canUseVipTiers, plan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const handleToggle = () => {
    const formData = new FormData();
    formData.set("intent", "toggle");
    formData.set("isActive", String(!program.isActive));
    submit(formData, { method: "post" });
  };

  const handleSettingsSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("intent", "settings");
    submit(formData, { method: "post" });
  };

  const handleTiersSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("intent", "tiers");
    submit(formData, { method: "post" });
  };

  const tiers = (program.tiers as VipTier[] | null) || [];
  const roi = stats.totalIssued > 0
    ? ((stats.totalRedeemed / stats.totalIssued) * 100).toFixed(1)
    : "0.0";

  return (
    <div style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "4px" }}>
            Loyalty Program
          </h1>
          <p style={{ color: "#6b7280" }}>
            Reward customers for purchases, reviews, and referrals.
          </p>
        </div>
        <button
          onClick={handleToggle}
          style={{
            padding: "10px 20px",
            borderRadius: "8px",
            border: "none",
            fontWeight: "600",
            cursor: "pointer",
            backgroundColor: program.isActive ? "#ef4444" : "#10b981",
            color: "#ffffff",
          }}
        >
          {program.isActive ? "Deactivate" : "Activate"}
        </button>
      </div>

      {actionData?.success && (
        <div role="alert" style={{ padding: "12px 16px", marginBottom: "16px", backgroundColor: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: "8px", color: "#065f46" }}>
          Settings saved successfully.
        </div>
      )}
      {actionData?.error && (
        <div role="alert" style={{ padding: "12px 16px", marginBottom: "16px", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "8px", color: "#991b1b" }}>
          {actionData.error}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", backgroundColor: "#fff" }}>
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>Total Points Issued</p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>{stats.totalIssued.toLocaleString()}</p>
        </div>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", backgroundColor: "#fff" }}>
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>Total Redeemed</p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>{stats.totalRedeemed.toLocaleString()}</p>
        </div>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", backgroundColor: "#fff" }}>
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>Redemption Rate</p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>{roi}%</p>
        </div>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", backgroundColor: "#fff" }}>
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>Status</p>
          <p style={{ fontSize: "24px", fontWeight: "bold", color: program.isActive ? "#10b981" : "#6b7280" }}>
            {program.isActive ? "Active" : "Inactive"}
          </p>
        </div>
      </div>

      {/* Settings */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px", marginBottom: "24px", backgroundColor: "#fff" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>Point Settings</h2>
        <form onSubmit={handleSettingsSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            <div>
              <label htmlFor="pointsPerDollar" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Points per Dollar Spent
              </label>
              <input id="pointsPerDollar" name="pointsPerDollar" type="number" min={0} defaultValue={program.pointsPerDollar} style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }} />
            </div>
            <div>
              <label htmlFor="pointsForSignup" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Points for Signup
              </label>
              <input id="pointsForSignup" name="pointsForSignup" type="number" min={0} defaultValue={program.pointsForSignup} style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }} />
            </div>
            <div>
              <label htmlFor="pointsForReview" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Points for Review
              </label>
              <input id="pointsForReview" name="pointsForReview" type="number" min={0} defaultValue={program.pointsForReview} style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }} />
            </div>
            <div>
              <label htmlFor="pointsForReferral" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Points for Referral
              </label>
              <input id="pointsForReferral" name="pointsForReferral" type="number" min={0} defaultValue={program.pointsForReferral} style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }} />
            </div>
          </div>
          <div style={{ marginBottom: "16px" }}>
            <label htmlFor="rewardValue" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
              Reward Value ($ per point when redeemed)
            </label>
            <input id="rewardValue" name="rewardValue" type="number" step="0.001" min={0.001} defaultValue={program.rewardValue} style={{ width: "300px", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }} />
            <p style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}>
              Example: 0.01 means 100 points = $1.00 discount
            </p>
          </div>
          <button type="submit" style={{ padding: "10px 24px", borderRadius: "8px", border: "none", fontWeight: "600", fontSize: "14px", cursor: "pointer", backgroundColor: "#3b82f6", color: "#ffffff" }}>
            Save Settings
          </button>
        </form>
      </div>

      {/* VIP Tiers (GROWTH/PRO only) */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px", marginBottom: "24px", backgroundColor: "#fff" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px" }}>VIP Tiers</h2>
        {!canUseVipTiers ? (
          <p style={{ color: "#6b7280", fontSize: "14px" }}>
            VIP tiers are available on the Growth or Pro plan.{" "}
            <a href="/app/billing" style={{ color: "#3b82f6" }}>Upgrade now</a>
          </p>
        ) : (
          <form onSubmit={handleTiersSubmit}>
            <p style={{ color: "#6b7280", fontSize: "13px", marginBottom: "12px" }}>
              Define VIP tiers as JSON. Customers are auto-assigned the highest tier they qualify for based on cumulative points.
            </p>
            <textarea
              name="tiers"
              defaultValue={JSON.stringify(tiers.length > 0 ? tiers : [
                { name: "Silver", minPoints: 500 },
                { name: "Gold", minPoints: 2000 },
                { name: "Platinum", minPoints: 5000 },
              ], null, 2)}
              rows={8}
              style={{ width: "100%", padding: "12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "13px", fontFamily: "monospace" }}
            />
            <button type="submit" style={{ marginTop: "12px", padding: "10px 24px", borderRadius: "8px", border: "none", fontWeight: "600", fontSize: "14px", cursor: "pointer", backgroundColor: "#3b82f6", color: "#ffffff" }}>
              Save Tiers
            </button>
          </form>
        )}
      </div>

      {/* Top Earners */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px", backgroundColor: "#fff" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>Top Earners</h2>
        {topEarners.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: "14px" }}>No loyalty activity yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>Customer</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>Points</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>Tier</th>
              </tr>
            </thead>
            <tbody>
              {topEarners.map((customer) => (
                <tr key={customer.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 12px", fontSize: "14px" }}>
                    {customer.firstName || customer.email}
                    {customer.lastName ? ` ${customer.lastName}` : ""}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: "14px", fontWeight: "600" }}>
                    {customer.loyaltyPoints.toLocaleString()}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: "14px" }}>
                    {customer.loyaltyTier || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
