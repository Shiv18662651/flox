import { describe, it, expect } from 'vitest';
import { detectProductSeoIssues, calculateAuditScore } from './seo-issues';
import type { ShopifyProductWithMetafields } from './shopify-api';

describe('detectProductSeoIssues', () => {
  const shopDomain = 'test-shop.myshopify.com';

  function makeProduct(overrides: Partial<ShopifyProductWithMetafields> = {}): ShopifyProductWithMetafields {
    return {
      id: 1,
      title: 'Test Product',
      body_html: '<p>A great product</p>',
      handle: 'test-product',
      images: [],
      variants: [{ id: 1, title: 'Default', price: '19.99' }],
      metaTitle: 'Test Product - Buy Now',
      metaDescription: 'Shop the best test product available.',
      ...overrides,
    };
  }

  it('returns no issues for a fully optimized product', () => {
    const product = makeProduct({
      images: [{ id: 1, src: 'https://cdn.shopify.com/img1.jpg', alt: 'Product image', product_id: 1 }],
    });

    const issues = detectProductSeoIssues(product, shopDomain);
    expect(issues).toHaveLength(0);
  });

  it('detects missing meta title', () => {
    const product = makeProduct({ metaTitle: null });

    const issues = detectProductSeoIssues(product, shopDomain);
    const metaTitleIssues = issues.filter(
      (i) => i.type === 'missing_meta' && i.description.includes('meta title')
    );
    expect(metaTitleIssues).toHaveLength(1);
    expect(metaTitleIssues[0].severity).toBe('critical');
    expect(metaTitleIssues[0].resourceUrl).toBe(`https://${shopDomain}/products/test-product`);
  });

  it('detects empty string meta title', () => {
    const product = makeProduct({ metaTitle: '   ' });

    const issues = detectProductSeoIssues(product, shopDomain);
    const metaTitleIssues = issues.filter(
      (i) => i.type === 'missing_meta' && i.description.includes('meta title')
    );
    expect(metaTitleIssues).toHaveLength(1);
  });

  it('detects missing meta description', () => {
    const product = makeProduct({ metaDescription: null });

    const issues = detectProductSeoIssues(product, shopDomain);
    const metaDescIssues = issues.filter(
      (i) => i.type === 'missing_meta' && i.description.includes('meta description')
    );
    expect(metaDescIssues).toHaveLength(1);
    expect(metaDescIssues[0].severity).toBe('critical');
  });

  it('detects missing image alt text', () => {
    const product = makeProduct({
      images: [
        { id: 1, src: 'https://cdn.shopify.com/img1.jpg', alt: null, product_id: 1 },
        { id: 2, src: 'https://cdn.shopify.com/img2.jpg', alt: 'Good alt', product_id: 1 },
        { id: 3, src: 'https://cdn.shopify.com/img3.jpg', alt: '', product_id: 1 },
      ],
    });

    const issues = detectProductSeoIssues(product, shopDomain);
    const altIssues = issues.filter((i) => i.type === 'missing_alt');
    expect(altIssues).toHaveLength(2);
    expect(altIssues[0].severity).toBe('warning');
    expect(altIssues[0].resourceUrl).toBe('https://cdn.shopify.com/img1.jpg');
    expect(altIssues[1].resourceUrl).toBe('https://cdn.shopify.com/img3.jpg');
  });

  it('detects multiple issues on a single product', () => {
    const product = makeProduct({
      metaTitle: null,
      metaDescription: null,
      images: [
        { id: 1, src: 'https://cdn.shopify.com/img1.jpg', alt: null, product_id: 1 },
      ],
    });

    const issues = detectProductSeoIssues(product, shopDomain);
    expect(issues).toHaveLength(3); // missing title + missing desc + missing alt
  });

  it('handles product with no images', () => {
    const product = makeProduct({ images: [], metaTitle: 'Title', metaDescription: 'Desc' });

    const issues = detectProductSeoIssues(product, shopDomain);
    expect(issues).toHaveLength(0);
  });

  it('includes product title in issue descriptions', () => {
    const product = makeProduct({ title: 'Fancy Widget', metaTitle: null });

    const issues = detectProductSeoIssues(product, shopDomain);
    expect(issues[0].description).toContain('Fancy Widget');
  });
});

describe('calculateAuditScore', () => {
  it('returns 100 when no products have issues', () => {
    expect(calculateAuditScore(10, 0)).toBe(100);
  });

  it('returns 0 when all products have issues', () => {
    expect(calculateAuditScore(10, 10)).toBe(0);
  });

  it('returns 100 when there are no products', () => {
    expect(calculateAuditScore(0, 0)).toBe(100);
  });

  it('calculates correct percentage', () => {
    expect(calculateAuditScore(10, 3)).toBe(70);
    expect(calculateAuditScore(4, 1)).toBe(75);
  });

  it('rounds to nearest integer', () => {
    expect(calculateAuditScore(3, 1)).toBe(67); // 66.67 rounds to 67
  });

  it('clamps to 0-100 range', () => {
    // Edge case: more issues than products (shouldn't happen but be safe)
    expect(calculateAuditScore(5, 10)).toBe(0);
  });
});
