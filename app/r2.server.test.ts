import { describe, it, expect, vi } from "vitest";

// Use vi.hoisted to ensure env vars are set before mocked modules load
vi.hoisted(() => {
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_BUCKET_NAME = "test-bucket";
  process.env.R2_PUBLIC_URL = "https://cdn.example.com";
});

// Mock AWS S3 client
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = vi.fn();
  },
  PutObjectCommand: class {},
  DeleteObjectCommand: class {},
  ListObjectsV2Command: class {},
  DeleteObjectsCommand: class {},
}));

import {
  buildR2Key,
  buildCdnUrl,
  validateFileUpload,
  MAX_FILE_SIZE,
  ALLOWED_IMAGE_TYPES,
} from "./r2.server";

describe("r2.server", () => {
  describe("buildR2Key", () => {
    it("builds key in format module/shopId/resourceId/filename", () => {
      expect(buildR2Key("reviews", "shop123", "rev456", "photo.jpg")).toBe(
        "reviews/shop123/rev456/photo.jpg",
      );
    });

    it("handles special characters in filename", () => {
      expect(buildR2Key("reviews", "shop1", "rev1", "my photo (1).png")).toBe(
        "reviews/shop1/rev1/my photo (1).png",
      );
    });

    it("handles empty strings", () => {
      expect(buildR2Key("", "", "", "")).toBe("///");
    });

    it("handles different module names", () => {
      expect(buildR2Key("seo", "shop99", "prod1", "image.webp")).toBe(
        "seo/shop99/prod1/image.webp",
      );
    });
  });

  describe("buildCdnUrl", () => {
    it("prepends R2_PUBLIC_URL to the key", () => {
      expect(buildCdnUrl("reviews/shop123/rev456/photo.jpg")).toBe(
        "https://cdn.example.com/reviews/shop123/rev456/photo.jpg",
      );
    });

    it("works with a simple key", () => {
      expect(buildCdnUrl("file.png")).toBe("https://cdn.example.com/file.png");
    });
  });

  describe("validateFileUpload", () => {
    it("accepts valid JPEG under 10MB", () => {
      expect(validateFileUpload(5 * 1024 * 1024, "image/jpeg")).toEqual({
        valid: true,
      });
    });

    it("accepts valid PNG under 10MB", () => {
      expect(validateFileUpload(1024, "image/png")).toEqual({ valid: true });
    });

    it("accepts valid WebP under 10MB", () => {
      expect(validateFileUpload(2 * 1024 * 1024, "image/webp")).toEqual({
        valid: true,
      });
    });

    it("accepts valid GIF under 10MB", () => {
      expect(validateFileUpload(3 * 1024 * 1024, "image/gif")).toEqual({
        valid: true,
      });
    });

    it("rejects files over 10MB", () => {
      const result = validateFileUpload(11 * 1024 * 1024, "image/jpeg");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("10 MB");
    });

    it("rejects exactly at boundary (10MB + 1 byte)", () => {
      const result = validateFileUpload(MAX_FILE_SIZE + 1, "image/jpeg");
      expect(result.valid).toBe(false);
    });

    it("accepts exactly at 10MB", () => {
      expect(validateFileUpload(MAX_FILE_SIZE, "image/jpeg")).toEqual({
        valid: true,
      });
    });

    it("rejects invalid MIME types", () => {
      const result = validateFileUpload(1024, "application/pdf");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not allowed");
    });

    it("rejects video MIME types", () => {
      const result = validateFileUpload(1024, "video/mp4");
      expect(result.valid).toBe(false);
    });
  });

  describe("constants", () => {
    it("MAX_FILE_SIZE is 10MB", () => {
      expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    });

    it("ALLOWED_IMAGE_TYPES contains exactly 4 types", () => {
      expect(ALLOWED_IMAGE_TYPES).toHaveLength(4);
      expect(ALLOWED_IMAGE_TYPES).toContain("image/jpeg");
      expect(ALLOWED_IMAGE_TYPES).toContain("image/png");
      expect(ALLOWED_IMAGE_TYPES).toContain("image/webp");
      expect(ALLOWED_IMAGE_TYPES).toContain("image/gif");
    });
  });
});
