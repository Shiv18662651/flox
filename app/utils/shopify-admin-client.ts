// Shopify admin client factory for non-authenticated contexts.
// Use this in storefront-facing API routes and background workers where
// Remix's authenticate.admin() is not available. The shop's stored access
// token is required (fetched from the Shop record).

const API_VERSION = "2024-10";

export interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
}

/**
 * Build a minimal Shopify admin GraphQL client from a shop's stored access token.
 * Returns an object with a `graphql()` method matching the shape produced by
 * authenticate.admin(), so the same helpers (billing, discount) can accept either.
 */
export function createShopAdminClient(
  shopDomain: string,
  accessToken: string
): AdminClient {
  if (!shopDomain || !accessToken) {
    throw new Error("shopDomain and accessToken are required");
  }

  const endpoint = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;

  return {
    async graphql(query, options) {
      return fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables ?? {},
        }),
      });
    },
  };
}
