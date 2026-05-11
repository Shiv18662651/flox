import { describe, it, expect, vi, beforeEach } from "vitest";
import { action } from "./api.loyalty.redeem";

// Mock db
vi.mock("~/db.server", () => {
  const mockDb = {
    loyaltyProgram: {
      findUnique: vi.fn(),
    },
    loyaltyTransaction: {
      create: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    shop: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { db: mockDb };
});

import { db } from "~/db.server";

const mockDb = db as unknown as {
  loyaltyProgram: { findUnique: ReturnType<typeof vi.fn> };
  loyaltyTransaction: { create: ReturnType<typeof vi.fn> };
  customer: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  shop: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function createRequest(body: unknown, method = "POST") {
  return new Request("http://localhost/api/loyalty/redeem", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/loyalty/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for missing fields", async () => {
    const response = await action({
      request: createRequest({ customerId: "c1" }),
      params: {},
      context: {},
    });
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain("Missing required fields");
  });

  it("returns 400 for non-positive points", async () => {
    const response = await action({
      request: createRequest({ customerId: "c1", shopId: "s1", points: 0 }),
      params: {},
      context: {},
    });
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain("positive integer");
  });

  it("returns 404 when loyalty program not found", async () => {
    mockDb.loyaltyProgram.findUnique.mockResolvedValue(null);

    const response = await action({
      request: createRequest({ customerId: "c1", shopId: "s1", points: 50 }),
      params: {},
      context: {},
    });
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data.error).toContain("not found or inactive");
  });

  it("returns 400 when balance is insufficient", async () => {
    mockDb.loyaltyProgram.findUnique.mockResolvedValue({
      id: "prog-1",
      isActive: true,
      rewardValue: 0.01,
    });
    mockDb.customer.findUnique.mockResolvedValue({ loyaltyPoints: 30 });

    const response = await action({
      request: createRequest({ customerId: "c1", shopId: "s1", points: 50 }),
      params: {},
      context: {},
    });
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain("Insufficient balance");
  });

  it("returns success with discount code when balance is sufficient", async () => {
    mockDb.loyaltyProgram.findUnique.mockResolvedValue({
      id: "prog-1",
      isActive: true,
      rewardValue: 0.01,
    });
    mockDb.customer.findUnique.mockResolvedValue({ loyaltyPoints: 100 });
    mockDb.$transaction.mockResolvedValue([
      { id: "tx-1" },
      { loyaltyPoints: 50 },
    ]);
    // No shop credentials → Shopify discount API skipped, placeholder used
    mockDb.shop.findUnique.mockResolvedValue(null);

    const response = await action({
      request: createRequest({ customerId: "c1", shopId: "s1", points: 50 }),
      params: {},
      context: {},
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.discountCode).toMatch(/^LOYALTY-/);
    expect(data.discountValue).toBe(0.5); // 50 * 0.01
    expect(data.pointsRedeemed).toBe(50);
    expect(data.newBalance).toBe(50);
  });
});
