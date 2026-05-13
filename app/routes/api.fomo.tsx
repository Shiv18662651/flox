import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";
import { redis } from "~/redis.server";

// Requirements: 5.1, 5.5, 5.6, 5.8
// REST fallback for FOMO events when Socket.io is unavailable.
// Also serves historical orders for the FOMO widget to cycle through.

interface FomoSettings {
  popupPosition: "bottom-left" | "bottom-right";
  displayDuration: number;
  showHistoricalOrders: boolean;
  historicalInterval: number;
}

const DEFAULT_FOMO_SETTINGS: FomoSettings = {
  popupPosition: "bottom-left",
  displayDuration: 5,
  showHistoricalOrders: true,
  historicalInterval: 30,
};

async function getFomoSettings(shopId: string): Promise<FomoSettings> {
  const raw = await redis.get(`fomo:settings:${shopId}`);
  if (!raw) return { ...DEFAULT_FOMO_SETTINGS };
  try {
    return { ...DEFAULT_FOMO_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_FOMO_SETTINGS };
  }
}

/**
 * GET /api/fomo?shopId={shopId}&productId={productId}
 *
 * Returns recent orders from the past 48 hours as FOMO events.
 * Used as a REST fallback when Socket.io is unavailable (Requirement 5.8)
 * and for historical order display (Requirement 5.5).
 *
 * Response includes FOMO settings so the widget can configure itself.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");
  const shopDomain = url.searchParams.get("shopDomain");
  const productId = url.searchParams.get("productId");

  if (!shopId && !shopDomain) {
    return json({ error: "shopId or shopDomain is required" }, { status: 400 });
  }

  // Resolve shop
  const shop = shopId
    ? await db.shop.findUnique({ where: { id: shopId }, select: { id: true } })
    : await db.shop.findUnique({ where: { shopDomain: shopDomain! }, select: { id: true } });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  // Load FOMO settings for this shop
  const settings = await getFomoSettings(shop.id);

  // If historical orders are disabled and this is a fallback poll, return empty
  if (!settings.showHistoricalOrders) {
    return json(
      { events: [], settings },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Cache-Control": "public, max-age=30",
        },
      },
    );
  }

  // Fetch recent webhook events for orders/create in the past 48 hours
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const recentOrders = await db.webhookEvent.findMany({
    where: {
      shopId: shop.id,
      topic: "ORDERS_CREATE",
      status: "processed",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      payload: true,
      createdAt: true,
    },
  });

  const events = recentOrders.map((order) => {
    const payload = order.payload as Record<string, unknown>;
    const customer = payload?.customer as Record<string, unknown> | undefined;
    const lineItems =
      (payload?.line_items as Array<Record<string, unknown>>) || [];

    return {
      buyerName: (customer?.first_name as string) || "Someone",
      productTitle: (lineItems[0]?.title as string) || "an item",
      productId: lineItems[0]?.product_id?.toString() || null,
      timestamp: order.createdAt.toISOString(),
    };
  });

  // If productId filter is provided, only return events for that product
  const filtered = productId
    ? events.filter((e) => e.productId === productId)
    : events;

  return json(
    { events: filtered, settings },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Cache-Control": "public, max-age=30",
      },
    },
  );
}
