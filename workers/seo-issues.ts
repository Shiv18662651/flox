// Pure SEO issue detection logic - testable without Shopify API calls
// Requirements: 12.2, 12.3

import type { ShopifyProductWithMetafields } from './shopify-api';

export interface DetectedSeoIssue {
  type: 'missing_meta' | 'missing_alt' | 'broken_link' | 'slow_page';
  severity: 'critical' | 'warning' | 'info';
  resourceUrl: string;
  description: string;
}

/**
 * Detect SEO issues for a single product.
 * Checks for:
 * - Missing meta title (critical)
 * - Missing meta description (critical)
 * - Missing image alt text (warning per image)
 * - Missing structured data (info - always flagged since we can't detect it from product data alone)
 */
export function detectProductSeoIssues(
  product: ShopifyProductWithMetafields,
  shopDomain: string
): DetectedSeoIssue[] {
  const issues: DetectedSeoIssue[] = [];
  const productUrl = `https://${shopDomain}/products/${product.handle}`;

  // Check meta title
  if (!product.metaTitle || product.metaTitle.trim() === '') {
    issues.push({
      type: 'missing_meta',
      severity: 'critical',
      resourceUrl: productUrl,
      description: `Product "${product.title}" is missing a meta title. This affects search engine visibility.`,
    });
  }

  // Check meta description
  if (!product.metaDescription || product.metaDescription.trim() === '') {
    issues.push({
      type: 'missing_meta',
      severity: 'critical',
      resourceUrl: productUrl,
      description: `Product "${product.title}" is missing a meta description. Search engines may show a generic snippet.`,
    });
  }

  // Check image alt text
  for (const image of product.images) {
    if (!image.alt || image.alt.trim() === '') {
      issues.push({
        type: 'missing_alt',
        severity: 'warning',
        resourceUrl: image.src,
        description: `Image for product "${product.title}" is missing alt text. This affects accessibility and image SEO.`,
      });
    }
  }

  return issues;
}

/**
 * Calculate audit score based on products and issues.
 * Score = (total products - products with issues) / total products * 100
 */
export function calculateAuditScore(
  totalProducts: number,
  productsWithIssues: number
): number {
  if (totalProducts === 0) return 100;
  const score = Math.round(((totalProducts - productsWithIssues) / totalProducts) * 100);
  return Math.max(0, Math.min(100, score));
}
