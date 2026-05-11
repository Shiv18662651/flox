import { describe, it, expect, vi } from "vitest";

// Mock the db module before importing the module under test
vi.mock("~/db.server", () => ({
  db: {
    customer: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    referral: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    loyaltyProgram: {
      findUnique: vi.fn(),
    },
    loyaltyTransaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock loyalty.server to avoid its db import
vi.mock("~/utils/loyalty.server", () => ({
  awardPoints: vi.fn(),
}));

import { generateReferralCode, isSelfReferral } from "./referral.server";

describe("generateReferralCode", () => {
  it("generates an 8-character hex string", () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(8);
    expect(/^[0-9a-f]{8}$/.test(code)).toBe(true);
  });

  it("generates unique codes on successive calls", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateReferralCode());
    }
    // With 4 bytes of randomness, collisions in 100 codes are extremely unlikely
    expect(codes.size).toBe(100);
  });
});

describe("isSelfReferral", () => {
  it("returns true when customer uses their own referral code", () => {
    expect(isSelfReferral("abc12345", "abc12345")).toBe(true);
  });

  it("returns false when customer uses a different referral code", () => {
    expect(isSelfReferral("abc12345", "xyz67890")).toBe(false);
  });

  it("returns false when customer has no referral code", () => {
    expect(isSelfReferral(null, "abc12345")).toBe(false);
    expect(isSelfReferral(undefined, "abc12345")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isSelfReferral("ABC12345", "abc12345")).toBe(false);
  });
});
