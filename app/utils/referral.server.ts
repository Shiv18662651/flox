// Referral Program - Core utility functions
// Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.9

import crypto from "crypto";
import { db } from "~/db.server";
import { awardPoints } from "~/utils/loyalty.server";

/**
 * Generate a unique 8-character referral code using crypto.
 * Uses hex encoding of 4 random bytes for URL-safe codes.
 */
export function generateReferralCode(): string {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Generate a unique referral code that doesn't already exist in the database.
 * Retries up to 5 times if a collision occurs.
 */
export async function generateUniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateReferralCode();
    const existing = await db.customer.findFirst({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  // Fallback: use longer code to avoid collision
  return crypto.randomBytes(6).toString("hex");
}

/**
 * Check if a referral code belongs to the given customer (self-referral prevention).
 * Returns true if it IS a self-referral (should be rejected).
 *
 * Validates: Requirements 11.9
 */
export function isSelfReferral(
  customerReferralCode: string | null | undefined,
  usedReferralCode: string
): boolean {
  if (!customerReferralCode) return false;
  return customerReferralCode === usedReferralCode;
}

/**
 * Generate referral codes for all existing customers in a shop that don't have one.
 * Called when the referral program is activated.
 *
 * Validates: Requirements 11.1
 */
export async function generateCodesForExistingCustomers(
  shopId: string
): Promise<number> {
  const customersWithoutCode = await db.customer.findMany({
    where: { shopId, referralCode: null },
    select: { id: true },
  });

  let count = 0;
  for (const customer of customersWithoutCode) {
    const code = await generateUniqueReferralCode();
    await db.customer.update({
      where: { id: customer.id },
      data: { referralCode: code },
    });
    count++;
  }

  return count;
}

/**
 * Handle referral signup: when a referred visitor creates an account.
 * Updates the Referral record status to 'signed_up' and links the customer.
 *
 * Validates: Requirements 11.4
 */
export async function handleReferralSignup(
  shopId: string,
  referralCode: string,
  newCustomerId: string,
  newCustomerEmail: string
): Promise<void> {
  // Find the pending referral for this email/code combination
  const referral = await db.referral.findFirst({
    where: {
      shopId,
      status: "pending",
      referredEmail: newCustomerEmail,
    },
    include: { program: true },
  });

  if (referral) {
    await db.referral.update({
      where: { id: referral.id },
      data: {
        status: "signed_up",
        referredCustomerId: newCustomerId,
      },
    });

    // Mark the new customer as referred
    await db.customer.update({
      where: { id: newCustomerId },
      data: { referredBy: referralCode },
    });
  }
}

/**
 * Handle referral purchase: when a referred customer makes their first purchase.
 * Updates status to 'purchased', creates discount code for advocate, awards loyalty points.
 *
 * Validates: Requirements 11.5, 11.6
 */
export async function handleReferralPurchase(
  shopId: string,
  customerId: string,
  orderId: string
): Promise<void> {
  // Find the signed_up referral for this customer
  const referral = await db.referral.findFirst({
    where: {
      shopId,
      referredCustomerId: customerId,
      status: "signed_up",
    },
    include: { program: true },
  });

  if (!referral) return;

  // Generate a discount code for the advocate
  const discountCode = `REF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  // Update referral status
  await db.referral.update({
    where: { id: referral.id },
    data: {
      status: "purchased",
      discountCode,
      orderId,
    },
  });

  // Award loyalty points to the referring customer
  try {
    const loyaltyProgram = await db.loyaltyProgram.findUnique({
      where: { shopId },
    });

    if (loyaltyProgram && loyaltyProgram.isActive && loyaltyProgram.pointsForReferral > 0) {
      await awardPoints(
        referral.referrerCustomerId,
        shopId,
        loyaltyProgram.id,
        loyaltyProgram.pointsForReferral,
        `Referral reward - friend completed purchase`,
        orderId
      );
    }
  } catch (error) {
    console.error(`[referral] Failed to award loyalty points for referral ${referral.id}:`, error);
  }
}
