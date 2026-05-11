import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("~/db.server", () => ({
  db: {
    shop: {
      findUnique: vi.fn(),
    },
    upsell: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "~/db.server";
import { loader, action } from "./api.upsells";

function createRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options);
}

describe("GET /api/upsells (loader)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 if shopId is missing", async () => {
    const request = createRequest("http://localhost/api/upsells?type=cart");
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("shopId is required");
  });

  it("returns 400 if type is missing", async () => {
    const request = createRequest("http://localhost/api/upsells?shopId=shop1");
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("type is required");
  });

  it("returns 400 for invalid upsell type", async () => {
    const request = createRequest("http://localhost/api/upsells?shopId=shop1&type=invalid");
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Invalid upsell type");
  });

  it("returns 404 if shop not found", async () => {
    vi.mocked(db.shop.findUnique).mockResolvedValue(null);

    const request = createRequest("http://localhost/api/upsells?shopId=shop1&type=cart");
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Shop not found or inactive");
  });

  it("returns 404 if shop is inactive", async () => {
    vi.mocked(db.shop.findUnique).mockResolvedValue({
      id: "shop1",
      isActive: false,
    } as any);

    const request = createRequest("http://localhost/api/upsells?shopId=shop1&type=cart");
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Shop not found or inactive");
  });

  it("returns active upsell offers for valid request", async () => {
    vi.mocked(db.shop.findUnique).mockResolvedValue({
      id: "shop1",
      isActive: true,
    } as any);

    vi.mocked(db.upsell.findMany).mockResolvedValue([
      {
        id: "upsell1",
        type: "cart",
        productId: "prod1",
        title: "Add matching socks",
        discountPercent: 10,
      },
    ] as any);

    const request = createRequest("http://localhost/api/upsells?shopId=shop1&type=cart");
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.offers).toHaveLength(1);
    expect(data.offers[0].title).toBe("Add matching socks");
    expect(data.offers[0].discountPercent).toBe(10);
  });

  it("filters by productId for product_page type", async () => {
    vi.mocked(db.shop.findUnique).mockResolvedValue({
      id: "shop1",
      isActive: true,
    } as any);

    vi.mocked(db.upsell.findMany).mockResolvedValue([]);

    const request = createRequest(
      "http://localhost/api/upsells?shopId=shop1&type=product_page&productId=prod123"
    );
    await loader({ request, params: {}, context: {} });

    expect(db.upsell.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: "prod123",
        }),
      })
    );
  });

  it("includes CORS headers in response", async () => {
    vi.mocked(db.shop.findUnique).mockResolvedValue({
      id: "shop1",
      isActive: true,
    } as any);
    vi.mocked(db.upsell.findMany).mockResolvedValue([]);

    const request = createRequest("http://localhost/api/upsells?shopId=shop1&type=cart");
    const response = await loader({ request, params: {}, context: {} });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("POST /api/upsells (action)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid JSON body", async () => {
    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid JSON body");
  });

  it("returns 400 if upsellId is missing", async () => {
    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "impression" }),
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("upsellId is required");
  });

  it("returns 400 if action is invalid", async () => {
    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upsellId: "u1", action: "invalid" }),
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("action must be 'impression' or 'conversion'");
  });

  it("returns 404 if upsell not found", async () => {
    vi.mocked(db.upsell.findUnique).mockResolvedValue(null);

    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upsellId: "nonexistent", action: "impression" }),
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Upsell not found");
  });

  it("increments impressions on impression action", async () => {
    vi.mocked(db.upsell.findUnique).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(db.upsell.update).mockResolvedValue({} as any);

    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upsellId: "u1", action: "impression" }),
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(db.upsell.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { impressions: { increment: 1 } },
    });
  });

  it("increments conversions and revenue on conversion action", async () => {
    vi.mocked(db.upsell.findUnique).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(db.upsell.update).mockResolvedValue({} as any);

    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upsellId: "u1", action: "conversion", revenue: 29.99 }),
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(db.upsell.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        conversions: { increment: 1 },
        revenue: { increment: 29.99 },
      },
    });
  });

  it("sets revenue to 0 if not provided on conversion", async () => {
    vi.mocked(db.upsell.findUnique).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(db.upsell.update).mockResolvedValue({} as any);

    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upsellId: "u1", action: "conversion" }),
    });
    await action({ request, params: {}, context: {} });

    expect(db.upsell.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        conversions: { increment: 1 },
        revenue: { increment: 0 },
      },
    });
  });

  it("handles OPTIONS preflight request", async () => {
    const request = createRequest("http://localhost/api/upsells", {
      method: "OPTIONS",
    });
    const response = await action({ request, params: {}, context: {} });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes CORS headers in error responses", async () => {
    const request = createRequest("http://localhost/api/upsells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await action({ request, params: {}, context: {} });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
