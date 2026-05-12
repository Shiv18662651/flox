import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveAllSubscribers,
  resolveSegment,
  resolveManualEmails,
  resolveRecipients,
} from "./recipient-resolver.server";

// Mock the db module
vi.mock("~/db.server", () => ({
  db: {
    customer: {
      findMany: vi.fn(),
    },
  },
}));

// Mock the email parser
vi.mock("~/utils/email-parser.server", () => ({
  parseAndValidateEmails: vi.fn(),
}));

import { db } from "~/db.server";
import { parseAndValidateEmails } from "~/utils/email-parser.server";

const mockFindMany = db.customer.findMany as ReturnType<typeof vi.fn>;
const mockParseEmails = parseAndValidateEmails as ReturnType<typeof vi.fn>;

describe("recipient-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveAllSubscribers", () => {
    it("returns subscribed customers for the shop", async () => {
      mockFindMany.mockResolvedValue([
        { id: "c1", email: "alice@example.com" },
        { id: "c2", email: "bob@example.com" },
      ]);

      const result = await resolveAllSubscribers("shop1");

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { shopId: "shop1", isSubscribed: true },
        select: { id: true, email: true },
      });
      expect(result).toEqual({
        emails: ["alice@example.com", "bob@example.com"],
        count: 2,
        customerIds: ["c1", "c2"],
      });
    });

    it("returns empty result when no subscribers exist", async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await resolveAllSubscribers("shop1");

      expect(result).toEqual({
        emails: [],
        count: 0,
        customerIds: [],
      });
    });
  });

  describe("resolveSegment", () => {
    it("applies loyaltyTier filter with isSubscribed=true", async () => {
      mockFindMany.mockResolvedValue([
        { id: "c1", email: "gold@example.com" },
      ]);

      const result = await resolveSegment("shop1", { loyaltyTier: "gold" });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          shopId: "shop1",
          isSubscribed: true,
          loyaltyTier: "gold",
        },
        select: { id: true, email: true },
      });
      expect(result.count).toBe(1);
      expect(result.emails).toEqual(["gold@example.com"]);
    });

    it("applies minTotalOrders filter", async () => {
      mockFindMany.mockResolvedValue([
        { id: "c1", email: "frequent@example.com" },
      ]);

      const result = await resolveSegment("shop1", { minTotalOrders: 5 });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          shopId: "shop1",
          isSubscribed: true,
          totalOrders: { gte: 5 },
        },
        select: { id: true, email: true },
      });
      expect(result.count).toBe(1);
    });

    it("applies minTotalSpent filter", async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await resolveSegment("shop1", { minTotalSpent: 100 });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          shopId: "shop1",
          isSubscribed: true,
          totalSpent: { gte: 100 },
        },
        select: { id: true, email: true },
      });
      expect(result.count).toBe(0);
    });

    it("combines multiple filters with AND logic", async () => {
      mockFindMany.mockResolvedValue([
        { id: "c1", email: "vip@example.com" },
      ]);

      const result = await resolveSegment("shop1", {
        loyaltyTier: "platinum",
        minTotalOrders: 10,
        minTotalSpent: 500,
      });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          shopId: "shop1",
          isSubscribed: true,
          loyaltyTier: "platinum",
          totalOrders: { gte: 10 },
          totalSpent: { gte: 500 },
        },
        select: { id: true, email: true },
      });
      expect(result.count).toBe(1);
    });

    it("applies only isSubscribed when no filters are set", async () => {
      mockFindMany.mockResolvedValue([
        { id: "c1", email: "a@example.com" },
        { id: "c2", email: "b@example.com" },
      ]);

      const result = await resolveSegment("shop1", {});

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          shopId: "shop1",
          isSubscribed: true,
        },
        select: { id: true, email: true },
      });
      expect(result.count).toBe(2);
    });
  });

  describe("resolveManualEmails", () => {
    it("delegates to parseAndValidateEmails and returns valid emails", () => {
      mockParseEmails.mockReturnValue({
        valid: ["a@test.com", "b@test.com"],
        invalid: ["notanemail"],
        duplicatesRemoved: 1,
      });

      const result = resolveManualEmails(
        "a@test.com, b@test.com, notanemail, A@test.com"
      );

      expect(mockParseEmails).toHaveBeenCalledWith(
        "a@test.com, b@test.com, notanemail, A@test.com"
      );
      expect(result).toEqual({
        emails: ["a@test.com", "b@test.com"],
        count: 2,
        customerIds: [],
      });
    });

    it("returns empty result for empty input", () => {
      mockParseEmails.mockReturnValue({
        valid: [],
        invalid: [],
        duplicatesRemoved: 0,
      });

      const result = resolveManualEmails("");

      expect(result).toEqual({
        emails: [],
        count: 0,
        customerIds: [],
      });
    });
  });

  describe("resolveRecipients", () => {
    it("dispatches to resolveAllSubscribers for all_subscribers mode", async () => {
      mockFindMany.mockResolvedValue([
        { id: "c1", email: "sub@example.com" },
      ]);

      const result = await resolveRecipients(
        "shop1",
        "all_subscribers",
        {},
        ""
      );

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { shopId: "shop1", isSubscribed: true },
        select: { id: true, email: true },
      });
      expect(result.count).toBe(1);
    });

    it("dispatches to resolveSegment for customer_segment mode", async () => {
      mockFindMany.mockResolvedValue([
        { id: "c1", email: "seg@example.com" },
      ]);

      const result = await resolveRecipients(
        "shop1",
        "customer_segment",
        { loyaltyTier: "gold" },
        ""
      );

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { shopId: "shop1", isSubscribed: true, loyaltyTier: "gold" },
        select: { id: true, email: true },
      });
      expect(result.count).toBe(1);
    });

    it("dispatches to resolveManualEmails for manual_entry mode", async () => {
      mockParseEmails.mockReturnValue({
        valid: ["manual@test.com"],
        invalid: [],
        duplicatesRemoved: 0,
      });

      const result = await resolveRecipients(
        "shop1",
        "manual_entry",
        {},
        "manual@test.com"
      );

      expect(mockParseEmails).toHaveBeenCalledWith("manual@test.com");
      expect(result).toEqual({
        emails: ["manual@test.com"],
        count: 1,
        customerIds: [],
      });
    });
  });
});
