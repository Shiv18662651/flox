import { Meilisearch } from "meilisearch";

const meilisearch = new Meilisearch({
  host: process.env.MEILISEARCH_URL || "http://127.0.0.1:7700",
  apiKey: process.env.MEILISEARCH_MASTER_KEY,
});

export const INDEXES = {
  CUSTOMERS: "customers",
  PRODUCTS: "products",
} as const;

/**
 * Configure Meilisearch indexes with searchable and filterable attributes.
 * Call once during app initialization or after index creation.
 */
export async function configureIndexes() {
  const customersIndex = meilisearch.index(INDEXES.CUSTOMERS);
  await customersIndex.updateSearchableAttributes([
    "email",
    "firstName",
    "lastName",
    "phone",
  ]);
  await customersIndex.updateFilterableAttributes(["shopId"]);

  const productsIndex = meilisearch.index(INDEXES.PRODUCTS);
  await productsIndex.updateSearchableAttributes([
    "title",
    "vendor",
    "productType",
    "tags",
  ]);
  await productsIndex.updateFilterableAttributes(["shopId"]);
}

export { meilisearch };
