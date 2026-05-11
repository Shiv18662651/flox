import type { Plan } from "@prisma/client";

export interface PlanConfig {
  name: string;
  plan: Plan;
  price: number;
  features: {
    emails: number;
    vipTiers: boolean;
    abUpsells: boolean;
    ltvReport: boolean;
    reviewSentiment: boolean;
  };
  description: string;
}

export const PLAN_CONFIGS: Record<Plan, PlanConfig> = {
  STARTER: {
    name: "Starter",
    plan: "STARTER",
    price: 29,
    features: {
      emails: 5000,
      vipTiers: false,
      abUpsells: false,
      ltvReport: false,
      reviewSentiment: false,
    },
    description: "Essential tools for growing stores",
  },
  GROWTH: {
    name: "Growth",
    plan: "GROWTH",
    price: 79,
    features: {
      emails: 25000,
      vipTiers: true,
      abUpsells: true,
      ltvReport: true,
      reviewSentiment: true,
    },
    description: "Advanced features for scaling stores",
  },
  PRO: {
    name: "Pro",
    plan: "PRO",
    price: 149,
    features: {
      emails: 100000,
      vipTiers: true,
      abUpsells: true,
      ltvReport: true,
      reviewSentiment: true,
    },
    description: "Full power for high-volume stores",
  },
};

/** Plan hierarchy for upgrade/downgrade comparison */
const PLAN_ORDER: Plan[] = ["STARTER", "GROWTH", "PRO"];

export function isPlanUpgrade(currentPlan: Plan, newPlan: Plan): boolean {
  return PLAN_ORDER.indexOf(newPlan) > PLAN_ORDER.indexOf(currentPlan);
}

export function isPlanDowngrade(currentPlan: Plan, newPlan: Plan): boolean {
  return PLAN_ORDER.indexOf(newPlan) < PLAN_ORDER.indexOf(currentPlan);
}

/**
 * Creates a recurring application subscription via Shopify GraphQL Admin API.
 * Returns the confirmation URL that the merchant must visit to approve the charge.
 */
export async function createSubscription(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  plan: Plan,
  shopDomain: string,
  returnUrl: string
): Promise<{ confirmationUrl: string; subscriptionId: string }> {
  const config = PLAN_CONFIGS[plan];

  const response = await admin.graphql(
    `#graphql
    mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        test: $test
      ) {
        appSubscription {
          id
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: `Nexify ${config.name} Plan`,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: config.price,
                  currencyCode: "USD",
                },
              },
            },
          },
        ],
        returnUrl,
        test: process.env.NODE_ENV !== "production",
      },
    }
  );

  const data = await response.json();
  const result = data.data?.appSubscriptionCreate;

  if (result?.userErrors?.length > 0) {
    throw new Error(
      `Failed to create subscription: ${result.userErrors.map((e: { message: string }) => e.message).join(", ")}`
    );
  }

  if (!result?.confirmationUrl) {
    throw new Error("Failed to create subscription: no confirmation URL returned");
  }

  return {
    confirmationUrl: result.confirmationUrl,
    subscriptionId: result.appSubscription.id,
  };
}

/**
 * Cancels an existing subscription via Shopify GraphQL Admin API.
 */
export async function cancelSubscription(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  subscriptionId: string
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation appSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: subscriptionId,
      },
    }
  );

  const data = await response.json();
  const result = data.data?.appSubscriptionCancel;

  if (result?.userErrors?.length > 0) {
    throw new Error(
      `Failed to cancel subscription: ${result.userErrors.map((e: { message: string }) => e.message).join(", ")}`
    );
  }
}

/**
 * Retrieves the active subscription for the current app installation.
 */
export async function getActiveSubscription(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> }
): Promise<{ id: string; name: string; status: string } | null> {
  const response = await admin.graphql(
    `#graphql
    query getActiveSubscription {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }`
  );

  const data = await response.json();
  const subscriptions =
    data.data?.currentAppInstallation?.activeSubscriptions ?? [];

  if (subscriptions.length === 0) {
    return null;
  }

  const active = subscriptions[0];
  return {
    id: active.id,
    name: active.name,
    status: active.status,
  };
}
