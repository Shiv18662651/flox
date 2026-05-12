import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import type { Plan } from "@prisma/client";
import { Icon } from "~/components/Icon";
import {
  PLAN_CONFIGS,
  createSubscription,
  cancelSubscription,
  getActiveSubscription,
  isPlanUpgrade,
} from "~/utils/billing.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

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
    const activeSubscription = await getActiveSubscription(admin);

    if (activeSubscription && activeSubscription.status === "ACTIVE") {
      const planFromName = getPlanFromSubscriptionName(activeSubscription.name);

      if (planFromName) {
        await db.shop.update({
          where: { shopDomain },
          data: { plan: planFromName },
        });

        return json({
          currentPlan: planFromName,
          plans: PLAN_CONFIGS,
          trialDaysRemaining: 14,
          usage: { emailsSent: 1240, emailsLimit: 5000, aiSessions: 42, aiLimit: 100 },
          message: `Successfully upgraded to ${PLAN_CONFIGS[planFromName].name} plan!`,
          error: null,
        });
      }
    }

    return json({
      currentPlan: shop.plan,
      plans: PLAN_CONFIGS,
      trialDaysRemaining: 14,
      usage: { emailsSent: 1240, emailsLimit: 5000, aiSessions: 42, aiLimit: 100 },
      message: null,
      error: "The charge was not approved. Your plan remains unchanged.",
    });
  }

  return json({
    currentPlan: shop.plan,
    plans: PLAN_CONFIGS,
    trialDaysRemaining: 14,
    usage: { emailsSent: 1240, emailsLimit: 5000, aiSessions: 42, aiLimit: 100 },
    message: null,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

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
    if (isPlanUpgrade(shop.plan, selectedPlan)) {
      const activeSubscription = await getActiveSubscription(admin);
      if (activeSubscription) {
        await cancelSubscription(admin, activeSubscription.id);
      }
    }

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlanFromSubscriptionName(name: string): Plan | null {
  if (name.includes("Starter")) return "STARTER";
  if (name.includes("Growth")) return "GROWTH";
  if (name.includes("Pro")) return "PRO";
  return null;
}

// ---------------------------------------------------------------------------
// Plan card data
// ---------------------------------------------------------------------------

const PLAN_DETAILS: {
  key: Plan;
  price: string;
  popular?: boolean;
  features: string[];
}[] = [
  {
    key: "STARTER",
    price: "$29",
    features: [
      "Up to 5,000 emails / mo",
      "Basic Email Marketing",
      "5 Core Analytics Reports",
      "Standard Support",
    ],
  },
  {
    key: "GROWTH",
    price: "$79",
    popular: true,
    features: [
      "Up to 25,000 emails / mo",
      "Advanced AI Automations",
      "Full Loyalty Program Suite",
      "Priority Chat Support",
      "A/B Testing Tools",
      "LTV & Sentiment Reports",
    ],
  },
  {
    key: "PRO",
    price: "$149",
    features: [
      "Up to 100,000 emails / mo",
      "Unlimited AI Sessions",
      "Custom Dedicated Server",
      "API & Webhook Access",
      "Dedicated Account Manager",
    ],
  },
];

const FAQS = [
  {
    q: "Can I change my plan later?",
    a: "Yes, you can upgrade or downgrade at any time. Upgrades are applied immediately and pro-rated. Downgrades take effect at the end of your billing cycle.",
  },
  {
    q: "What payment methods do you accept?",
    a: "All major credit cards including Visa, Mastercard, and American Express are supported through Shopify Billing.",
  },
  {
    q: "Is there a discount for annual billing?",
    a: "Yes! Annual billing gives you 2 months free — effectively a 17% discount compared to monthly payments.",
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UsageMeter({
  label,
  used,
  limit,
  icon,
}: {
  label: string;
  used: number;
  limit: number;
  icon: string;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const warning = pct >= 80;

  return (
    <div className="space-y-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-xs text-on-surface-variant">
          <Icon name={icon} size={18} />
          <span className="text-body-md">{label}</span>
        </div>
        <span className={`text-label-md ${warning ? "text-error" : "text-on-surface"}`}>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${warning ? "bg-error" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-label-sm text-on-surface-variant text-right">{pct}% used</p>
    </div>
  );
}

function FaqItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-sm py-md text-left flex justify-between items-center hover:bg-surface-container-low transition-colors"
        aria-expanded={open}
      >
        <span className="text-label-md text-on-surface">{q}</span>
        <span
          className="text-on-surface-variant transition-transform duration-200 inline-block"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <Icon name="expand_more" size={24} />
        </span>
      </button>
      {open && (
        <div className="px-sm pb-md text-body-md text-on-surface-variant border-t border-outline-variant pt-sm">
          {a}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const { currentPlan, plans, trialDaysRemaining, usage, message, error } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const displayError = actionData?.error || error;
  const displayMessage = actionData?.message || message;

  const handleSelectPlan = (plan: Plan) => {
    if (plan === currentPlan) return;
    const formData = new FormData();
    formData.set("plan", plan);
    submit(formData, { method: "post" });
  };

  return (
    <main className="min-h-screen bg-background font-sans">
      {/* ── Trial Banner ─────────────────────────────────────────────────── */}
      <div className="bg-secondary-container text-on-secondary-container px-lg py-xs flex items-center justify-between gap-md flex-wrap">
        <div className="flex items-center gap-xs">
          <Icon name="schedule" size={20} />
          <span className="text-label-md">
            <strong>Trial Period</strong> — {trialDaysRemaining} days remaining.
            Upgrade anytime to keep your data and features.
          </span>
        </div>
        <button
          type="button"
          onClick={() => handleSelectPlan("GROWTH")}
          className="text-label-sm font-semibold bg-primary text-on-primary px-sm py-1 rounded-full hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          Upgrade Now
        </button>
      </div>

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <header className="h-16 px-lg flex items-center bg-surface border-b border-outline-variant">
        <div className="flex items-center gap-xs">
          <Icon name="credit_card" size={24} className="text-primary" />
          <h1 className="text-headline-md font-semibold text-on-surface">Billing &amp; Plans</h1>
        </div>
      </header>

      <div className="p-lg space-y-lg max-w-container-max mx-auto">
        {/* ── Alerts ───────────────────────────────────────────────────────── */}
        {displayMessage && (
          <div className="bg-secondary-container text-on-secondary-container px-sm py-xs rounded-lg flex items-center gap-xs">
            <Icon name="check_circle" size={20} />
            <span className="text-label-md">{displayMessage}</span>
          </div>
        )}
        {displayError && (
          <div className="bg-error-container text-on-error-container px-sm py-xs rounded-lg flex items-center gap-xs">
            <Icon name="error" size={20} />
            <span className="text-label-md">{displayError}</span>
          </div>
        )}

        {/* ── Current Plan + Usage ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
          {/* Current plan card */}
          <div className="md:col-span-1 bg-primary text-on-primary p-md rounded-xl shadow-md flex flex-col justify-between">
            <div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-on-primary-container text-primary text-label-sm rounded-full mb-sm font-semibold">
                <Icon name="verified" size={14} />
                Active Plan
              </span>
              <h2 className="text-headline-md font-bold mt-xs">
                {plans[currentPlan]?.name ?? currentPlan}
              </h2>
              <p className="text-body-md opacity-80 mt-1">
                {plans[currentPlan]?.description ?? "All features for your tier enabled."}
              </p>
            </div>
            <div className="mt-lg">
              <div className="flex items-end gap-1">
                <span className="text-display-lg font-bold">
                  ${plans[currentPlan]?.price ?? 0}
                </span>
                <span className="text-body-md opacity-70 mb-1">/mo</span>
              </div>
              <p className="text-label-sm opacity-60 mt-1">
                Trial ends in {trialDaysRemaining} days
              </p>
            </div>
          </div>

          {/* Usage meters */}
          <div className="md:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-md shadow-sm">
            <div className="flex items-center gap-xs mb-md">
              <Icon name="data_usage" size={24} className="text-primary" />
              <h3 className="text-label-md font-semibold text-on-surface">
                Current Month Usage
              </h3>
            </div>
            <div className="space-y-md">
              <UsageMeter
                label="Email Marketing"
                used={usage.emailsSent}
                limit={usage.emailsLimit}
                icon="mail"
              />
              <UsageMeter
                label="AI Conversations"
                used={usage.aiSessions}
                limit={usage.aiLimit}
                icon="smart_toy"
              />
            </div>
          </div>
        </div>

        {/* ── Plan Comparison ──────────────────────────────────────────────── */}
        <section className="space-y-md">
          <div className="text-center">
            <h2 className="text-headline-md font-semibold text-on-surface">
              Choose the right plan for your business
            </h2>
            <p className="text-on-surface-variant text-body-md mt-xs">
              Scalable pricing that grows with your merchant success.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-md items-start">
            {PLAN_DETAILS.map((plan) => {
              const isCurrent = plan.key === currentPlan;
              const config = plans[plan.key];

              return (
                <div
                  key={plan.key}
                  className={`relative bg-surface-container-lowest rounded-xl flex flex-col transition-shadow ${
                    plan.popular
                      ? "border-2 border-primary shadow-lg ring-2 ring-primary/10 md:-mt-4"
                      : "border border-outline-variant shadow-sm hover:shadow-md"
                  }`}
                >
                  {/* Popular badge */}
                  {plan.popular && (
                    <div className="absolute -top-4 inset-x-0 flex justify-center">
                      <span className="bg-primary text-on-primary px-sm py-1 rounded-full text-label-sm font-bold uppercase tracking-wider shadow">
                        ⭐ Most Popular
                      </span>
                    </div>
                  )}

                  <div className={`p-md ${plan.popular ? "pt-lg" : ""}`}>
                    {/* Plan name & price */}
                    <div className="mb-md">
                      <h3 className="text-headline-sm font-semibold text-on-surface">
                        {config?.name ?? plan.key}
                      </h3>
                      <p className="text-body-md text-on-surface-variant mt-1">
                        {config?.description}
                      </p>
                      <div className="flex items-end gap-1 mt-sm">
                        <span
                          className={`text-display-lg font-bold ${
                            plan.popular ? "text-primary" : "text-on-surface"
                          }`}
                        >
                          {plan.price}
                        </span>
                        <span className="text-on-surface-variant text-body-md mb-1">/month</span>
                      </div>
                    </div>

                    {/* Feature list */}
                    <ul className="space-y-xs mb-md">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-xs text-body-md text-on-surface">
                          <Icon
                            name="check_circle"
                            size={18}
                            className="text-primary shrink-0 mt-[2px]"
                          />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>

                    {/* CTA button */}
                    <button
                      type="button"
                      onClick={() => handleSelectPlan(plan.key)}
                      disabled={isCurrent}
                      className={`w-full py-2.5 px-4 rounded-lg text-label-md font-semibold transition-all ${
                        isCurrent
                          ? "bg-surface-container text-on-surface-variant cursor-default"
                          : plan.popular
                          ? "bg-primary text-on-primary hover:opacity-90 shadow-sm"
                          : "border border-primary text-primary hover:bg-surface-container-low"
                      }`}
                    >
                      {isCurrent
                        ? "✓ Current Plan"
                        : `Choose ${config?.name ?? plan.key}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── FAQ Accordion ────────────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto space-y-md py-lg">
          <div className="text-center mb-md">
            <h2 className="text-headline-sm font-semibold text-on-surface">
              Frequently Asked Questions
            </h2>
            <p className="text-body-md text-on-surface-variant mt-xs">
              Everything you need to know about billing.
            </p>
          </div>
          <div className="space-y-xs">
            {FAQS.map((faq, i) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} defaultOpen={i === 0} />
            ))}
          </div>
        </section>

        {/* ── Enterprise CTA Banner ────────────────────────────────────────── */}
        <section className="bg-primary rounded-xl p-lg flex flex-col md:flex-row items-center justify-between gap-md shadow-md">
          <div className="flex items-start gap-md">
            <div className="w-12 h-12 rounded-full bg-on-primary-container/20 flex items-center justify-center shrink-0">
              <Icon name="business" size={28} className="text-on-primary" />
            </div>
            <div>
              <h3 className="text-headline-sm font-bold text-on-primary">
                Need an Enterprise plan?
              </h3>
              <p className="text-body-md text-on-primary opacity-80 mt-1 max-w-lg">
                Custom email volumes, dedicated infrastructure, SLA guarantees, and a
                dedicated account manager. Let's build a plan that fits your scale.
              </p>
            </div>
          </div>
          <a
            href="mailto:enterprise@nexify.app"
            className="shrink-0 bg-on-primary text-primary font-semibold text-label-md px-lg py-2.5 rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            Contact Sales
          </a>
        </section>
      </div>
    </main>
  );
}
