import { describe, it, expect, vi } from "vitest";

vi.mock("~/db.server", () => ({
  db: {},
}));

import {
  PLAN_LIMITS,
  RESTRICTED_FEATURES,
  requirePlan,
  isFeatureAvailable,
} from "./plan-limits.server";

describe("plan-limits.server", () => {
  describe("PLAN_LIMITS", () => {
    it("defines correct email limits per tier", () => {
      expect(PLAN_LIMITS.STARTER.emails).toBe(5000);
      expect(PLAN_LIMITS.GROWTH.emails).toBe(25000);
      expect(PLAN_LIMITS.PRO.emails).toBe(100000);
    });

    it("has increasing limits from STARTER to PRO", () => {
      expect(PLAN_LIMITS.STARTER.emails).toBeLessThan(PLAN_LIMITS.GROWTH.emails);
      expect(PLAN_LIMITS.GROWTH.emails).toBeLessThan(PLAN_LIMITS.PRO.emails);
    });
  });

  describe("RESTRICTED_FEATURES", () => {
    it("contains the expected restricted features", () => {
      expect(RESTRICTED_FEATURES).toContain("review_sentiment");
      expect(RESTRICTED_FEATURES).toContain("ab_upsells");
      expect(RESTRICTED_FEATURES).toContain("vip_tiers");
      expect(RESTRICTED_FEATURES).toContain("ltv_report");
      expect(RESTRICTED_FEATURES).toContain("cohort_chart");
      expect(RESTRICTED_FEATURES).toHaveLength(5);
    });
  });

  describe("requirePlan", () => {
    it("allows access when current plan meets minimum", () => {
      expect(requirePlan("STARTER", "STARTER").allowed).toBe(true);
      expect(requirePlan("GROWTH", "GROWTH").allowed).toBe(true);
      expect(requirePlan("PRO", "PRO").allowed).toBe(true);
    });

    it("allows access when current plan exceeds minimum", () => {
      expect(requirePlan("GROWTH", "STARTER").allowed).toBe(true);
      expect(requirePlan("PRO", "STARTER").allowed).toBe(true);
      expect(requirePlan("PRO", "GROWTH").allowed).toBe(true);
    });

    it("denies access when current plan is below minimum", () => {
      expect(requirePlan("STARTER", "GROWTH").allowed).toBe(false);
      expect(requirePlan("STARTER", "PRO").allowed).toBe(false);
      expect(requirePlan("GROWTH", "PRO").allowed).toBe(false);
    });

    it("returns upgrade message when access is denied", () => {
      const result = requirePlan("STARTER", "GROWTH");
      expect(result.allowed).toBe(false);
      expect(result.upgradeMessage).toContain("Growth");
      expect(result.upgradeMessage).toContain("Starter");
      expect(result.requiredPlan).toBe("GROWTH");
      expect(result.currentPlan).toBe("STARTER");
    });

    it("does not include upgrade message when access is allowed", () => {
      const result = requirePlan("PRO", "STARTER");
      expect(result.allowed).toBe(true);
      expect(result.upgradeMessage).toBeUndefined();
    });

    it("returns correct plan references in all denied cases", () => {
      const starterToGrowth = requirePlan("STARTER", "GROWTH");
      expect(starterToGrowth.currentPlan).toBe("STARTER");
      expect(starterToGrowth.requiredPlan).toBe("GROWTH");

      const starterToPro = requirePlan("STARTER", "PRO");
      expect(starterToPro.currentPlan).toBe("STARTER");
      expect(starterToPro.requiredPlan).toBe("PRO");

      const growthToPro = requirePlan("GROWTH", "PRO");
      expect(growthToPro.currentPlan).toBe("GROWTH");
      expect(growthToPro.requiredPlan).toBe("PRO");
    });
  });

  describe("isFeatureAvailable", () => {
    it("denies all restricted features for STARTER plan", () => {
      expect(isFeatureAvailable("STARTER", "review_sentiment")).toBe(false);
      expect(isFeatureAvailable("STARTER", "ab_upsells")).toBe(false);
      expect(isFeatureAvailable("STARTER", "vip_tiers")).toBe(false);
      expect(isFeatureAvailable("STARTER", "ltv_report")).toBe(false);
      expect(isFeatureAvailable("STARTER", "cohort_chart")).toBe(false);
    });

    it("allows all restricted features for GROWTH plan", () => {
      expect(isFeatureAvailable("GROWTH", "review_sentiment")).toBe(true);
      expect(isFeatureAvailable("GROWTH", "ab_upsells")).toBe(true);
      expect(isFeatureAvailable("GROWTH", "vip_tiers")).toBe(true);
      expect(isFeatureAvailable("GROWTH", "ltv_report")).toBe(true);
      expect(isFeatureAvailable("GROWTH", "cohort_chart")).toBe(true);
    });

    it("allows all restricted features for PRO plan", () => {
      expect(isFeatureAvailable("PRO", "review_sentiment")).toBe(true);
      expect(isFeatureAvailable("PRO", "ab_upsells")).toBe(true);
      expect(isFeatureAvailable("PRO", "vip_tiers")).toBe(true);
      expect(isFeatureAvailable("PRO", "ltv_report")).toBe(true);
      expect(isFeatureAvailable("PRO", "cohort_chart")).toBe(true);
    });
  });
});
