// Loyalty Program - Core utility functions
// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.10, 8.11

import { db } from "~/db.server";

/**
 * Calculate loyalty points earned from an order subtotal.
 * Returns floor(subtotal × pointsPerDollar) — no floating-point drift.
 *
 * Validates: Requirements 8.2
 */
export function calculatePointsEarned(
  subtotal: number,
  pointsPerDollar: number
): number {
  return Math.floor(subtotal * pointsPerDollar);
}

/**
 * Award points to a customer. Creates a LoyaltyTransaction of type 'earn'
 * and updates the Customer.loyaltyPoints denormalized counter.
 *
 * Validates: Requirements 8.3, 8.4, 8.6, 8.10
 */
export async function awardPoints(
  customerId: string,
  shopId: string,
  programId: string,
  points: number,
  reason: string,
  orderId?: string
): Promise<{ transactionId: string; newBalance: number }> {
  if (points <= 0) {
    throw new Error("Points to award must be positive");
  }

  const [transaction, customer] = await db.$transaction([
    db.loyaltyTransaction.create({
      data: {
        shopId,
        customerId,
        programId,
        type: "earn",
        points,
        reason,
        orderId: orderId || null,
      },
    }),
    db.customer.update({
      where: { id: customerId },
      data: {
        loyaltyPoints: { increment: points },
      },
    }),
  ]);

  return {
    transactionId: transaction.id,
    newBalance: customer.loyaltyPoints,
  };
}

/**
 * Redeem points from a customer's balance. Creates a LoyaltyTransaction of type 'redeem'
 * (negative points) and updates Customer.loyaltyPoints transactionally.
 * Rejects if redemption would result in negative balance.
 *
 * Validates: Requirements 8.5, 8.6, 8.11
 */
export async function redeemPoints(
  customerId: string,
  shopId: string,
  programId: string,
  points: number
): Promise<
  | { success: true; transactionId: string; newBalance: number }
  | { success: false; error: string }
> {
  if (points <= 0) {
    return { success: false, error: "Points to redeem must be positive" };
  }

  // Check current balance
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { loyaltyPoints: true },
  });

  if (!customer) {
    return { success: false, error: "Customer not found" };
  }

  if (customer.loyaltyPoints < points) {
    return {
      success: false,
      error: `Insufficient balance. Current balance: ${customer.loyaltyPoints}, requested: ${points}`,
    };
  }

  // Perform redemption transactionally
  const [transaction, updatedCustomer] = await db.$transaction([
    db.loyaltyTransaction.create({
      data: {
        shopId,
        customerId,
        programId,
        type: "redeem",
        points: -points,
        reason: "Point redemption for discount",
      },
    }),
    db.customer.update({
      where: { id: customerId },
      data: {
        loyaltyPoints: { decrement: points },
      },
    }),
  ]);

  return {
    success: true,
    transactionId: transaction.id,
    newBalance: updatedCustomer.loyaltyPoints,
  };
}

/**
 * Get a customer's current loyalty balance from the Customer record.
 */
export async function getCustomerBalance(
  customerId: string
): Promise<{ points: number; tier: string | null } | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { loyaltyPoints: true, loyaltyTier: true },
  });

  if (!customer) return null;

  return {
    points: customer.loyaltyPoints,
    tier: customer.loyaltyTier,
  };
}

/**
 * VIP tier definition from LoyaltyProgram.tiers JSON.
 */
export interface VipTier {
  name: string;
  minPoints: number;
}

/**
 * Assign a VIP tier to a customer based on their cumulative points balance.
 * Tiers are sorted by minPoints descending — the highest qualifying tier is assigned.
 *
 * Validates: Requirements 8.8
 */
export async function assignTier(
  customerId: string,
  tiers: VipTier[] | null | undefined,
  currentPoints: number
): Promise<string | null> {
  if (!tiers || tiers.length === 0) {
    return null;
  }

  // Sort tiers by minPoints descending to find the highest qualifying tier
  const sortedTiers = [...tiers].sort((a, b) => b.minPoints - a.minPoints);
  const qualifyingTier = sortedTiers.find(
    (tier) => currentPoints >= tier.minPoints
  );

  const tierName = qualifyingTier?.name || null;

  await db.customer.update({
    where: { id: customerId },
    data: { loyaltyTier: tierName },
  });

  return tierName;
}
