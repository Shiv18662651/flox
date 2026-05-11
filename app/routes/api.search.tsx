// Dashboard search API endpoint
// Requirements: 15.1, 15.5, 15.6
// Queries Meilisearch for customers and products within the merchant's shop scope.
// Meilisearch listens only on 127.0.0.1:7700 — not exposed publicly.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { meilisearch, INDEXES } from "~/meilisearch.server";

/**
 * GET /api/search?q=<query>&index=<customers|products>&limit=<number>
 *
 * Authenticated search endpoint for the merchant dashboard.
 * Filters results by the authenticated shop's ID.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const indexParam = url.searchParams.get("index") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  if (!query.trim()) {
    return json({ customers: [], products: [] });
  }

  const results: { customers: unknown[]; products: unknown[] } = {
    customers: [],
    products: [],
  };

  try {
    if (indexParam === "customers" || indexParam === "all") {
      const customerResults = await meilisearch
        .index(INDEXES.CUSTOMERS)
        .search(query, {
          filter: `shopId = "${shopId}"`,
          limit,
        });
      results.customers = customerResults.hits;
    }

    if (indexParam === "products" || indexParam === "all") {
      const productResults = await meilisearch
        .index(INDEXES.PRODUCTS)
        .search(query, {
          filter: `shopId = "${shopId}"`,
          limit,
        });
      results.products = productResults.hits;
    }
  } catch (error) {
    console.error("[api.search] Meilisearch query error:", error);
    return json(
      { error: "Search service unavailable", customers: [], products: [] },
      { status: 503 }
    );
  }

  return json(results);
}
