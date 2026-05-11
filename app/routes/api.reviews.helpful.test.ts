import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();

vi.mock("~/db.server", () => ({
  db: {
    review: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { action } from "./api.reviews.helpful";

function createRequest(method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/reviews/helpful", init);
}

describe("api.reviews.helpful", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 405 for non-POST methods", async () => {
    const request = new Request("http://localhost/api/reviews/helpful", {
      method: "GET",
    });
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(405);
  });

  it("returns 400 for invalid JSON body", async () => {
    const request = new Request("http://localhost/api/reviews/helpful", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(400);
  });

  it("returns 400 when reviewId is missing", async () => {
    const request = createRequest("POST", {});
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("reviewId is required");
  });

  it("returns 404 when review does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const request = createRequest("POST", { reviewId: "nonexistent" });
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(404);
  });

  it("returns 403 when review is not published", async () => {
    mockFindUnique.mockResolvedValue({ id: "rev1", isPublished: false });
    const request = createRequest("POST", { reviewId: "rev1" });
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(403);
  });

  it("increments helpfulCount for a published review", async () => {
    mockFindUnique.mockResolvedValue({ id: "rev1", isPublished: true });
    mockUpdate.mockResolvedValue({ helpfulCount: 5 });

    const request = createRequest("POST", { reviewId: "rev1" });
    const response = await action({ request, params: {}, context: {} });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.helpfulCount).toBe(5);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "rev1" },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true },
    });
  });
});
