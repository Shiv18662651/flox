import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { db } from "~/db.server";

// Requirements: 11.3, 11.4, 11.5, 11.9
// Referral link handler - public GET route
// GET /api/referral?code={referralCode}&shop={shopDomain}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const shopDomain = url.searchParams.get("shop");

  if (!code) {
    return json(
      { error: "Missing referral code" },
      { status: 400 }
    );
  }

  if (!shopDomain) {
    return json(
      { error: "Missing shop parameter" },
      { status: 400 }
    );
  }

  // Find the customer who owns this referral code
  const referrer = await db.customer.findFirst({
    where: { referralCode: code },
    select: { id: true, shopId: true, email: true, referralCode: true },
  });

  if (!referrer) {
    return json(
      { error: "Invalid referral code" },
      { status: 404 }
    );
  }

  // Verify the shop matches
  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop || shop.id !== referrer.shopId) {
    return json(
      { error: "Invalid referral code for this shop" },
      { status: 404 }
    );
  }

  // Self-referral check: check if the visitor is the same customer
  // We check via a visitor email cookie/header if available
  const visitorEmail = url.searchParams.get("email");
  if (visitorEmail && visitorEmail === referrer.email) {
    return json(
      { error: "You cannot use your own referral code" },
      { status: 400 }
    );
  }

  // Find the referral program
  const program = await db.referralProgram.findUnique({
    where: { shopId: referrer.shopId },
    select: { id: true, isActive: true, friendDiscount: true },
  });

  if (!program || !program.isActive) {
    return json(
      { error: "Referral program is not active" },
      { status: 400 }
    );
  }

  // Create a pending Referral record (Req 11.3)
  // Use a placeholder email since we don't know the visitor's email yet
  const referredEmail = visitorEmail || `pending-${Date.now()}@referral.pending`;

  await db.referral.create({
    data: {
      shopId: referrer.shopId,
      programId: program.id,
      referrerCustomerId: referrer.id,
      referredEmail,
      status: "pending",
    },
  });

  // Return success with referral info
  // In a real implementation, this would set a cookie and redirect to the store
  return json({
    success: true,
    referralCode: code,
    friendDiscount: program.friendDiscount,
    message: `Referral tracked! Your friend will receive a ${program.friendDiscount}% discount.`,
  });
}
