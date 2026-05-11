// Shopify API utility for workers (runs outside Remix process)
// Uses stored access token for direct API calls

export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  handle: string;
  metafields_global_title_tag?: string;
  metafields_global_description_tag?: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}

export interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  product_id: number;
}

export interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
}

export interface ShopifyProductWithMetafields extends ShopifyProduct {
  metaTitle: string | null;
  metaDescription: string | null;
}

/**
 * Fetch all products from a Shopify store using the REST Admin API with pagination.
 */
export async function fetchShopifyProducts(
  shopDomain: string,
  accessToken: string
): Promise<ShopifyProductWithMetafields[]> {
  const products: ShopifyProductWithMetafields[] = [];
  let pageInfo: string | null = null;
  const limit = 50;

  do {
    const url = pageInfo
      ? `https://${shopDomain}/admin/api/2024-10/products.json?limit=${limit}&page_info=${pageInfo}`
      : `https://${shopDomain}/admin/api/2024-10/products.json?limit=${limit}&fields=id,title,body_html,handle,images,variants`;

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const fetchedProducts = (data.products || []) as ShopifyProduct[];

    // For each product, fetch metafields to get SEO title/description
    for (const product of fetchedProducts) {
      const metafields = await fetchProductMetafields(shopDomain, accessToken, product.id);
      products.push({
        ...product,
        metaTitle: metafields.metaTitle,
        metaDescription: metafields.metaDescription,
      });
    }

    // Parse Link header for pagination
    const linkHeader = response.headers.get('Link');
    pageInfo = parseLinkHeader(linkHeader);
  } while (pageInfo);

  return products;
}

/**
 * Fetch a single product from Shopify.
 */
export async function fetchShopifyProduct(
  shopDomain: string,
  accessToken: string,
  productId: string
): Promise<ShopifyProductWithMetafields | null> {
  const url = `https://${shopDomain}/admin/api/2024-10/products/${productId}.json`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const product = data.product as ShopifyProduct;

  const metafields = await fetchProductMetafields(shopDomain, accessToken, product.id);

  return {
    ...product,
    metaTitle: metafields.metaTitle,
    metaDescription: metafields.metaDescription,
  };
}

/**
 * Fetch product metafields (SEO title and description).
 */
async function fetchProductMetafields(
  shopDomain: string,
  accessToken: string,
  productId: number
): Promise<{ metaTitle: string | null; metaDescription: string | null }> {
  try {
    const url = `https://${shopDomain}/admin/api/2024-10/products/${productId}/metafields.json?namespace=global`;

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { metaTitle: null, metaDescription: null };
    }

    const data = await response.json();
    const metafields = (data.metafields || []) as Array<{ key: string; value: string }>;

    const titleField = metafields.find((m) => m.key === 'title_tag');
    const descField = metafields.find((m) => m.key === 'description_tag');

    return {
      metaTitle: titleField?.value || null,
      metaDescription: descField?.value || null,
    };
  } catch {
    return { metaTitle: null, metaDescription: null };
  }
}

/**
 * Update a product's metafields (SEO title and description).
 */
export async function updateProductMetafields(
  shopDomain: string,
  accessToken: string,
  productId: number,
  metaTitle: string,
  metaDescription: string
): Promise<void> {
  const url = `https://${shopDomain}/admin/api/2024-10/products/${productId}/metafields.json`;

  // Set meta title
  await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      metafield: {
        namespace: 'global',
        key: 'title_tag',
        value: metaTitle,
        type: 'single_line_text_field',
      },
    }),
  });

  // Set meta description
  await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      metafield: {
        namespace: 'global',
        key: 'description_tag',
        value: metaDescription,
        type: 'single_line_text_field',
      },
    }),
  });
}

/**
 * Update an image's alt text.
 */
export async function updateImageAltText(
  shopDomain: string,
  accessToken: string,
  productId: number,
  imageId: number,
  altText: string
): Promise<void> {
  const url = `https://${shopDomain}/admin/api/2024-10/products/${productId}/images/${imageId}.json`;

  await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: { id: imageId, alt: altText },
    }),
  });
}

/**
 * Create a script tag for schema.org JSON-LD injection.
 */
export async function createScriptTag(
  shopDomain: string,
  accessToken: string,
  src: string
): Promise<void> {
  const url = `https://${shopDomain}/admin/api/2024-10/script_tags.json`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      script_tag: {
        event: 'onload',
        src,
      },
    }),
  });
}

/**
 * Parse the Link header for Shopify pagination.
 */
function parseLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  return nextMatch ? nextMatch[1] : null;
}
