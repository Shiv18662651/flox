import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";

// Requirements: 8.7, 8.9
// Public API endpoint for loyalty widget to fetch customer balance

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");
  const customerId = url.searchParams.get("customerId");

  if (!shopId || !customerId) {
    return json(
      { error: "Missing required params: shopId, customerId" },
      { status: 400 }
    );
  }

  // Look up loyalty program
  const program = await db.loyaltyProgram.findUnique({
    where: { shopId },
    select: { isActive: true, rewardValue: true, tiers: true },
  });

  if (!program || !program.isActive) {
    return json(
      { error: "Loyalty program not active" },
      { status: 404 }
    );
  }

  // Look up customer
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { loyaltyPoints: true, loyaltyTier: true, shopId: true, referralCode: true },
  });

  if (!customer || customer.shopId !== shopId) {
    return json(
      { error: "Customer not found" },
      { status: 404 }
    );
  }

  const availableRewardValue = customer.loyaltyPoints * program.rewardValue;

  // Check if referral program is active to include referral code
  let referralCode: string | null = null;
  if (customer.referralCode) {
    const referralProgram = await db.referralProgram.findUnique({
      where: { shopId },
      select: { isActive: true },
    });
    if (referralProgram?.isActive) {
      referralCode = customer.referralCode;
    }
  }

  return json({
    points: customer.loyaltyPoints,
    tier: customer.loyaltyTier,
    rewardValue: Math.round(availableRewardValue * 100) / 100,
    currency: "USD",
    referralCode,
  });
}
