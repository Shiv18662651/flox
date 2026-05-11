import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mocks available during vi.mock hoisting
const {
  mockReviewRequestFindUnique,
  mockReviewRequestUpdate,
  mockReviewCreate,
  mockReviewUpdate,
  mockUploadFile,
  mockValidateFileUpload,
  mockBuildR2Key,
} = vi.hoisted(() => ({
  mockReviewRequestFindUnique: vi.fn(),
  mockReviewRequestUpdate: vi.fn(),
  mockReviewCreate: vi.fn(),
  mockReviewUpdate: vi.fn(),
  mockUploadFile: vi.fn(),
  mockValidateFileUpload: vi.fn(),
  mockBuildR2Key: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  db: {
    reviewRequest: {
      findUnique: mockReviewRequestFindUnique,
      update: mockReviewRequestUpdate,
    },
    review: {
      create: mockReviewCreate,
      update: mockReviewUpdate,
    },
  },
}));

vi.mock("~/r2.server", () => ({
  uploadFile: mockUploadFile,
  validateFileUpload: mockValidateFileUpload,
  buildR2Key: mockBuildR2Key,
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp", "image/gif"],
}));

import { action } from "./api.reviews";

function createRequest(
  method: string,
  token: string | null,
  formFields?: Record<string, string | File | File[]>,
): Request {
  const url = token
    ? `http://localhost/api/reviews?token=${token}`
    : "http://localhost/api/reviews";

  const formData = new FormData();
  if (formFields) {
    for (const [key, value] of Object.entries(formFields)) {
      if (Array.isArray(value)) {
        for (const file of value) {
          formData.append(key, file);
        }
      } else {
        formData.append(key, value);
      }
    }
  }

  return new Request(url, {
    method,
    body: formData,
  });
}

function createMockFile(
  name: string,
  size: number,
  type: string,
): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

