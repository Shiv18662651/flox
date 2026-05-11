// Analytics pixel event ingestion endpoint
// Requirements: 10.1, 10.2, 10.3, 10.4, 10.9, 10.10

import type { ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/db.server";

/**
 * Validates the incoming pixel event payload.
 * Returns null if valid, or an error string if invalid.
 */
export function validatePixelPayload(
  body: unknown
): { valid: true; data: PixelEventData } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Body must be a JSON object" };
  }

  const payload = body as Record<string, unknown>;

  // Required fields
  if (!payload.shopId || typeof payload.shopId !== "string") {
    return { valid: false, error: "Missing or invalid shopId" };
  }
  if (!payload.sessionId || typeof payload.sessionId !== "string") {
    return { valid: false, error: "Missing or invalid sessionId" };
  }
  if (!payload.visitorId || typeof payload.visitorId !== "string") {
    return { valid: false, error: "Missing or invalid visitorId" };
  }
  if (!payload.eventType || typeof payload.eventType !== "string") {
    return { valid: false, error: "Missing or invalid eventType" };
  }

  const validEventTypes = ["page_view", "add_to_cart", "purchase"];
  if (!validEventTypes.includes(payload.eventType)) {
    return { valid: false, error: `Invalid eventType: ${payload.eventType}` };
  }

  // Validate string lengths to prevent abuse
  if (payload.shopId.length > 100) {
    return { valid: false, error: "shopId too long" };
  }
  if (payload.sessionId.length > 100) {
    return { valid: false, error: "sessionId too long" };
  }
  if (payload.visitorId.length > 100) {
    return { valid: false, error: "visitorId too long" };
  }

  return {
    valid: true,
    data: {
      shopId: payload.shopId as string,
      sessionId: payload.sessionId as string,
      visitorId: payload.visitorId as string,
      eventType: payload.eventType as string,
      productId: typeof payload.productId === "string" ? payload.productId : undefined,
      orderId: typeof payload.orderId === "string" ? payload.orderId : undefined,
      revenue: typeof payload.revenue === "number" ? payload.revenue : undefined,
      source: typeof payload.source === "string" ? payload.source : undefined,
      medium: typeof payload.medium === "string" ? payload.medium : undefined,
      campaign: typeof payload.campaign === "string" ? payload.campaign : undefined,
      userAgent: typeof payload.userAgent === "string" ? payload.userAgent : undefined,
    },
  };
}

export interface PixelEventData {
  shopId: string;
  sessionId: string;
  visitorId: string;
  eventType: string;
  productId?: string;
  orderId?: string;
  revenue?: number;
  source?: string;
  medium?: string;
  campaign?: string;
  userAgent?: string;
}

// CORS headers for cross-origin storefront requests
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Handle OPTIONS preflight
export async function loader() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  // Always return 200 — never break the storefront
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  try {
    const body = await request.json();
    const result = validatePixelPayload(body);

    if (!result.valid) {
      // Log invalid events but still return 200
      console.warn("[pixel] Invalid event payload:", result.error);
      // TODO: Sentry.captureMessage(`Invalid pixel event: ${result.error}`)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const { data } = result;

    // Extract IP address from request headers
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      undefined;

    // Create AnalyticsEvent record
    await db.analyticsEvent.create({
      data: {
        shopId: data.shopId,
        sessionId: data.sessionId,
        visitorId: data.visitorId,
        eventType: data.eventType,
        productId: data.productId || null,
        orderId: data.orderId || null,
        revenue: data.revenue || null,
        source: data.source || null,
        medium: data.medium || null,
        campaign: data.campaign || null,
        ipAddress: ipAddress || null,
        userAgent: data.userAgent || null,
      },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (error) {
    // Log error but still return 200 — never break the storefront
    console.error("[pixel] Error processing event:", error);
    // TODO: Sentry.captureException(error)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
