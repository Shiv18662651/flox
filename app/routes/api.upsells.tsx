import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";

// Requirements: 6.2, 6.3, 6.4, 6.6, 6.7
// Public API for the upsell widget to fetch active offers and track metrics.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * GET /api/upsells?shopId={shopId}&type={type}&productId={productId}
 *
 * Returns active upsell offers for the given shop and placement type.
 * Optionally filters by productId for product_page placements.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");
  const type = url.searchParams.get("type");
  const productId = url.searchParams.get("productId");

  if (!shopId) {
    return json(
      { error: "shopId is required" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (!type) {
    return json(
      { error: "type is required" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const validTypes = ["post_purchase", "cart", "product_page", "thank_you"];
  if (!validTypes.includes(type)) {
    return json(
      { error: "Invalid upsell type. Must be one of: post_purchase, cart, product_page, thank_you" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Verify shop exists
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { id: true, isActive: true },
  });

  if (!shop || !shop.isActive) {
    return json(
      { error: "Shop not found or inactive" },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  const where: Record<string, unknown> = {
    shopId,
    type,
    isActive: true,
  };

  // For product_page type, optionally filter by productId
  if (productId && type === "product_page") {
    where.productId = productId;
  }

  const upsells = await db.upsell.findMany({
    where,
    select: {
      id: true,
      type: true,
      productId: true,
      title: true,
      discountPercent: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return json(
    { offers: upsells },
    { headers: CORS_HEADERS },
  );
}

/**
 * POST /api/upsells
 *
 * Track impression or conversion for an upsell offer.
 * Body: { upsellId: string, action: 'impression' | 'conversion', revenue?: number }
 */
export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed" },
      { status: 405, headers: CORS_HEADERS },
    );
  }

  let body: { upsellId?: string; action?: string; revenue?: number };
  try {
    body = await request.json();
  } catch {
    return json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { upsellId, action: trackAction, revenue } = body;

  if (!upsellId) {
    return json(
      { error: "upsellId is required" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (!trackAction || !["impression", "conversion"].includes(trackAction)) {
    return json(
      { error: "action must be 'impression' or 'conversion'" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Verify upsell exists
  const upsell = await db.upsell.findUnique({
    where: { id: upsellId },
    select: { id: true },
  });

  if (!upsell) {
    return json(
      { error: "Upsell not found" },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  if (trackAction === "impression") {
    await db.upsell.update({
      where: { id: upsellId },
      data: { impressions: { increment: 1 } },
    });
  } else if (trackAction === "conversion") {
    const revenueAmount = typeof revenue === "number" && revenue > 0 ? revenue : 0;
    await db.upsell.update({
      where: { id: upsellId },
      data: {
        conversions: { increment: 1 },
        revenue: { increment: revenueAmount },
      },
    });
  }

  return json(
    { success: true },
    { headers: CORS_HEADERS },
  );
}
