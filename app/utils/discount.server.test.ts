import { describe, it, expect, vi } from "vitest";
import {
  createDiscountCode,
  generateDiscountSuffix,
} from "./discount.server";

describe("discount.server", () => {
  describe("generateDiscountSuffix", () => {
    it("returns an uppercase hex string", () => {
      const suffix = generateDiscountSuffix();
      expect(suffix).toMatch(/^[0-9A-F]+$/);
    });

    it("returns 8 characters for the default 4 bytes", () => {
      const suffix = generateDiscountSuffix();
      expect(suffix).toHaveLength(8);
    });

    it("returns 12 characters when called with 6 bytes", () => {
      const suffix = generateDiscountSuffix(6);
      expect(suffix).toHaveLength(12);
    });

    it("produces different values across calls", () => {
      const a = generateDiscountSuffix();
      const b = generateDiscountSuffix();
      const c = generateDiscountSuffix();
      // Extremely unlikely all three match
      expect(new Set([a, b, c]).size).toBeGreaterThan(1);
    });
  });

  describe("createDiscountCode", () => {
    it("creates a fixed-amount discount successfully", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                discountCodeBasicCreate: {
                  codeDiscountNode: {
                    id: "gid://shopify/DiscountCodeNode/1",
                    codeDiscount: {
                      title: "Loyalty reward",
                      codes: { nodes: [{ code: "LOYALTY-ABC123" }] },
                      status: "ACTIVE",
                    },
                  },
                  userErrors: [],
                },
              },
            }),
        }),
      };

      const result = await createDiscountCode(mockAdmin, {
        code: "LOYALTY-ABC123",
        title: "Loyalty reward",
        valueType: "fixed_amount",
        value: 10,
      });

      expect(result.success).toBe(true);
      expect(result.code).toBe("LOYALTY-ABC123");
      expect(result.discountId).toBe("gid://shopify/DiscountCodeNode/1");
      expect(result.error).toBeUndefined();
      expect(mockAdmin.graphql).toHaveBeenCalledOnce();
    });

    it("creates a percentage discount successfully", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                discountCodeBasicCreate: {
                  codeDiscountNode: {
                    id: "gid://shopify/DiscountCodeNode/2",
                    codeDiscount: {
                      title: "Referral friend discount",
                      codes: { nodes: [{ code: "REF-FRIEND15" }] },
                      status: "ACTIVE",
                    },
                  },
                  userErrors: [],
                },
              },
            }),
        }),
      };

      const result = await createDiscountCode(mockAdmin, {
        code: "REF-FRIEND15",
        title: "Referral friend discount",
        valueType: "percentage",
        value: 0.15,
      });

      expect(result.success).toBe(true);
      expect(result.discountId).toBe("gid://shopify/DiscountCodeNode/2");
    });

    it("returns failure when Shopify reports userErrors", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                discountCodeBasicCreate: {
                  codeDiscountNode: null,
                  userErrors: [
                    { field: "code", message: "Discount code already exists" },
                  ],
                },
              },
            }),
        }),
      };

      const result = await createDiscountCode(mockAdmin, {
        code: "DUPLICATE",
        title: "Dup",
        valueType: "fixed_amount",
        value: 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
      expect(result.discountId).toBeUndefined();
    });

    it("returns failure when no discount ID is returned", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                discountCodeBasicCreate: {
                  codeDiscountNode: null,
                  userErrors: [],
                },
              },
            }),
        }),
      };

      const result = await createDiscountCode(mockAdmin, {
        code: "X",
        title: "X",
        valueType: "fixed_amount",
        value: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("did not return");
    });

    it("returns failure when the GraphQL call throws", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockRejectedValue(new Error("Network error")),
      };

      const result = await createDiscountCode(mockAdmin, {
        code: "X",
        title: "X",
        valueType: "fixed_amount",
        value: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network");
    });
  });
});
