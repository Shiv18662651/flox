import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("~/db.server", () => ({
  db: {
    analyticsEvent: {
      create: vi.fn().mockResolvedValue({ id: "evt_123" }),
    },
  },
}));

// Mock the shopify.server module (needed for module resolution)
vi.mock("~/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
}));

import { validatePixelPayload } from "./api.pixel";
import { action, loader } from "./api.pixel";
import { db } from "~/db.server";

describe("api.pixel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validatePixelPayload", () => {
    it("accepts a valid page_view event", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.shopId).toBe("shop_123");
        expect(result.data.sessionId).toBe("sess_abc");
        expect(result.data.visitorId).toBe("vis_xyz");
        expect(result.data.eventType).toBe("page_view");
      }
    });

    it("accepts a valid add_to_cart event with productId", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "add_to_cart",
        productId: "prod_456",
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.eventType).toBe("add_to_cart");
        expect(result.data.productId).toBe("prod_456");
      }
    });

    it("accepts a valid purchase event with revenue and orderId", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "purchase",
        orderId: "order_789",
        revenue: 99.99,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.eventType).toBe("purchase");
        expect(result.data.orderId).toBe("order_789");
        expect(result.data.revenue).toBe(99.99);
      }
    });

    it("accepts UTM parameters", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
        source: "google",
        medium: "cpc",
        campaign: "summer_sale",
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.source).toBe("google");
        expect(result.data.medium).toBe("cpc");
        expect(result.data.campaign).toBe("summer_sale");
      }
    });

    it("rejects null body", () => {
      const result = validatePixelPayload(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Body must be a JSON object");
      }
    });

    it("rejects non-object body", () => {
      const result = validatePixelPayload("string");
      expect(result.valid).toBe(false);
    });

    it("rejects missing shopId", () => {
      const result = validatePixelPayload({
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Missing or invalid shopId");
      }
    });

    it("rejects missing sessionId", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        visitorId: "vis_xyz",
        eventType: "page_view",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Missing or invalid sessionId");
      }
    });

    it("rejects missing visitorId", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        eventType: "page_view",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Missing or invalid visitorId");
      }
    });

    it("rejects missing eventType", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Missing or invalid eventType");
      }
    });

    it("rejects invalid eventType", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "invalid_event",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid eventType: invalid_event");
      }
    });

    it("rejects shopId that is too long", () => {
      const result = validatePixelPayload({
        shopId: "x".repeat(101),
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("shopId too long");
      }
    });

    it("rejects sessionId that is too long", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "x".repeat(101),
        visitorId: "vis_xyz",
        eventType: "page_view",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("sessionId too long");
      }
    });

    it("rejects visitorId that is too long", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "x".repeat(101),
        eventType: "page_view",
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("visitorId too long");
      }
    });

    it("ignores non-string optional fields gracefully", () => {
      const result = validatePixelPayload({
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
        productId: 12345, // number instead of string
        source: null,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.productId).toBeUndefined();
        expect(result.data.source).toBeUndefined();
      }
    });
  });

  describe("action (POST /api/pixel)", () => {
    it("returns 200 with valid payload and creates AnalyticsEvent", async () => {
      const body = {
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
        source: "google",
        medium: "cpc",
        userAgent: "Mozilla/5.0",
      };

      const request = new Request("https://app.example.com/api/pixel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);

      expect(db.analyticsEvent.create).toHaveBeenCalledWith({
        data: {
          shopId: "shop_123",
          sessionId: "sess_abc",
          visitorId: "vis_xyz",
          eventType: "page_view",
          productId: null,
          orderId: null,
          revenue: null,
          source: "google",
          medium: "cpc",
          campaign: null,
          ipAddress: null,
          userAgent: "Mozilla/5.0",
        },
      });
    });

    it("returns 200 even with invalid payload (never break storefront)", async () => {
      const request = new Request("https://app.example.com/api/pixel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invalid: true }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      expect(db.analyticsEvent.create).not.toHaveBeenCalled();
    });

    it("returns 200 even when database throws an error", async () => {
      vi.mocked(db.analyticsEvent.create).mockRejectedValueOnce(
        new Error("DB connection failed")
      );

      const body = {
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
      };

      const request = new Request("https://app.example.com/api/pixel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
    });

    it("includes CORS headers in response", async () => {
      const body = {
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
      };

      const request = new Request("https://app.example.com/api/pixel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "POST, OPTIONS"
      );
    });

    it("extracts IP address from x-forwarded-for header", async () => {
      const body = {
        shopId: "shop_123",
        sessionId: "sess_abc",
        visitorId: "vis_xyz",
        eventType: "page_view",
      };

      const request = new Request("https://app.example.com/api/pixel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
        body: JSON.stringify(body),
      });

      await action({ request, params: {}, context: {} });

      expect(db.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ipAddress: "192.168.1.1",
          }),
        })
      );
    });
  });

  describe("loader (OPTIONS /api/pixel)", () => {
    it("returns 204 with CORS headers for preflight", async () => {
      const response = await loader();

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "POST, OPTIONS"
      );
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type"
      );
    });
  });
});
