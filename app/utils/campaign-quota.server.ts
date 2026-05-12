import type { Plan } from "@prisma/client";
import { isWithinEmailQuota, PLAN_LIMITS } from "~/utils/plan-limits.server";

export interface CampaignQuotaResult {
  allowed: boolean;
  remaining: number;
  exceeded: boolean;
}

/**
 * Check if sending `recipientCount` emails would exceed the shop's monthly email quota.
 * Returns whether the send is allowed, how many emails remain in the quota, and whether the count exceeds the remaining quota.
 */
export async function checkCampaignQuota(
  shopId: string,
  plan: Plan,
  recipientCount: number
): Promise<CampaignQuotaResult> {
  const quotaResult = await isWithinEmailQuota(shopId, plan, recipientCount);

  const remaining = quotaResult.limit - quotaResult.used;
  const exceeded = recipientCount > remaining;
  const allowed = !exceeded;

  return { allowed, remaining, exceeded };
}
