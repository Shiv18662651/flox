import { describe, it, expect, vi } from "vitest";

vi.mock("~/db.server", () => ({
  db: {
    emailSend: {
      count: vi.fn(),
    },
  },
}));

import { db } from "~/db.server";
import { checkCampaignQuota } from "./campaign-quota.server";

describe("campaign-quota.server", () => {
  describe("checkCampaignQuota", () => {
    it("allows sending when recipient count is within remaining quota", async () => {
      // STARTER plan: 5000 limit, 1000 used → 4000 remaining
      vi.mocked(db.emailSend.count).mockResolvedValue(1000);

      const result = await checkCampaignQuota("shop-1", "STARTER", 500);

      expect(result.allowed).toBe(true);
      expect(result.exceeded).toBe(false);
      expect(result.remaining).toBe(4000);
    });

    it("allows sending when recipient count equals remaining quota", async () => {
      // STARTER plan: 5000 limit, 3000 used → 2000 remaining
      vi.mocked(db.emailSend.count).mockResolvedValue(3000);

      const result = await checkCampaignQuota("shop-1", "STARTER", 2000);

      expect(result.allowed).toBe(true);
      expect(result.exceeded).toBe(false);
      expect(result.remaining).toBe(2000);
    });

    it("rejects sending when recipient count exceeds remaining quota", async () => {
      // STARTER plan: 5000 limit, 4500 used → 500 remaining
      vi.mocked(db.emailSend.count).mockResolvedValue(4500);

      const result = await checkCampaignQuota("shop-1", "STARTER", 600);

      expect(result.allowed).toBe(false);
      expect(result.exceeded).toBe(true);
      expect(result.remaining).toBe(500);
    });

    it("rejects sending when quota is fully used", async () => {
      // GROWTH plan: 25000 limit, 25000 used → 0 remaining
      vi.mocked(db.emailSend.count).mockResolvedValue(25000);

      const result = await checkCampaignQuota("shop-2", "GROWTH", 1);

      expect(result.allowed).toBe(false);
      expect(result.exceeded).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it("allows sending with zero used quota", async () => {
      // PRO plan: 100000 limit, 0 used → 100000 remaining
      vi.mocked(db.emailSend.count).mockResolvedValue(0);

      const result = await checkCampaignQuota("shop-3", "PRO", 5000);

      expect(result.allowed).toBe(true);
      expect(result.exceeded).toBe(false);
      expect(result.remaining).toBe(100000);
    });

    it("returns correct remaining for each plan tier", async () => {
      vi.mocked(db.emailSend.count).mockResolvedValue(1000);

      const starter = await checkCampaignQuota("shop-1", "STARTER", 1);
      expect(starter.remaining).toBe(4000); // 5000 - 1000

      const growth = await checkCampaignQuota("shop-1", "GROWTH", 1);
      expect(growth.remaining).toBe(24000); // 25000 - 1000

      const pro = await checkCampaignQuota("shop-1", "PRO", 1);
      expect(pro.remaining).toBe(99000); // 100000 - 1000
    });
  });
});
