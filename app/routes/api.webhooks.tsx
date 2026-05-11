import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { webhookQueue } from "../../workers/index";
import { emitFomoEvent } from "~/socket.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // APP_UNINSTALLED is handled directly (shop may not exist for queue lookup)
  if (topic === "APP_UNINSTALLED") {
    await handleAppUninstalled(shop);
    return new Response(null, { status: 200 });
  }

  // Look up shop to get internal ID
  const shopRecord = await db.shop.findUnique({
    where: { shopDomain: shop },
    select: { id: true },
  });

  if (!shopRecord) {
    console.error(`Webhook received for unknown shop: ${shop}`);
    return new Response(null, { status: 200 }); // Still return 200 to Shopify
  }

  const shopifyId = (payload as any)?.id?.toString() || "unknown";

  // FOMO: Emit real-time FOMO event immediately for ORDERS_CREATE (Requirement 5.1)
  // This runs in the Remix process which has access to Socket.io
  if (topic === "ORDERS_CREATE") {
    try {
      const orderPayload = payload as Record<string, unknown>;
      const customer = orderPayload?.customer as Record<string, unknown> | undefined;
      const lineItems = (orderPayload?.line_items as Array<Record<string, unknown>>) || [];

      emitFomoEvent(shopRecord.id, {
        buyerName: (customer?.first_name as string) || "Someone",
        productTitle: (lineItems[0]?.title as string) || "an item",
        productId: lineItems[0]?.product_id?.toString(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Non-blocking: FOMO emission failure should not affect webhook processing
      console.error(`[webhook] Failed to emit FOMO event for shop ${shopRecord.id}:`, err);
    }
  }

  // Create WebhookEvent record with status "pending"
  const webhookEvent = await db.webhookEvent.create({
    data: {
      shopId: shopRecord.id,
      topic,
      shopifyId,
      payload: payload as any,
      status: "pending",
    },
  });

  // Enqueue for async processing via BullMQ
  await webhookQueue.add(`${topic}:${shopifyId}`, {
    shopId: shopRecord.id,
    topic,
    payload,
    webhookEventId: webhookEvent.id,
  });

  return new Response(null, { status: 200 });
}

async function handleAppUninstalled(shopDomain: string) {
  // Soft-delete: mark shop as inactive and revoke stored access token (Requirement 1.8)
  // Uses updateMany to gracefully handle case where shop record doesn't exist
  await db.shop.updateMany({
    where: { shopDomain },
    data: {
      isActive: false,
      accessToken: "",
    },
  });
}
