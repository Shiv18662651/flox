import { describe, it, expect, vi } from "vitest";
import {
  PLAN_CONFIGS,
  isPlanUpgrade,
  isPlanDowngrade,
  createSubscription,
  cancelSubscription,
  getActiveSubscription,
} from "./billing.server";

describe("billing.server", () => {
  describe("PLAN_CONFIGS", () => {
    it("defines three plans with correct prices", () => {
      expect(PLAN_CONFIGS.STARTER.price).toBe(29);
      expect(PLAN_CONFIGS.GROWTH.price).toBe(79);
      expect(PLAN_CONFIGS.PRO.price).toBe(149);
    });

    it("defines correct email limits per plan", () => {
      expect(PLAN_CONFIGS.STARTER.features.emails).toBe(5000);
      expect(PLAN_CONFIGS.GROWTH.features.emails).toBe(25000);
      expect(PLAN_CONFIGS.PRO.features.emails).toBe(100000);
    });

    it("restricts advanced features to GROWTH and PRO", () => {
      expect(PLAN_CONFIGS.STARTER.features.vipTiers).toBe(false);
      expect(PLAN_CONFIGS.STARTER.features.abUpsells).toBe(false);
      expect(PLAN_CONFIGS.STARTER.features.ltvReport).toBe(false);
      expect(PLAN_CONFIGS.STARTER.features.reviewSentiment).toBe(false);

      expect(PLAN_CONFIGS.GROWTH.features.vipTiers).toBe(true);
      expect(PLAN_CONFIGS.GROWTH.features.abUpsells).toBe(true);
      expect(PLAN_CONFIGS.GROWTH.features.ltvReport).toBe(true);
      expect(PLAN_CONFIGS.GROWTH.features.reviewSentiment).toBe(true);

      expect(PLAN_CONFIGS.PRO.features.vipTiers).toBe(true);
      expect(PLAN_CONFIGS.PRO.features.abUpsells).toBe(true);
    });
  });

  describe("isPlanUpgrade", () => {
    it("returns true when moving to a higher tier", () => {
      expect(isPlanUpgrade("STARTER", "GROWTH")).toBe(true);
      expect(isPlanUpgrade("STARTER", "PRO")).toBe(true);
      expect(isPlanUpgrade("GROWTH", "PRO")).toBe(true);
    });

    it("returns false when moving to same or lower tier", () => {
      expect(isPlanUpgrade("STARTER", "STARTER")).toBe(false);
      expect(isPlanUpgrade("GROWTH", "STARTER")).toBe(false);
      expect(isPlanUpgrade("PRO", "GROWTH")).toBe(false);
      expect(isPlanUpgrade("PRO", "STARTER")).toBe(false);
    });
  });

  describe("isPlanDowngrade", () => {
    it("returns true when moving to a lower tier", () => {
      expect(isPlanDowngrade("GROWTH", "STARTER")).toBe(true);
      expect(isPlanDowngrade("PRO", "STARTER")).toBe(true);
      expect(isPlanDowngrade("PRO", "GROWTH")).toBe(true);
    });

    it("returns false when moving to same or higher tier", () => {
      expect(isPlanDowngrade("STARTER", "STARTER")).toBe(false);
      expect(isPlanDowngrade("STARTER", "GROWTH")).toBe(false);
      expect(isPlanDowngrade("GROWTH", "PRO")).toBe(false);
    });
  });

  describe("createSubscription", () => {
    it("calls graphql with correct mutation and returns confirmation URL", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                appSubscriptionCreate: {
                  appSubscription: { id: "gid://shopify/AppSubscription/123" },
                  confirmationUrl: "https://shopify.com/confirm/123",
                  userErrors: [],
                },
              },
            }),
        }),
      };

      const result = await createSubscription(
        mockAdmin,
        "GROWTH",
        "test-shop.myshopify.com",
        "https://test-shop.myshopify.com/admin/apps/test/app/billing"
      );

      expect(result.confirmationUrl).toBe("https://shopify.com/confirm/123");
      expect(result.subscriptionId).toBe(
        "gid://shopify/AppSubscription/123"
      );
      expect(mockAdmin.graphql).toHaveBeenCalledOnce();
    });

    it("throws on user errors from Shopify", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                appSubscriptionCreate: {
                  appSubscription: null,
                  confirmationUrl: null,
                  userErrors: [
                    { field: "lineItems", message: "Invalid price" },
                  ],
                },
              },
            }),
        }),
      };

      await expect(
        createSubscription(
          mockAdmin,
          "GROWTH",
          "test-shop.myshopify.com",
          "https://test-shop.myshopify.com/admin/apps/test/app/billing"
        )
      ).rejects.toThrow("Failed to create subscription: Invalid price");
    });

    it("throws when no confirmation URL is returned", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                appSubscriptionCreate: {
                  appSubscription: null,
                  confirmationUrl: null,
                  userErrors: [],
                },
              },
            }),
        }),
      };

      await expect(
        createSubscription(
          mockAdmin,
          "GROWTH",
          "test-shop.myshopify.com",
          "https://test-shop.myshopify.com/admin/apps/test/app/billing"
        )
      ).rejects.toThrow("no confirmation URL returned");
    });
  });

  describe("cancelSubscription", () => {
    it("calls graphql with correct mutation", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                appSubscriptionCancel: {
                  appSubscription: {
                    id: "gid://shopify/AppSubscription/123",
                    status: "CANCELLED",
                  },
                  userErrors: [],
                },
              },
            }),
        }),
      };

      await cancelSubscription(
        mockAdmin,
        "gid://shopify/AppSubscription/123"
      );

      expect(mockAdmin.graphql).toHaveBeenCalledOnce();
    });

    it("throws on user errors from Shopify", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                appSubscriptionCancel: {
                  appSubscription: null,
                  userErrors: [
                    { field: "id", message: "Subscription not found" },
                  ],
                },
              },
            }),
        }),
      };

      await expect(
        cancelSubscription(mockAdmin, "gid://shopify/AppSubscription/999")
      ).rejects.toThrow(
        "Failed to cancel subscription: Subscription not found"
      );
    });
  });

  describe("getActiveSubscription", () => {
    it("returns the active subscription when one exists", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                currentAppInstallation: {
                  activeSubscriptions: [
                    {
                      id: "gid://shopify/AppSubscription/456",
                      name: "Nexify Growth Plan",
                      status: "ACTIVE",
                      lineItems: [
                        {
                          plan: {
                            pricingDetails: {
                              price: { amount: "79.0", currencyCode: "USD" },
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            }),
        }),
      };

      const result = await getActiveSubscription(mockAdmin);

      expect(result).toEqual({
        id: "gid://shopify/AppSubscription/456",
        name: "Nexify Growth Plan",
        status: "ACTIVE",
      });
    });

    it("returns null when no active subscription exists", async () => {
      const mockAdmin = {
        graphql: vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({
              data: {
                currentAppInstallation: {
                  activeSubscriptions: [],
                },
              },
            }),
        }),
      };

      const result = await getActiveSubscription(mockAdmin);
      expect(result).toBeNull();
    });
  });
});
