import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
const mockShopFindUnique = vi.fn();
const mockReviewCount = vi.fn();
const mockReviewAggregate = vi.fn();
const mockReviewFindMany = vi.fn();

vi.mock("~/db.server", () => ({
  db: {
    shop: {
      findUnique: (...args: unknown[]) => mockShopFindUnique(...args),
    },
    review: {
      count: (...args: unknown[]) => mockReviewCount(...args),
      aggregate: (...args: unknown[]) => mockReviewAggregate(...args),
      findMany: (...args: unknown[]) => mockReviewFindMany(...args),
    },
  },
}));

import { loader } from "./api.reviews.public";

function createRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/reviews/public");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString(), { method: "GET" });
}

describe("api.reviews.public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shopId is missing", async () => {
    const request = createRequest({ productId: "123" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("shopId and productId are required");
  });

  it("returns 400 when productId is missing", async () => {
    const request = createRequest({ shopId: "shop1" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("shopId and productId are required");
  });

  it("returns 404 when shop does not exist", async () => {
    mockShopFindUnique.mockResolvedValue(null);
    const request = createRequest({ shopId: "shop1", productId: "prod1" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Shop not found");
  });

  it("returns 404 when shop is inactive", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: false });
    const request = createRequest({ shopId: "shop1", productId: "prod1" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Shop not found");
  });

  it("returns empty reviews when no published reviews exist", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: true });
    mockReviewCount.mockResolvedValue(0);
    mockReviewAggregate.mockResolvedValue({ _avg: { rating: null } });
    mockReviewFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1", productId: "prod1" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.reviews).toEqual([]);
    expect(data.averageRating).toBe(0);
    expect(data.totalCount).toBe(0);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBe(0);
  });

  it("returns formatted reviews with aggregate data", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: true });
    mockReviewCount.mockResolvedValue(2);
    mockReviewAggregate.mockResolvedValue({ _avg: { rating: 4.5 } });
    mockReviewFindMany.mockResolvedValue([
      {
        id: "rev1",
        rating: 5,
        title: "Great product",
        body: "Loved it!",
        photos: ["https://cdn.example.com/photo1.jpg"],
        verifiedPurchase: true,
        helpfulCount: 3,
        createdAt: new Date("2024-01-15T10:00:00Z"),
        customer: { firstName: "John", lastName: "Doe" },
      },
      {
        id: "rev2",
        rating: 4,
        title: null,
        body: "Good quality",
        photos: [],
        verifiedPurchase: false,
        helpfulCount: 0,
        createdAt: new Date("2024-01-10T10:00:00Z"),
        customer: { firstName: "Jane", lastName: null },
      },
    ]);

    const request = createRequest({ shopId: "shop1", productId: "prod1" });
    const response = await loader({ request, params: {}, context: {} });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.averageRating).toBe(4.5);
    expect(data.totalCount).toBe(2);
    expect(data.reviews).toHaveLength(2);

    // Check first review formatting
    expect(data.reviews[0].id).toBe("rev1");
    expect(data.reviews[0].rating).toBe(5);
    expect(data.reviews[0].title).toBe("Great product");
    expect(data.reviews[0].body).toBe("Loved it!");
    expect(data.reviews[0].photos).toEqual([
      "https://cdn.example.com/photo1.jpg",
    ]);
    expect(data.reviews[0].verifiedPurchase).toBe(true);
    expect(data.reviews[0].helpfulCount).toBe(3);
    expect(data.reviews[0].reviewerName).toBe("John D.");

    // Check second review - no last name
    expect(data.reviews[1].reviewerName).toBe("Jane");
  });

  it("formats reviewer name as Anonymous when no customer data", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: true });
    mockReviewCount.mockResolvedValue(1);
    mockReviewAggregate.mockResolvedValue({ _avg: { rating: 3.0 } });
    mockReviewFindMany.mockResolvedValue([
      {
        id: "rev1",
        rating: 3,
        title: null,
        body: "OK",
        photos: [],
        verifiedPurchase: false,
        helpfulCount: 0,
        createdAt: new Date("2024-01-15T10:00:00Z"),
        customer: null,
      },
    ]);

    const request = createRequest({ shopId: "shop1", productId: "prod1" });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();
    expect(data.reviews[0].reviewerName).toBe("Anonymous");
  });

  it("respects pagination parameters", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: true });
    mockReviewCount.mockResolvedValue(25);
    mockReviewAggregate.mockResolvedValue({ _avg: { rating: 4.2 } });
    mockReviewFindMany.mockResolvedValue([]);

    const request = createRequest({
      shopId: "shop1",
      productId: "prod1",
      page: "3",
      limit: "5",
    });
    const response = await loader({ request, params: {}, context: {} });
    const data = await response.json();

    expect(data.page).toBe(3);
    expect(data.totalPages).toBe(5);

    // Verify findMany was called with correct skip/take
    expect(mockReviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10, // (3-1) * 5
        take: 5,
      }),
    );
  });

  it("clamps limit to max 50", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: true });
    mockReviewCount.mockResolvedValue(100);
    mockReviewAggregate.mockResolvedValue({ _avg: { rating: 4.0 } });
    mockReviewFindMany.mockResolvedValue([]);

    const request = createRequest({
      shopId: "shop1",
      productId: "prod1",
      limit: "200",
    });
    await loader({ request, params: {}, context: {} });

    expect(mockReviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      }),
    );
  });

  it("sets CORS headers on response", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: true });
    mockReviewCount.mockResolvedValue(0);
    mockReviewAggregate.mockResolvedValue({ _avg: { rating: null } });
    mockReviewFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1", productId: "prod1" });
    const response = await loader({ request, params: {}, context: {} });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET");
  });

  it("only queries published reviews", async () => {
    mockShopFindUnique.mockResolvedValue({ id: "shop1", isActive: true });
    mockReviewCount.mockResolvedValue(0);
    mockReviewAggregate.mockResolvedValue({ _avg: { rating: null } });
    mockReviewFindMany.mockResolvedValue([]);

    const request = createRequest({ shopId: "shop1", productId: "prod1" });
    await loader({ request, params: {}, context: {} });

    // Verify all queries filter by isPublished: true
    expect(mockReviewCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPublished: true }),
      }),
    );
    expect(mockReviewAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPublished: true }),
      }),
    );
    expect(mockReviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPublished: true }),
      }),
    );
  });
});
