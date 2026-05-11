import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
const mockWebhookEventFindMany = vi.fn();

vi.mock("~/db.server", () => ({
  db: {
    webhookEvent: {
      findMany: (...args: unknown[]) => mockWebhookEventFindMany(...args),
    },
  },
}));

// Mock redis
const mockRedisGet = vi.fn();

vi.mock("~/redis.server", () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
  },
}));

import { loader } from "./api.fomo";

function createRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/fomo");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString(), { method: "GET" });
}

describe("api.fomo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return null (use default settings with showHistoricalOrders: true)
    mockRedisGet.mockResolvedValue(null);
  });

  it("returns 400 when shopId is missing", async () => {
    const request = createRequest({});
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("shopId is required");
  });

  it("returns empty events when no recent orders exist", async () => {
    mockWebhookEventFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.events).toEqual([]);
    expect(data.settings).toBeDefined();
  });

  it("returns formatted FOMO events from recent orders", async () => {
    const now = new Date("2024-06-15T12:00:00Z");
    mockWebhookEventFindMany.mockResolvedValue([
      {
        payload: {
          customer: { first_name: "Alice" },
          line_items: [
            { title: "Cool Sneakers", product_id: 12345 },
          ],
        },
        createdAt: now,
      },
      {
        payload: {
          customer: { first_name: "Bob" },
          line_items: [
            { title: "Vintage T-Shirt", product_id: 67890 },
          ],
        },
        createdAt: new Date("2024-06-15T11:30:00Z"),
      },
    ]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.events).toHaveLength(2);
    expect(data.events[0]).toEqual({
      buyerName: "Alice",
      productTitle: "Cool Sneakers",
      productId: "12345",
      timestamp: now.toISOString(),
    });
    expect(data.events[1]).toEqual({
      buyerName: "Bob",
      productTitle: "Vintage T-Shirt",
      productId: "67890",
      timestamp: "2024-06-15T11:30:00.000Z",
    });
  });

  it("returns settings in the response", async () => {
    mockWebhookEventFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(data.settings).toEqual({
      popupPosition: "bottom-left",
      displayDuration: 5,
      showHistoricalOrders: true,
      historicalInterval: 30,
    });
  });

  it("returns custom settings from Redis", async () => {
    mockRedisGet.mockResolvedValue(
      JSON.stringify({
        popupPosition: "bottom-right",
        displayDuration: 8,
        showHistoricalOrders: true,
        historicalInterval: 45,
      }),
    );
    mockWebhookEventFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(data.settings.popupPosition).toBe("bottom-right");
    expect(data.settings.displayDuration).toBe(8);
    expect(data.settings.historicalInterval).toBe(45);
  });

  it("returns empty events when showHistoricalOrders is disabled", async () => {
    mockRedisGet.mockResolvedValue(
      JSON.stringify({
        popupPosition: "bottom-left",
        displayDuration: 5,
        showHistoricalOrders: false,
        historicalInterval: 30,
      }),
    );

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(data.events).toEqual([]);
    // Should NOT have called the database
    expect(mockWebhookEventFindMany).not.toHaveBeenCalled();
  });

  it("uses 'Someone' when customer first_name is missing", async () => {
    mockWebhookEventFindMany.mockResolvedValue([
      {
        payload: {
          customer: {},
          line_items: [{ title: "Widget", product_id: 111 }],
        },
        createdAt: new Date("2024-06-15T10:00:00Z"),
      },
    ]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();
    expect(data.events[0].buyerName).toBe("Someone");
  });

  it("uses 'Someone' when customer is null", async () => {
    mockWebhookEventFindMany.mockResolvedValue([
      {
        payload: {
          customer: null,
          line_items: [{ title: "Gadget", product_id: 222 }],
        },
        createdAt: new Date("2024-06-15T10:00:00Z"),
      },
    ]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();
    expect(data.events[0].buyerName).toBe("Someone");
  });

  it("uses 'an item' when line_items is empty", async () => {
    mockWebhookEventFindMany.mockResolvedValue([
      {
        payload: {
          customer: { first_name: "Charlie" },
          line_items: [],
        },
        createdAt: new Date("2024-06-15T10:00:00Z"),
      },
    ]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();
    expect(data.events[0].productTitle).toBe("an item");
    expect(data.events[0].productId).toBeNull();
  });

  it("uses 'an item' when line_items is missing from payload", async () => {
    mockWebhookEventFindMany.mockResolvedValue([
      {
        payload: {
          customer: { first_name: "Dave" },
        },
        createdAt: new Date("2024-06-15T10:00:00Z"),
      },
    ]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();
    expect(data.events[0].productTitle).toBe("an item");
    expect(data.events[0].productId).toBeNull();
  });

  it("filters events by productId when provided", async () => {
    mockWebhookEventFindMany.mockResolvedValue([
      {
        payload: {
          customer: { first_name: "Alice" },
          line_items: [{ title: "Sneakers", product_id: 100 }],
        },
        createdAt: new Date("2024-06-15T12:00:00Z"),
      },
      {
        payload: {
          customer: { first_name: "Bob" },
          line_items: [{ title: "T-Shirt", product_id: 200 }],
        },
        createdAt: new Date("2024-06-15T11:00:00Z"),
      },
      {
        payload: {
          customer: { first_name: "Charlie" },
          line_items: [{ title: "Sneakers Pro", product_id: 100 }],
        },
        createdAt: new Date("2024-06-15T10:00:00Z"),
      },
    ]);

    const request = createRequest({ shopId: "shop1", productId: "100" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(data.events).toHaveLength(2);
    expect(data.events[0].buyerName).toBe("Alice");
    expect(data.events[1].buyerName).toBe("Charlie");
  });

  it("returns all events when productId is not provided", async () => {
    mockWebhookEventFindMany.mockResolvedValue([
      {
        payload: {
          customer: { first_name: "Alice" },
          line_items: [{ title: "Sneakers", product_id: 100 }],
        },
        createdAt: new Date("2024-06-15T12:00:00Z"),
      },
      {
        payload: {
          customer: { first_name: "Bob" },
          line_items: [{ title: "T-Shirt", product_id: 200 }],
        },
        createdAt: new Date("2024-06-15T11:00:00Z"),
      },
    ]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(data.events).toHaveLength(2);
  });

  it("queries only processed ORDERS_CREATE events from past 48 hours", async () => {
    mockWebhookEventFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1" });
    await loader({ request, params: {}, context: {} });

    expect(mockWebhookEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: "shop1",
          topic: "ORDERS_CREATE",
          status: "processed",
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
          }),
        }),
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    );

    // Verify the date is approximately 48 hours ago
    const callArgs = mockWebhookEventFindMany.mock.calls[0][0];
    const sinceDate = callArgs.where.createdAt.gte as Date;
    const hoursDiff = (Date.now() - sinceDate.getTime()) / (1000 * 60 * 60);
    expect(hoursDiff).toBeCloseTo(48, 0);
  });

  it("sets CORS and cache headers on response", async () => {
    mockWebhookEventFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
  });

  it("limits results to 10 events maximum", async () => {
    mockWebhookEventFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1" });
    await loader({ request, params: {}, context: {} });

    expect(mockWebhookEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      }),
    );
  });
});
