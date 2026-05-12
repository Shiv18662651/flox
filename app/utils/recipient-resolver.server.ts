/**
 * Recipient resolver utility for campaign sends.
 * Resolves recipient lists based on mode: all subscribers, customer segment, or manual entry.
 *
 * Requirements: 3.1, 3.3, 4.2, 4.3, 4.4, 4.5, 7.1
 */

import { db } from "~/db.server";
import { parseAndValidateEmails } from "~/utils/email-parser.server";

export type RecipientMode =
  | "all_subscribers"
  | "customer_segment"
  | "manual_entry";

export interface SegmentFilters {
  loyaltyTier?: string;
  minTotalOrders?: number;
  minTotalSpent?: number;
}

export interface ResolvedRecipients {
  emails: string[];
  count: number;
  customerIds: string[];
}

/**
 * Resolves all subscribed customers for a given shop.
 * Returns customers where isSubscribed is true.
 *
 * Requirement 3.1: Query all Customer records where isSubscribed equals true.
 * Requirement 3.3: Resolve at send time for freshness.
 */
export async function resolveAllSubscribers(
  shopId: string
): Promise<ResolvedRecipients> {
  const customers = await db.customer.findMany({
    where: {
      shopId,
      isSubscribed: true,
    },
    select: {
      id: true,
      email: true,
    },
  });

  return {
    emails: customers.map((c) => c.email),
    count: customers.length,
    customerIds: customers.map((c) => c.id),
  };
}

/**
 * Resolves customers matching all active segment filters AND isSubscribed=true.
 * Filters are combined with AND logic.
 *
 * Requirement 4.2: loyaltyTier filter matches exact tier value.
 * Requirement 4.3: minTotalOrders filter uses >= comparison.
 * Requirement 4.4: minTotalSpent filter uses >= comparison.
 * Requirement 4.5: Multiple filters combined with AND logic, plus isSubscribed=true.
 */
export async function resolveSegment(
  shopId: string,
  filters: SegmentFilters
): Promise<ResolvedRecipients> {
  const where: Record<string, unknown> = {
    shopId,
    isSubscribed: true,
  };

  if (filters.loyaltyTier) {
    where.loyaltyTier = filters.loyaltyTier;
  }

  if (filters.minTotalOrders !== undefined && filters.minTotalOrders !== null) {
    where.totalOrders = { gte: filters.minTotalOrders };
  }

  if (filters.minTotalSpent !== undefined && filters.minTotalSpent !== null) {
    where.totalSpent = { gte: filters.minTotalSpent };
  }

  const customers = await db.customer.findMany({
    where,
    select: {
      id: true,
      email: true,
    },
  });

  return {
    emails: customers.map((c) => c.email),
    count: customers.length,
    customerIds: customers.map((c) => c.id),
  };
}

/**
 * Resolves manual email entries by delegating to the email parser.
 * Returns valid unique emails with an empty customerIds array (manual entries
 * are not necessarily in the customer database).
 *
 * Requirement 7.1: Resolve recipient list based on mode.
 */
export function resolveManualEmails(input: string): ResolvedRecipients {
  const parsed = parseAndValidateEmails(input);

  return {
    emails: parsed.valid,
    count: parsed.valid.length,
    customerIds: [],
  };
}

/**
 * Dispatches to the correct resolver based on recipient mode.
 *
 * Requirement 7.1: Resolve the final recipient list based on the selected mode.
 */
export async function resolveRecipients(
  shopId: string,
  mode: RecipientMode,
  segmentFilters: SegmentFilters,
  manualEmails: string
): Promise<ResolvedRecipients> {
  switch (mode) {
    case "all_subscribers":
      return resolveAllSubscribers(shopId);

    case "customer_segment":
      return resolveSegment(shopId, segmentFilters);

    case "manual_entry":
      return resolveManualEmails(manualEmails);

    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown recipient mode: ${_exhaustive}`);
    }
  }
}
