import { randomBytes } from "crypto";

// Shopify Discount API helper
// Creates real Shopify discount codes for loyalty redemption and referral rewards.
// Uses GraphQL Admin API 2024-10 — discountCodeBasicCreate mutation.

interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
}

export interface CreateDiscountInput {
  /** Discount code to assign (must be unique per shop) */
  code: string;
  /** Human-readable title shown in Shopify admin */
  title: string;
  /** Discount type: fixed dollar amount or percentage */
  valueType: "fixed_amount" | "percentage";
  /** Amount in USD for fixed_amount, or decimal (e.g. 0.15 for 15%) for percentage */
  value: number;
  /** One-time use per customer (default true) */
  oncePerCustomer?: boolean;
  /** Max total usage across all customers (default 1 for single-use codes) */
  usageLimit?: number;
  /** When the discount expires (ISO string). Defaults to 90 days from now. */
  endsAt?: string;
}

export interface CreateDiscountResult {
  success: boolean;
  code: string;
  discountId?: string;
  error?: string;
}

/**
 * Create a Shopify basic discount code via the Admin GraphQL API.
 *
 * For fixed_amount, uses the customer-facing currency (USD for most shops).
 * For percentage, the value is a decimal (0.15 = 15% off).
 *
 * Returns { success: true, code, discountId } on success,
 * { success: false, code, error } on failure.
 */
export async function createDiscountCode(
  admin: AdminClient,
  input: CreateDiscountInput
): Promise<CreateDiscountResult> {
  const {
    code,
    title,
    valueType,
    value,
    oncePerCustomer = true,
    usageLimit = 1,
    endsAt,
  } = input;

  // Default expiry: 90 days from now
  const endsAtIso =
    endsAt ??
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // Build customerGets.value based on type
  const customerGetsValue =
    valueType === "percentage"
      ? { percentage: value }
      : {
          discountAmount: {
            amount: value,
            appliesOnEachItem: false,
          },
        };

  try {
    const response = await admin.graphql(
      `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) {
                  nodes { code }
                }
                status
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          basicCodeDiscount: {
            title,
            code,
            startsAt: new Date().toISOString(),
            endsAt: endsAtIso,
            customerSelection: { all: true },
            customerGets: {
              value: customerGetsValue,
              items: { all: true },
            },
            appliesOncePerCustomer: oncePerCustomer,
            usageLimit,
          },
        },
      }
    );

    const data = await response.json();
    const result = data.data?.discountCodeBasicCreate;

    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        code,
        error: result.userErrors
          .map((e: { message: string }) => e.message)
          .join(", "),
      };
    }

    const discountId = result?.codeDiscountNode?.id;
    if (!discountId) {
      return {
        success: false,
        code,
        error: "Shopify did not return a discount ID",
      };
    }

    return { success: true, code, discountId };
  } catch (err) {
    return {
      success: false,
      code,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Generate a short, random, URL-safe suffix for a discount code.
 * Uses uppercase hex of random bytes for readability.
 */
export function generateDiscountSuffix(bytes = 4): string {
  return randomBytes(bytes).toString("hex").toUpperCase();
}
