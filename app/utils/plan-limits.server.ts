import type { Plan } from "@prisma/client";
import { db } from "~/db.server";
import { PLAN_CONFIGS } from "~/utils/billing.server";

// Plan limits by tier
export const PLAN_LIMITS = {
  STARTER: { emails: 5000 },
  GROWTH: { emails: 25000 },
  PRO: { emails: 100000 },
} as const;

// Features restricted to GROWTH or PRO plans
export const RESTRICTED_FEATURES = [
  "review_sentiment",
  "ab_upsells",
  "vip_tiers",
  "ltv_report",
  "cohort_chart",
] as const;

export type RestrictedFeature = (typeof RESTRICTED_FEATURES)[number];

export interface QuotaResult {
  allowed: boolean;
  limit: number;
  used: number;
}

export interface PlanGateResult {
  allowed: boolean;
  requiredPlan: Plan;
  currentPlan: Plan;
  upgradeMessage?: string;
}

/**
 * Check if a shop is within its monthly email quota.
 * Returns { allowed, limit, used } indicating whether additionalCount more emails can be sent.
 */
export async function isWithinEmailQuota(
  shopId: string,
  plan: Plan,
  additionalCount: number = 1
): Promise<QuotaResult> {
  const limit = PLAN_LIMITS[plan].emails;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const used = await db.emailSend.count({
    where: {
      shopId,
      createdAt: { gte: startOfMonth },
      status: { not: "failed" },
    },
  });

  return {
    allowed: used + additionalCount <= limit,
    limit,
    used,
  };
}

/**
 * Check if a shop's plan meets the minimum required plan for a feature.
 * Returns { allowed: true } or { allowed: false, requiredPlan, currentPlan, upgradeMessage }
 */
export function requirePlan(currentPlan: Plan, minimumPlan: Plan): PlanGateResult {
  const planOrder: Plan[] = ["STARTER", "GROWTH", "PRO"];
  const currentIndex = planOrder.indexOf(currentPlan);
  const requiredIndex = planOrder.indexOf(minimumPlan);

  if (currentIndex >= requiredIndex) {
    return { allowed: true, requiredPlan: minimumPlan, currentPlan };
  }

  return {
    allowed: false,
    requiredPlan: minimumPlan,
    currentPlan,
    upgradeMessage: `This feature requires the ${PLAN_CONFIGS[minimumPlan].name} plan or higher. You are currently on the ${PLAN_CONFIGS[currentPlan].name} plan.`,
  };
}

/**
 * Check if a specific restricted feature is available for the given plan.
 */
export function isFeatureAvailable(plan: Plan, feature: RestrictedFeature): boolean {
  switch (feature) {
    case "review_sentiment":
      return PLAN_CONFIGS[plan].features.reviewSentiment;
    case "ab_upsells":
      return PLAN_CONFIGS[plan].features.abUpsells;
    case "vip_tiers":
      return PLAN_CONFIGS[plan].features.vipTiers;
    case "ltv_report":
    case "cohort_chart":
      return PLAN_CONFIGS[plan].features.ltvReport;
    default:
      return false;
  }
}
