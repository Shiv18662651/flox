import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculatePointsEarned, awardPoints, redeemPoints, getCustomerBalance, assignTier } from "./loyalty.server";

// Mock the db module
vi.mock("~/db.server", () => {
  const mockDb = {
    loyaltyTransaction: {
      create: vi.fn(),
    },
    customer: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { db: mockDb };
});

import { db } from "~/db.server";

const mockDb = db as unknown as {
  loyaltyTransaction: { create: ReturnType<typeof vi.fn> };
  customer: { update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("calculatePointsEarned", () => {
  it("returns floor of subtotal * pointsPerDollar", () => {
    expect(calculatePointsEarned(100, 1)).toBe(100);
    expect(calculatePointsEarned(49.99, 2)).toBe(99);
    expect(calculatePointsEarned(33.33, 3)).toBe(99);
  });

  it("returns 0 for zero subtotal", () => {
    expect(calculatePointsEarned(0, 10)).toBe(0);
  });

  it("returns 0 for zero pointsPerDollar", () => {
    expect(calculatePointsEarned(100, 0)).toBe(0);
  });

  it("handles fractional amounts correctly without floating-point drift", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS, but floor should handle it
    expect(calculatePointsEarned(0.3, 10)).toBe(3);
    expect(calculatePointsEarned(19.99, 1)).toBe(19);
    expect(calculatePointsEarned(99.99, 1)).toBe(99);
  });

  it("handles large subtotals", () => {
    expect(calculatePointsEarned(10000, 5)).toBe(50000);
    expect(calculatePointsEarned(999.99, 10)).toBe(9999);
  });
});

describe("awardPoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a transaction and updates customer balance", async () => {
    const mockTransaction = { id: "tx-1" };
    const mockCustomer = { loyaltyPoints: 150 };

    mockDb.$transaction.mockResolvedValue([mockTransaction, mockCustomer]);

    const result = await awardPoints("cust-1", "shop-1", "prog-1", 50, "Order purchase");

    expect(result).toEqual({
      transactionId: "tx-1",
      newBalance: 150,
    });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it("throws error for non-positive points", async () => {
    await expect(awardPoints("cust-1", "shop-1", "prog-1", 0, "test")).rejects.toThrow(
      "Points to award must be positive"
    );
    await expect(awardPoints("cust-1", "shop-1", "prog-1", -5, "test")).rejects.toThrow(
      "Points to award must be positive"
    );
  });
});

describe("redeemPoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects redemption for non-positive points", async () => {
    const result = await redeemPoints("cust-1", "shop-1", "prog-1", 0);
    expect(result).toEqual({ success: false, error: "Points to redeem must be positive" });
  });

  it("rejects redemption when customer not found", async () => {
    mockDb.customer.findUnique.mockResolvedValue(null);

    const result = await redeemPoints("cust-1", "shop-1", "prog-1", 50);
    expect(result).toEqual({ success: false, error: "Customer not found" });
  });

  it("rejects redemption when balance is insufficient", async () => {
    mockDb.customer.findUnique.mockResolvedValue({ loyaltyPoints: 30 });

    const result = await redeemPoints("cust-1", "shop-1", "prog-1", 50);
    expect(result).toEqual({
      success: false,
      error: "Insufficient balance. Current balance: 30, requested: 50",
    });
  });

  it("succeeds when balance is sufficient", async () => {
    mockDb.customer.findUnique.mockResolvedValue({ loyaltyPoints: 100 });

    const mockTransaction = { id: "tx-redeem-1" };
    const mockCustomer = { loyaltyPoints: 50 };
    mockDb.$transaction.mockResolvedValue([mockTransaction, mockCustomer]);

    const result = await redeemPoints("cust-1", "shop-1", "prog-1", 50);
    expect(result).toEqual({
      success: true,
      transactionId: "tx-redeem-1",
      newBalance: 50,
    });
  });

  it("succeeds when redeeming exact balance", async () => {
    mockDb.customer.findUnique.mockResolvedValue({ loyaltyPoints: 100 });

    const mockTransaction = { id: "tx-redeem-2" };
    const mockCustomer = { loyaltyPoints: 0 };
    mockDb.$transaction.mockResolvedValue([mockTransaction, mockCustomer]);

    const result = await redeemPoints("cust-1", "shop-1", "prog-1", 100);
    expect(result).toEqual({
      success: true,
      transactionId: "tx-redeem-2",
      newBalance: 0,
    });
  });
});

describe("getCustomerBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when customer not found", async () => {
    mockDb.customer.findUnique.mockResolvedValue(null);
    const result = await getCustomerBalance("nonexistent");
    expect(result).toBeNull();
  });

  it("returns points and tier", async () => {
    mockDb.customer.findUnique.mockResolvedValue({
      loyaltyPoints: 500,
      loyaltyTier: "Gold",
    });

    const result = await getCustomerBalance("cust-1");
    expect(result).toEqual({ points: 500, tier: "Gold" });
  });
});

describe("assignTier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.customer.update.mockResolvedValue({});
  });

  it("returns null when no tiers configured", async () => {
    const result = await assignTier("cust-1", null, 1000);
    expect(result).toBeNull();
  });

  it("returns null when tiers array is empty", async () => {
    const result = await assignTier("cust-1", [], 1000);
    expect(result).toBeNull();
  });

  it("assigns the highest qualifying tier", async () => {
    const tiers = [
      { name: "Silver", minPoints: 100 },
      { name: "Gold", minPoints: 500 },
      { name: "Platinum", minPoints: 2000 },
    ];

    const result = await assignTier("cust-1", tiers, 1000);
    expect(result).toBe("Gold");
    expect(mockDb.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { loyaltyTier: "Gold" },
    });
  });

  it("assigns the top tier when points exceed all thresholds", async () => {
    const tiers = [
      { name: "Silver", minPoints: 100 },
      { name: "Gold", minPoints: 500 },
      { name: "Platinum", minPoints: 2000 },
    ];

    const result = await assignTier("cust-1", tiers, 5000);
    expect(result).toBe("Platinum");
  });

  it("assigns null when points are below all tiers", async () => {
    const tiers = [
      { name: "Silver", minPoints: 100 },
      { name: "Gold", minPoints: 500 },
    ];

    const result = await assignTier("cust-1", tiers, 50);
    expect(result).toBeNull();
    expect(mockDb.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { loyaltyTier: null },
    });
  });
});
