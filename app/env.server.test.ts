import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getMissingEnvVars, getSecretLengthErrors, REQUIRED_ENV_VARS } from "./env.server";

describe("env.server", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getMissingEnvVars", () => {
    it("returns all required vars when none are set", () => {
      // Clear all required env vars
      for (const varName of REQUIRED_ENV_VARS) {
        delete process.env[varName];
      }

      const missing = getMissingEnvVars();
      expect(missing).toEqual(expect.arrayContaining([...REQUIRED_ENV_VARS]));
      expect(missing.length).toBe(REQUIRED_ENV_VARS.length);
    });

    it("returns empty array when all required vars are set", () => {
      for (const varName of REQUIRED_ENV_VARS) {
        process.env[varName] = "test_value";
      }

      const missing = getMissingEnvVars();
      expect(missing).toEqual([]);
    });

    it("detects whitespace-only values as missing", () => {
      for (const varName of REQUIRED_ENV_VARS) {
        process.env[varName] = "test_value";
      }
      process.env.SHOPIFY_API_KEY = "   ";

      const missing = getMissingEnvVars();
      expect(missing).toContain("SHOPIFY_API_KEY");
      expect(missing.length).toBe(1);
    });

    it("detects empty string values as missing", () => {
      for (const varName of REQUIRED_ENV_VARS) {
        process.env[varName] = "test_value";
      }
      process.env.DATABASE_URL = "";

      const missing = getMissingEnvVars();
      expect(missing).toContain("DATABASE_URL");
    });
  });
});


  describe("getSecretLengthErrors", () => {
    it("returns empty array when secrets meet minimum length", () => {
      process.env.SESSION_SECRET = "a".repeat(32);
      process.env.MEILISEARCH_MASTER_KEY = "b".repeat(16);

      const errors = getSecretLengthErrors();
      expect(errors).toEqual([]);
    });

    it("returns error when SESSION_SECRET is too short", () => {
      process.env.SESSION_SECRET = "short";
      process.env.MEILISEARCH_MASTER_KEY = "b".repeat(16);

      const errors = getSecretLengthErrors();
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("SESSION_SECRET");
      expect(errors[0]).toContain("at least 32 characters");
    });

    it("returns error when MEILISEARCH_MASTER_KEY is too short", () => {
      process.env.SESSION_SECRET = "a".repeat(32);
      process.env.MEILISEARCH_MASTER_KEY = "short";

      const errors = getSecretLengthErrors();
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("MEILISEARCH_MASTER_KEY");
      expect(errors[0]).toContain("at least 16 characters");
    });

    it("returns both errors when both secrets are too short", () => {
      process.env.SESSION_SECRET = "short";
      process.env.MEILISEARCH_MASTER_KEY = "tiny";

      const errors = getSecretLengthErrors();
      expect(errors.length).toBe(2);
    });

    it("does not error when secrets are not set (handled by getMissingEnvVars)", () => {
      delete process.env.SESSION_SECRET;
      delete process.env.MEILISEARCH_MASTER_KEY;

      const errors = getSecretLengthErrors();
      expect(errors).toEqual([]);
    });

    it("accepts exactly 32 characters for SESSION_SECRET", () => {
      process.env.SESSION_SECRET = "a".repeat(32);
      process.env.MEILISEARCH_MASTER_KEY = "b".repeat(16);

      const errors = getSecretLengthErrors();
      expect(errors).toEqual([]);
    });

    it("accepts exactly 16 characters for MEILISEARCH_MASTER_KEY", () => {
      process.env.SESSION_SECRET = "a".repeat(32);
      process.env.MEILISEARCH_MASTER_KEY = "b".repeat(16);

      const errors = getSecretLengthErrors();
      expect(errors).toEqual([]);
    });
  });
