import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("~/db.server", () => ({
  db: {
    shop: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn(),
    },
    webhookEvent: {
      create: vi.fn(),
    },
  },
}));

// Mock the shopify.server module
vi.mock("~/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
  },
}));

// Mock the webhookQueue
vi.mock("../../workers/index", () => ({
  webhookQueue: {
    add: vi.fn().mockResolvedValue({}),
  },
}));

import { action } from "./api.webhooks";
import { db } from "~/db.server";
import { authenticate } from "~/shopify.server";
import { webhookQueue } from "../../workers/index";

describe("api.webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("APP_UNINSTALLED webhook", () => {
    it("marks the shop as inactive and clears the access token", async () => {
      const mockShopDomain = "test-shop.myshopify.com";

      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "APP_UNINSTALLED",
        shop: mockShopDomain,
        payload: {},
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      expect(db.shop.updateMany).toHaveBeenCalledWith({
        where: { shopDomain: mockShopDomain },
        data: {
          isActive: false,
          accessToken: "",
        },
      });
    });

    it("performs soft-delete only — never hard-deletes shop records", async () => {
      const mockShopDomain = "another-shop.myshopify.com";

      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "APP_UNINSTALLED",
        shop: mockShopDomain,
        payload: {},
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify({}),
      });

      await action({ request, params: {}, context: {} });

      // Verify updateMany was called (soft-delete), not delete/deleteMany
      expect(db.shop.updateMany).toHaveBeenCalledTimes(1);
      expect(db.shop.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        })
      );
    });

    it("revokes the stored access token by setting it to empty string", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "APP_UNINSTALLED",
        shop: "token-shop.myshopify.com",
        payload: {},
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify({}),
      });

      await action({ request, params: {}, context: {} });

      expect(db.shop.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accessToken: "" }),
        })
      );
    });

    it("does not look up shop or create WebhookEvent for APP_UNINSTALLED", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "APP_UNINSTALLED",
        shop: "test-shop.myshopify.com",
        payload: {},
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify({}),
      });

      await action({ request, params: {}, context: {} });

      expect(db.shop.findUnique).not.toHaveBeenCalled();
      expect(db.webhookEvent.create).not.toHaveBeenCalled();
      expect(webhookQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("webhook processing for known shops", () => {
    const mockShopDomain = "test-shop.myshopify.com";
    const mockShopId = "shop_123";
    const mockWebhookEventId = "evt_456";

    beforeEach(() => {
      vi.mocked(db.shop.findUnique).mockResolvedValue({ id: mockShopId } as any);
      vi.mocked(db.webhookEvent.create).mockResolvedValue({
        id: mockWebhookEventId,
        shopId: mockShopId,
        topic: "ORDERS_CREATE",
        shopifyId: "789",
        payload: {},
        status: "pending",
        processedAt: null,
        error: null,
        createdAt: new Date(),
      } as any);
    });

    it("creates a WebhookEvent record with status pending", async () => {
      const payload = { id: 789, title: "Test Order" };

      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "ORDERS_CREATE",
        shop: mockShopDomain,
        payload,
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      expect(db.shop.findUnique).toHaveBeenCalledWith({
        where: { shopDomain: mockShopDomain },
        select: { id: true },
      });
      expect(db.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          shopId: mockShopId,
          topic: "ORDERS_CREATE",
          shopifyId: "789",
          payload,
          status: "pending",
        },
      });
    });

    it("enqueues a WEBHOOK job in BullMQ with correct data", async () => {
      const payload = { id: 12345, email: "customer@example.com" };

      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "CUSTOMERS_CREATE",
        shop: mockShopDomain,
        payload,
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      vi.mocked(db.webhookEvent.create).mockResolvedValue({
        id: mockWebhookEventId,
        shopId: mockShopId,
        topic: "CUSTOMERS_CREATE",
        shopifyId: "12345",
        payload,
        status: "pending",
        processedAt: null,
        error: null,
        createdAt: new Date(),
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      await action({ request, params: {}, context: {} });

      expect(webhookQueue.add).toHaveBeenCalledWith("CUSTOMERS_CREATE:12345", {
        shopId: mockShopId,
        topic: "CUSTOMERS_CREATE",
        payload,
        webhookEventId: mockWebhookEventId,
      });
    });

    it("returns HTTP 200 immediately after enqueuing", async () => {
      const payload = { id: 999 };

      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "PRODUCTS_UPDATE",
        shop: mockShopDomain,
        payload,
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      vi.mocked(db.webhookEvent.create).mockResolvedValue({
        id: "evt_789",
        shopId: mockShopId,
        topic: "PRODUCTS_UPDATE",
        shopifyId: "999",
        payload,
        status: "pending",
        processedAt: null,
        error: null,
        createdAt: new Date(),
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
    });

    it("uses payload.id as shopifyId when available", async () => {
      const payload = { id: 42, name: "Product" };

      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "PRODUCTS_CREATE",
        shop: mockShopDomain,
        payload,
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      await action({ request, params: {}, context: {} });

      expect(db.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopifyId: "42",
          }),
        })
      );
    });

    it("uses 'unknown' as shopifyId when payload has no id", async () => {
      const payload = { name: "No ID payload" };

      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "CHECKOUTS_UPDATE",
        shop: mockShopDomain,
        payload,
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      await action({ request, params: {}, context: {} });

      expect(db.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopifyId: "unknown",
          }),
        })
      );
    });
  });

  describe("webhook for unknown shops", () => {
    it("returns 200 without creating WebhookEvent when shop is not found", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "ORDERS_CREATE",
        shop: "unknown-shop.myshopify.com",
        payload: { id: 123 },
        admin: undefined,
        apiVersion: "2024-10",
        session: undefined,
      } as any);

      vi.mocked(db.shop.findUnique).mockResolvedValue(null);

      const request = new Request("https://app.example.com/api/webhooks", {
        method: "POST",
        body: JSON.stringify({ id: 123 }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      expect(db.webhookEvent.create).not.toHaveBeenCalled();
      expect(webhookQueue.add).not.toHaveBeenCalled();
    });
  });
});
