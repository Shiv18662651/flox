import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import type { Plan } from "@prisma/client";
import {
  PLAN_CONFIGS,
  createSubscription,
  cancelSubscription,
  getActiveSubscription,
  isPlanUpgrade,
} from "~/utils/billing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { plan: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Check if returning from Shopify charge approval
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");

  if (chargeId) {
    // Charge was approved — determine which plan was selected
    const activeSubscription = await getActiveSubscription(admin);

    if (activeSubscription && activeSubscription.status === "ACTIVE") {
      // Determine the plan from the subscription name
      const planFromName = getPlanFromSubscriptionName(activeSubscription.name);

      if (planFromName) {
        await db.shop.update({
          where: { shopDomain },
          data: { plan: planFromName },
        });

        return json({
          currentPlan: planFromName,
          plans: PLAN_CONFIGS,
          message: `Successfully upgraded to ${PLAN_CONFIGS[planFromName].name} plan!`,
          error: null,
        });
      }
    }

    // Charge was declined or cancelled
    return json({
      currentPlan: shop.plan,
      plans: PLAN_CONFIGS,
      message: null,
      error: "The charge was not approved. Your plan remains unchanged.",
    });
  }

  return json({
    currentPlan: shop.plan,
    plans: PLAN_CONFIGS,
    message: null,
    error: null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const formData = await request.formData();
  const selectedPlan = formData.get("plan") as Plan | null;

  if (!selectedPlan || !PLAN_CONFIGS[selectedPlan]) {
    return json(
      { error: "Invalid plan selected.", message: null },
      { status: 400 }
    );
  }

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { plan: true },
  });

  if (!shop) {
    return json({ error: "Shop not found.", message: null }, { status: 404 });
  }

  if (shop.plan === selectedPlan) {
    return json(
      { error: "You are already on this plan.", message: null },
      { status: 400 }
    );
  }

  try {
    // If upgrading, cancel existing subscription first
    if (isPlanUpgrade(shop.plan, selectedPlan)) {
      const activeSubscription = await getActiveSubscription(admin);
      if (activeSubscription) {
        await cancelSubscription(admin, activeSubscription.id);
      }
    }

    // Create new subscription
    const returnUrl = `https://${shopDomain}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing`;
    const { confirmationUrl } = await createSubscription(
      admin,
      selectedPlan,
      shopDomain,
      returnUrl
    );

    return redirect(confirmationUrl);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create subscription";
    return json({ error: errorMessage, message: null }, { status: 500 });
  }
}

function getPlanFromSubscriptionName(name: string): Plan | null {
  if (name.includes("Starter")) return "STARTER";
  if (name.includes("Growth")) return "GROWTH";
  if (name.includes("Pro")) return "PRO";
  return null;
}

export default function BillingPage() {
  const { currentPlan, plans, message, error } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const handleSelectPlan = (plan: Plan) => {
    if (plan === currentPlan) return;
    const formData = new FormData();
    formData.set("plan", plan);
    submit(formData, { method: "post" });
  };

  const displayError = actionData?.error || error;
  const displayMessage = actionData?.message || message;

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px" }}>
        Choose Your Plan
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        Select the plan that best fits your store&apos;s needs. All plans
        include core features.
      </p>

      {displayMessage && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            marginBottom: "16px",
            backgroundColor: "#d1fae5",
            border: "1px solid #6ee7b7",
            borderRadius: "8px",
            color: "#065f46",
          }}
        >
          {displayMessage}
        </div>
      )}

      {displayError && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            marginBottom: "16px",
            backgroundColor: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            color: "#991b1b",
          }}
        >
          {displayError}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "24px",
        }}
      >
        {(Object.keys(plans) as Plan[]).map((planKey) => {
          const plan = plans[planKey];
          const isCurrent = planKey === currentPlan;

          return (
            <div
              key={planKey}
              style={{
                border: isCurrent
                  ? "2px solid #3b82f6"
                  : "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                backgroundColor: isCurrent ? "#eff6ff" : "#ffffff",
                position: "relative",
              }}
            >
              {isCurrent && (
                <span
                  style={{
                    position: "absolute",
                    top: "-12px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    padding: "2px 12px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: "600",
                  }}
                >
                  Current Plan
                </span>
              )}

              <h2
                style={{
                  fontSize: "20px",
                  fontWeight: "bold",
                  marginBottom: "4px",
                }}
              >
                {plan.name}
              </h2>
              <p
                style={{
                  color: "#6b7280",
                  fontSize: "14px",
                  marginBottom: "16px",
                }}
              >
                {plan.description}
              </p>

              <div style={{ marginBottom: "20px" }}>
                <span style={{ fontSize: "36px", fontWeight: "bold" }}>
                  ${plan.price}
                </span>
                <span style={{ color: "#6b7280" }}>/mo</span>
              </div>

              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "0 0 24px 0",
                  fontSize: "14px",
                }}
              >
                <li style={{ padding: "4px 0" }}>
                  ✓ {plan.features.emails.toLocaleString()} emails/mo
                </li>
                {plan.features.vipTiers && (
                  <li style={{ padding: "4px 0" }}>✓ VIP loyalty tiers</li>
                )}
                {plan.features.abUpsells && (
                  <li style={{ padding: "4px 0" }}>✓ A/B upsell testing</li>
                )}
                {plan.features.ltvReport && (
                  <li style={{ padding: "4px 0" }}>✓ LTV report & cohorts</li>
                )}
                {plan.features.reviewSentiment && (
                  <li style={{ padding: "4px 0" }}>
                    ✓ AI review sentiment analysis
                  </li>
                )}
              </ul>

              <button
                type="button"
                onClick={() => handleSelectPlan(planKey)}
                disabled={isCurrent}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "none",
                  fontWeight: "600",
                  fontSize: "14px",
                  cursor: isCurrent ? "default" : "pointer",
                  backgroundColor: isCurrent ? "#d1d5db" : "#3b82f6",
                  color: isCurrent ? "#6b7280" : "#ffffff",
                  opacity: isCurrent ? 0.7 : 1,
                }}
                aria-label={
                  isCurrent
                    ? `${plan.name} plan - current plan`
                    : `Select ${plan.name} plan`
                }
              >
                {isCurrent ? "Current Plan" : `Select ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
