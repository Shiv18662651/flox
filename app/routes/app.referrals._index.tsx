import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { generateCodesForExistingCustomers } from "~/utils/referral.server";

// Requirements: 11.1, 11.2, 11.7

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

  // Dashboard stats - Requirements: 11.7
  const totalReferrals = await db.referral.count({
    where: { shopId: shop.id },
  });

  const purchasedReferrals = await db.referral.count({
    where: { shopId: shop.id, status: "purchased" },
  });

  const rewardedReferrals = await db.referral.count({
    where: { shopId: shop.id, status: "rewarded" },
  });

  const conversionRate =
    totalReferrals > 0
      ? (((purchasedReferrals + rewardedReferrals) / totalReferrals) * 100).toFixed(1)
      : "0.0";

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
      totalReferrals,
      purchasedReferrals: purchasedReferrals + rewardedReferrals,
      conversionRate,
    },
    recentReferrals,
  });
}

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

export default function ReferralsDashboard() {
  const { program, stats, recentReferrals } = useLoaderData<typeof loader>();
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

  return (
    <div style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "4px" }}>
            Referral Program
          </h1>
          <p style={{ color: "#6b7280" }}>
            Reward customers for referring their friends.
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
          {(actionData as any).message || "Settings saved successfully."}
        </div>
      )}
      {actionData?.error && (
        <div role="alert" style={{ padding: "12px 16px", marginBottom: "16px", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "8px", color: "#991b1b" }}>
          {actionData.error}
        </div>
      )}

      {/* Stats - Requirements: 11.7 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", backgroundColor: "#fff" }}>
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>Total Referrals</p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>{stats.totalReferrals}</p>
        </div>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", backgroundColor: "#fff" }}>
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>Conversion Rate</p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>{stats.conversionRate}%</p>
        </div>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", backgroundColor: "#fff" }}>
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>Converted</p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>{stats.purchasedReferrals}</p>
        </div>
      </div>

      {/* Settings */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px", marginBottom: "24px", backgroundColor: "#fff" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>Reward Settings</h2>
        <form onSubmit={handleSettingsSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            <div>
              <label htmlFor="advocateReward" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Advocate Reward ($)
              </label>
              <input
                id="advocateReward"
                name="advocateReward"
                type="number"
                step="0.01"
                min={0}
                defaultValue={program.advocateReward}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}
              />
              <p style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}>
                Discount value given to the referrer
              </p>
            </div>
            <div>
              <label htmlFor="friendDiscount" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Friend Discount (%)
              </label>
              <input
                id="friendDiscount"
                name="friendDiscount"
                type="number"
                step="0.1"
                min={0}
                max={100}
                defaultValue={program.friendDiscount}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}
              />
              <p style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}>
                Discount for the referred friend
              </p>
            </div>
            <div>
              <label htmlFor="rewardType" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Reward Type
              </label>
              <select
                id="rewardType"
                name="rewardType"
                defaultValue={program.rewardType}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}
              >
                <option value="discount">Discount Code</option>
                <option value="points">Loyalty Points</option>
              </select>
            </div>
          </div>
          <button type="submit" style={{ padding: "10px 24px", borderRadius: "8px", border: "none", fontWeight: "600", fontSize: "14px", cursor: "pointer", backgroundColor: "#3b82f6", color: "#ffffff" }}>
            Save Settings
          </button>
        </form>
      </div>

      {/* Recent Referrals */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px", backgroundColor: "#fff" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>Recent Referrals</h2>
        {recentReferrals.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: "14px" }}>No referrals yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>Referred Email</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>Status</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>Discount Code</th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentReferrals.map((referral) => (
                <tr key={referral.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 12px", fontSize: "14px" }}>{referral.referredEmail}</td>
                  <td style={{ padding: "8px 12px", fontSize: "14px" }}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: "500",
                      backgroundColor:
                        referral.status === "purchased" || referral.status === "rewarded"
                          ? "#d1fae5"
                          : referral.status === "signed_up"
                          ? "#dbeafe"
                          : "#f3f4f6",
                      color:
                        referral.status === "purchased" || referral.status === "rewarded"
                          ? "#065f46"
                          : referral.status === "signed_up"
                          ? "#1e40af"
                          : "#374151",
                    }}>
                      {referral.status}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: "14px", fontFamily: "monospace" }}>
                    {referral.discountCode || "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: "14px", color: "#6b7280" }}>
                    {new Date(referral.createdAt).toLocaleDateString()}
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
