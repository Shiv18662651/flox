import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock authenticate
const mockAuthenticate = vi.fn();

vi.mock("~/shopify.server", () => ({
  authenticate: {
    admin: (...args: unknown[]) => mockAuthenticate(...args),
  },
}));

// Mock db
const mockShopFindUnique = vi.fn();

vi.mock("~/db.server", () => ({
  db: {
    shop: {
      findUnique: (...args: unknown[]) => mockShopFindUnique(...args),
    },
  },
}));

// Mock redis
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();

vi.mock("~/redis.server", () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}));

import { loader, action } from "./app.fomo._index";
import { getFomoSettings, saveFomoSettings } from "../utils/fomo.server";

function createRequest(
  method: string = "GET",
  body?: Record<string, string>,
): Request {
  if (method === "GET") {
    return new Request("http://localhost/app/fomo", { method: "GET" });
  }

  const formData = new URLSearchParams();
  if (body) {
    for (const [key, value] of Object.entries(body)) {
      formData.set(key, value);
    }
  }

  return new Request("http://localhost/app/fomo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
}

describe("app.fomo settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      session: { shop: "test-shop.myshopify.com" },
    });
    mockShopFindUnique.mockResolvedValue({ id: "shop-123" });
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
  });

  describe("getFomoSettings", () => {
    it("returns default settings when Redis has no data", async () => {
      mockRedisGet.mockResolvedValue(null);
      const settings = await getFomoSettings("shop-123");
      expect(settings).toEqual({
        popupPosition: "bottom-left",
        displayDuration: 5,
        showHistoricalOrders: true,
        historicalInterval: 30,
      });
    });

    it("returns stored settings from Redis", async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({
          popupPosition: "bottom-right",
          displayDuration: 10,
          showHistoricalOrders: false,
          historicalInterval: 60,
        }),
      );
      const settings = await getFomoSettings("shop-123");
      expect(settings.popupPosition).toBe("bottom-right");
      expect(settings.displayDuration).toBe(10);
      expect(settings.showHistoricalOrders).toBe(false);
      expect(settings.historicalInterval).toBe(60);
    });

    it("returns defaults when Redis has invalid JSON", async () => {
      mockRedisGet.mockResolvedValue("not-valid-json");
      const settings = await getFomoSettings("shop-123");
      expect(settings).toEqual({
        popupPosition: "bottom-left",
        displayDuration: 5,
        showHistoricalOrders: true,
        historicalInterval: 30,
      });
    });

    it("merges partial settings with defaults", async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ popupPosition: "bottom-right" }),
      );
      const settings = await getFomoSettings("shop-123");
      expect(settings.popupPosition).toBe("bottom-right");
      expect(settings.displayDuration).toBe(5); // default
      expect(settings.showHistoricalOrders).toBe(true); // default
      expect(settings.historicalInterval).toBe(30); // default
    });
  });

  describe("saveFomoSettings", () => {
    it("saves settings to Redis with correct key", async () => {
      const settings = {
        popupPosition: "bottom-right" as const,
        displayDuration: 8,
        showHistoricalOrders: true,
        historicalInterval: 45,
      };
      await saveFomoSettings("shop-123", settings);
      expect(mockRedisSet).toHaveBeenCalledWith(
        "fomo:settings:shop-123",
        JSON.stringify(settings),
      );
    });
  });

  describe("loader", () => {
    it("returns settings for authenticated shop", async () => {
      const request = createRequest("GET");
      const response = await loader({ request, params: {}, context: {} });
      const data = await response.json();

      expect(data.settings).toBeDefined();
      expect(data.shopId).toBe("shop-123");
    });

    it("throws 404 when shop is not found", async () => {
      mockShopFindUnique.mockResolvedValue(null);
      const request = createRequest("GET");

      await expect(
        loader({ request, params: {}, context: {} }),
      ).rejects.toThrow();
    });
  });

  describe("action", () => {
    it("saves valid settings and returns success", async () => {
      const request = createRequest("POST", {
        popupPosition: "bottom-right",
        displayDuration: "8",
        showHistoricalOrders: "true",
        historicalInterval: "45",
      });

      const response = await action({ request, params: {}, context: {} });
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.error).toBeNull();
      expect(mockRedisSet).toHaveBeenCalledWith(
        "fomo:settings:shop-123",
        JSON.stringify({
          popupPosition: "bottom-right",
          displayDuration: 8,
          showHistoricalOrders: true,
          historicalInterval: 45,
        }),
      );
    });

    it("rejects invalid popup position", async () => {
      const request = createRequest("POST", {
        popupPosition: "top-center",
        displayDuration: "5",
        showHistoricalOrders: "true",
        historicalInterval: "30",
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid popup position");
    });

    it("rejects display duration below 1", async () => {
      const request = createRequest("POST", {
        popupPosition: "bottom-left",
        displayDuration: "0",
        showHistoricalOrders: "true",
        historicalInterval: "30",
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Display duration");
    });

    it("rejects display duration above 30", async () => {
      const request = createRequest("POST", {
        popupPosition: "bottom-left",
        displayDuration: "31",
        showHistoricalOrders: "true",
        historicalInterval: "30",
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(400);
    });

    it("rejects historical interval below 10", async () => {
      const request = createRequest("POST", {
        popupPosition: "bottom-left",
        displayDuration: "5",
        showHistoricalOrders: "true",
        historicalInterval: "5",
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Historical interval");
    });

    it("rejects historical interval above 120", async () => {
      const request = createRequest("POST", {
        popupPosition: "bottom-left",
        displayDuration: "5",
        showHistoricalOrders: "true",
        historicalInterval: "150",
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(400);
    });

    it("handles showHistoricalOrders as false when not checked", async () => {
      const request = createRequest("POST", {
        popupPosition: "bottom-left",
        displayDuration: "5",
        showHistoricalOrders: "false",
        historicalInterval: "30",
      });

      const response = await action({ request, params: {}, context: {} });
      const data = await response.json();
      expect(data.success).toBe(true);

      const savedSettings = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(savedSettings.showHistoricalOrders).toBe(false);
    });

    it("returns 404 when shop is not found", async () => {
      mockShopFindUnique.mockResolvedValue(null);
      const request = createRequest("POST", {
        popupPosition: "bottom-left",
        displayDuration: "5",
        showHistoricalOrders: "true",
        historicalInterval: "30",
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(404);
    });
  });
});
