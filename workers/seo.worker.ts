// SEO audit worker - scans products for SEO issues
// Requirements: 12.1, 12.2, 12.3, 12.10
// Concurrency: 1, Retry: 2× exponential backoff

import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { connection, QUEUES, WORKER_CONFIG, type SeoAuditJob } from './index';
import { fetchShopifyProducts, fetchShopifyProduct } from './shopify-api';
import { detectProductSeoIssues, calculateAuditScore } from './seo-issues';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

/**
 * Process an SEO audit job.
 * - If productId is set: audit only that product (targeted check from webhook)
 * - If productId is not set: full audit of all products
 */
export async function processSeoAudit(shopId: string, productId?: string) {
  // Get shop and SEO settings
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true, accessToken: true },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }

  const seoSettings = await db.seoSettings.findUnique({
    where: { shopId },
  });

  if (!seoSettings) {
    throw new Error(`SEO settings not found for shop: ${shopId}`);
  }

  if (productId) {
    // Targeted audit for a single product
    await auditSingleProduct(shop.shopDomain, shop.accessToken, shopId, seoSettings.id, productId);
  } else {
    // Full audit of all products
    await auditAllProducts(shop.shopDomain, shop.accessToken, shopId, seoSettings.id);
  }
}

/**
 * Audit a single product (triggered by webhook).
 */
async function auditSingleProduct(
  shopDomain: string,
  accessToken: string,
  shopId: string,
  settingsId: string,
  productId: string
) {
  const product = await fetchShopifyProduct(shopDomain, accessToken, productId);

  if (!product) {
    console.log(`[seo] Product ${productId} not found, skipping`);
    return;
  }

  // Clear existing unfixed issues for this product
  const productUrl = `https://${shopDomain}/products/${product.handle}`;
  await db.seoIssue.updateMany({
    where: {
      shopId,
      settingsId,
      resourceUrl: { startsWith: productUrl },
      isFixed: false,
    },
    data: { isFixed: true },
  });

  // Also clear image-related issues for this product
  for (const image of product.images) {
    await db.seoIssue.updateMany({
      where: {
        shopId,
        settingsId,
        resourceUrl: image.src,
        isFixed: false,
      },
      data: { isFixed: true },
    });
  }

  // Detect new issues
  const issues = detectProductSeoIssues(product, shopDomain);

  // Create new issue records
  for (const issue of issues) {
    await db.seoIssue.create({
      data: {
        shopId,
        settingsId,
        type: issue.type,
        severity: issue.severity,
        resourceUrl: issue.resourceUrl,
        description: issue.description,
      },
    });
  }

  console.log(`[seo] Targeted audit for product ${productId}: ${issues.length} issues found`);
}

/**
 * Full audit of all products in the shop.
 */
async function auditAllProducts(
  shopDomain: string,
  accessToken: string,
  shopId: string,
  settingsId: string
) {
  // Mark all existing unfixed issues as fixed (we'll re-detect them)
  await db.seoIssue.updateMany({
    where: { shopId, settingsId, isFixed: false },
    data: { isFixed: true },
  });

  let products;
  try {
    products = await fetchShopifyProducts(shopDomain, accessToken);
  } catch (error) {
    console.error(`[seo] Failed to fetch products for shop ${shopId}:`, error);
    // Log to Sentry (Req 12.10)
    // Sentry.captureException(error, { extra: { shopId } });
    throw error;
  }

  const totalProducts = products.length;
  let productsWithIssues = 0;

  for (const product of products) {
    try {
      const issues = detectProductSeoIssues(product, shopDomain);

      if (issues.length > 0) {
        productsWithIssues++;
      }

      // Create issue records
      for (const issue of issues) {
        await db.seoIssue.create({
          data: {
            shopId,
            settingsId,
            type: issue.type,
            severity: issue.severity,
            resourceUrl: issue.resourceUrl,
            description: issue.description,
          },
        });
      }
    } catch (error) {
      // On Groq API error or any processing error: log to Sentry, skip product, continue batch (Req 12.10)
      console.error(`[seo] Error processing product ${product.id}:`, error);
      // Sentry.captureException(error, { extra: { shopId, productId: product.id } });
      continue;
    }
  }

  // Calculate and update audit score
  const auditScore = calculateAuditScore(totalProducts, productsWithIssues);

  await db.seoSettings.update({
    where: { shopId },
    data: {
      lastAuditAt: new Date(),
      auditScore,
    },
  });

  console.log(
    `[seo] Full audit complete for shop ${shopId}: ${totalProducts} products, ${productsWithIssues} with issues, score: ${auditScore}`
  );
}

export function createSeoWorker() {
  const config = WORKER_CONFIG[QUEUES.SEO_AUDIT];

  const worker = new Worker<SeoAuditJob>(
    QUEUES.SEO_AUDIT,
    async (job) => {
      const { shopId, productId } = job.data;
      await processSeoAudit(shopId, productId);
    },
    {
      connection,
      concurrency: config.concurrency,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: config.backoff,
      },
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[seo] Job ${job?.id} failed:`, err.message);
    // Sentry.captureException(err, { extra: { jobId: job?.id, data: job?.data } });
  });

  return worker;
}
