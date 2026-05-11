import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("~/db.server", () => ({
  db: {
    customer: {
      findFirst: vi.fn(),
    },
    shop: {
      findUnique: vi.fn(),
    },
    referralProgram: {
      findUnique: vi.fn(),
    },
    referral: {
      create: vi.fn(),
    },
  },
}));

import { loader } from "./api.referral";
import { db } from "~/db.server";

const mockDb = vi.mocked(db);

function createRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/referral");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString(), { method: "GET" });
}

describe("GET /api/referral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when referral code is missing", async () => {
    const request = createRequest({ shop: "test.myshopify.com" });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing referral code");
  });

  it("returns 400 when shop parameter is missing", async () => {
    const request = createRequest({ code: "abc12345" });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing shop parameter");
  });

  it("returns 404 when referral code does not exist", async () => {
    mockDb.customer.findFirst.mockResolvedValue(null);

    const request = createRequest({ code: "invalid1", shop: "test.myshopify.com" });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Invalid referral code");
  });

  it("returns 404 when shop does not match referrer's shop", async () => {
    mockDb.customer.findFirst.mockResolvedValue({
      id: "cust1",
      shopId: "shop1",
      email: "referrer@example.com",
      referralCode: "abc12345",
    } as any);
    mockDb.shop.findUnique.mockResolvedValue({ id: "shop2" } as any);

    const request = createRequest({ code: "abc12345", shop: "other.myshopify.com" });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Invalid referral code for this shop");
  });

  it("returns 400 when customer uses their own referral code (self-referral)", async () => {
    mockDb.customer.findFirst.mockResolvedValue({
      id: "cust1",
      shopId: "shop1",
      email: "user@example.com",
      referralCode: "abc12345",
    } as any);
    mockDb.shop.findUnique.mockResolvedValue({ id: "shop1" } as any);

    const request = createRequest({
      code: "abc12345",
      shop: "test.myshopify.com",
      email: "user@example.com",
    });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("You cannot use your own referral code");
  });

  it("returns 400 when referral program is not active", async () => {
    mockDb.customer.findFirst.mockResolvedValue({
      id: "cust1",
      shopId: "shop1",
      email: "referrer@example.com",
      referralCode: "abc12345",
    } as any);
    mockDb.shop.findUnique.mockResolvedValue({ id: "shop1" } as any);
    mockDb.referralProgram.findUnique.mockResolvedValue({
      id: "prog1",
      isActive: false,
      friendDiscount: 15,
    } as any);

    const request = createRequest({ code: "abc12345", shop: "test.myshopify.com" });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Referral program is not active");
  });

  it("creates a referral record and returns success for valid code", async () => {
    mockDb.customer.findFirst.mockResolvedValue({
      id: "cust1",
      shopId: "shop1",
      email: "referrer@example.com",
      referralCode: "abc12345",
    } as any);
    mockDb.shop.findUnique.mockResolvedValue({ id: "shop1" } as any);
    mockDb.referralProgram.findUnique.mockResolvedValue({
      id: "prog1",
      isActive: true,
      friendDiscount: 15,
    } as any);
    mockDb.referral.create.mockResolvedValue({ id: "ref1" } as any);

    const request = createRequest({
      code: "abc12345",
      shop: "test.myshopify.com",
      email: "friend@example.com",
    });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.referralCode).toBe("abc12345");
    expect(data.friendDiscount).toBe(15);

    // Verify referral record was created
    expect(mockDb.referral.create).toHaveBeenCalledWith({
      data: {
        shopId: "shop1",
        programId: "prog1",
        referrerCustomerId: "cust1",
        referredEmail: "friend@example.com",
        status: "pending",
      },
    });
  });

  it("creates referral with placeholder email when visitor email not provided", async () => {
    mockDb.customer.findFirst.mockResolvedValue({
      id: "cust1",
      shopId: "shop1",
      email: "referrer@example.com",
      referralCode: "abc12345",
    } as any);
    mockDb.shop.findUnique.mockResolvedValue({ id: "shop1" } as any);
    mockDb.referralProgram.findUnique.mockResolvedValue({
      id: "prog1",
      isActive: true,
      friendDiscount: 10,
    } as any);
    mockDb.referral.create.mockResolvedValue({ id: "ref1" } as any);

    const request = createRequest({ code: "abc12345", shop: "test.myshopify.com" });
    const response = await loader({ request, params: {}, context: {} as any });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify referral was created with a placeholder email
    expect(mockDb.referral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopId: "shop1",
          programId: "prog1",
          referrerCustomerId: "cust1",
          status: "pending",
        }),
      })
    );
  });
});