describe("api.reviews action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReviewCreate.mockResolvedValue({
      id: "review-1",
      shopId: "shop-1",
      rating: 5,
    });
    mockReviewUpdate.mockResolvedValue({});
    mockReviewRequestUpdate.mockResolvedValue({});
    mockBuildR2Key.mockImplementation(
      (module: string, shopId: string, resourceId: string, filename: string) =>
        `${module}/${shopId}/${resourceId}/${filename}`,
    );
    mockUploadFile.mockResolvedValue(
      "https://cdn.example.com/reviews/shop-1/review-1/photo.jpg",
    );
    mockValidateFileUpload.mockReturnValue({ valid: true });
  });

  it("returns 405 for non-POST methods", async () => {
    const request = new Request("http://localhost/api/reviews?token=abc", {
      method: "PUT",
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(405);
    expect(data.error).toBe("Method not allowed");
  });

  it("returns 400 when token is missing", async () => {
    const request = new Request("http://localhost/api/reviews", {
      method: "POST",
      body: new FormData(),
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing review token");
  });

  it("returns 403 for invalid token", async () => {
    mockReviewRequestFindUnique.mockResolvedValue(null);

    const request = createRequest("POST", "invalid-token", { rating: "5" });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Invalid review token");
  });

  it("returns 400 for already-reviewed token", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "used-token",
      status: "reviewed",
    });

    const request = createRequest("POST", "used-token", { rating: "5" });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("This review has already been submitted");
  });

  it("returns 400 for invalid rating (0)", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const request = createRequest("POST", "valid-token", { rating: "0" });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Rating must be between 1 and 5");
  });

  it("returns 400 for invalid rating (6)", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const request = createRequest("POST", "valid-token", { rating: "6" });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Rating must be between 1 and 5");
  });

  it("returns 400 for non-numeric rating", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const request = createRequest("POST", "valid-token", { rating: "abc" });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Rating must be between 1 and 5");
  });

  it("creates review with valid token and rating", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const request = createRequest("POST", "valid-token", {
      rating: "4",
      title: "Great product",
      body: "Really enjoyed it",
      productId: "prod-123",
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.reviewId).toBe("review-1");
    expect(data.message).toBe(
      "Thank you for your review! It will be visible after approval.",
    );

    // Verify review was created with correct data
    expect(mockReviewCreate).toHaveBeenCalledWith({
      data: {
        shopId: "shop-1",
        shopifyProductId: "prod-123",
        productTitle: "",
        rating: 4,
        title: "Great product",
        body: "Really enjoyed it",
        photos: [],
        videos: [],
        verifiedPurchase: true,
        isApproved: false,
        isPublished: false,
        orderId: "order-1",
      },
    });

    // Verify ReviewRequest was marked as reviewed
    expect(mockReviewRequestUpdate).toHaveBeenCalledWith({
      where: { id: "rr-1" },
      data: { status: "reviewed" },
    });
  });

  it("uploads photos and stores CDN URLs in review", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const photo1 = createMockFile("photo1.jpg", 1024, "image/jpeg");
    const photo2 = createMockFile("photo2.png", 2048, "image/png");

    mockUploadFile
      .mockResolvedValueOnce(
        "https://cdn.example.com/reviews/shop-1/review-1/photo1.jpg",
      )
      .mockResolvedValueOnce(
        "https://cdn.example.com/reviews/shop-1/review-1/photo2.png",
      );

    const request = createRequest("POST", "valid-token", {
      rating: "5",
      photos: [photo1, photo2],
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockUploadFile).toHaveBeenCalledTimes(2);

    // Verify review was updated with photo URLs
    expect(mockReviewUpdate).toHaveBeenCalledWith({
      where: { id: "review-1" },
      data: {
        photos: [
          "https://cdn.example.com/reviews/shop-1/review-1/photo1.jpg",
          "https://cdn.example.com/reviews/shop-1/review-1/photo2.png",
        ],
      },
    });
  });

  it("returns error for oversized file but still creates review", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const oversizedFile = createMockFile(
      "huge.jpg",
      11 * 1024 * 1024,
      "image/jpeg",
    );

    mockValidateFileUpload.mockReturnValue({
      valid: false,
      error: "File size exceeds maximum of 10 MB",
    });

    const request = createRequest("POST", "valid-token", {
      rating: "4",
      photos: [oversizedFile],
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.photoErrors).toEqual([
      "huge.jpg: File size exceeds maximum of 10 MB",
    ]);
    expect(data.message).toBe(
      "Review submitted, but some photos could not be uploaded.",
    );

    // Upload should not have been called for the invalid file
    expect(mockUploadFile).not.toHaveBeenCalled();

    // ReviewRequest should still be marked as reviewed
    expect(mockReviewRequestUpdate).toHaveBeenCalledWith({
      where: { id: "rr-1" },
      data: { status: "reviewed" },
    });
  });

  it("returns 400 when more than 5 photos are submitted", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const photos = Array.from({ length: 6 }, (_, i) =>
      createMockFile(`photo${i}.jpg`, 1024, "image/jpeg"),
    );

    const request = createRequest("POST", "valid-token", {
      rating: "5",
      photos,
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Maximum 5 photos allowed");
  });

  it("handles upload failure gracefully and preserves review", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const photo = createMockFile("photo.jpg", 1024, "image/jpeg");
    mockUploadFile.mockRejectedValue(new Error("R2 connection timeout"));

    const request = createRequest("POST", "valid-token", {
      rating: "5",
      photos: [photo],
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.photoErrors).toEqual(["photo.jpg: Upload failed"]);
    expect(data.message).toBe(
      "Review submitted, but some photos could not be uploaded.",
    );

    // Review should still be created and request marked as reviewed
    expect(mockReviewCreate).toHaveBeenCalled();
    expect(mockReviewRequestUpdate).toHaveBeenCalledWith({
      where: { id: "rr-1" },
      data: { status: "reviewed" },
    });
  });

  it("handles review with optional title and body as null", async () => {
    mockReviewRequestFindUnique.mockResolvedValue({
      id: "rr-1",
      shopId: "shop-1",
      orderId: "order-1",
      token: "valid-token",
      status: "sent",
    });

    const request = createRequest("POST", "valid-token", {
      rating: "3",
    });
    const response = await action({ request, params: {}, context: {} });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);

    expect(mockReviewCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rating: 3,
        title: null,
        body: null,
        shopifyProductId: "unknown",
      }),
    });
  });
});
