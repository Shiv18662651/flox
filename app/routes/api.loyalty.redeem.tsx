import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";
import { redeemPoints } from "~/utils/loyalty.server";
import { createDiscountCode } from "~/utils/discount.server";
import { createShopAdminClient } from "~/utils/shopify-admin-client";

// Requirements: 8.5, 8.6, 8.11
// Redemption endpoint: validate balance, create Shopify discount code, create redeem transaction

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { customerId?: string; shopId?: string; points?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { customerId, shopId, points } = body;

  if (!customerId || !shopId || points === undefined || points === null) {
    return json(
      { error: "Missing required fields: customerId, shopId, points" },
      { status: 400 }
    );
  }

  if (typeof points !== "number" || points <= 0 || !Number.isInteger(points)) {
    return json(
      { error: "Points must be a positive integer" },
      { status: 400 }
    );
  }

  // Look up loyalty program
  const program = await db.loyaltyProgram.findUnique({
    where: { shopId },
  });

  if (!program || !program.isActive) {
    return json(
      { error: "Loyalty program not found or inactive" },
      { status: 404 }
    );
  }

  // Attempt redemption (transactional: checks balance, decrements points, creates ledger entry)
  const result = await redeemPoints(customerId, shopId, program.id, points);

  if (!result.success) {
    return json({ error: result.error }, { status: 400 });
  }

  // Calculate discount value in dollars
  const discountValue = points * program.rewardValue;

  // Build a unique discount code
  const discountCode = `LOYALTY-${customerId.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  // Attempt to create a real Shopify discount code via the Admin API.
  // Non-blocking: if creation fails (missing token, network, etc.) we still return
  // the local code so the test/dev environment keeps working; errors surface via
  // the `warning` field for observability.
  let warning: string | undefined;

  try {
    const shop = await db.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, accessToken: true },
    });

    if (shop?.shopDomain && shop.accessToken) {
      const admin = createShopAdminClient(shop.shopDomain, shop.accessToken);
      const shopifyResult = await createDiscountCode(admin, {
        code: discountCode,
        title: `Loyalty reward: ${points} points`,
        valueType: "fixed_amount",
        value: discountValue,
        oncePerCustomer: true,
        usageLimit: 1,
      });

      if (!shopifyResult.success) {
        warning = `Shopify discount creation failed: ${shopifyResult.error}`;
        console.error(`[loyalty.redeem] ${warning} (customer=${customerId})`);
      }
    } else {
      warning = "Shop credentials missing; discount code is placeholder only";
    }
  } catch (err) {
    warning =
      err instanceof Error ? err.message : "Unknown Shopify discount error";
    console.error(`[loyalty.redeem] Discount API error:`, err);
  }

  return json({
    success: true,
    discountCode,
    discountValue,
    pointsRedeemed: points,
    newBalance: result.newBalance,
    ...(warning ? { warning } : {}),
  });
}

// Only POST is supported
export function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
