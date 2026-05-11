import { Queue } from 'bullmq'
import Redis from 'ioredis'

// Create a dedicated Redis connection for BullMQ
const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null, // Required by BullMQ
})

// Queue names
export const QUEUES = {
  EMAIL: 'email',
  WEBHOOK: 'webhook',
  REVIEW_REQUEST: 'review-request',
  SEO_AUDIT: 'seo-audit',
  ANALYTICS: 'analytics',
  SEARCH_INDEX: 'search-index',
} as const

export type QueueName = typeof QUEUES[keyof typeof QUEUES]

// Queue instances (for enqueuing jobs from the app)
export const emailQueue = new Queue(QUEUES.EMAIL, { connection })
export const webhookQueue = new Queue(QUEUES.WEBHOOK, { connection })
export const reviewRequestQueue = new Queue(QUEUES.REVIEW_REQUEST, { connection })
export const seoAuditQueue = new Queue(QUEUES.SEO_AUDIT, { connection })
export const analyticsQueue = new Queue(QUEUES.ANALYTICS, { connection })
export const searchIndexQueue = new Queue(QUEUES.SEARCH_INDEX, { connection })

// Worker configuration per queue
const WORKER_CONFIG = {
  [QUEUES.EMAIL]: { concurrency: 5, attempts: 3, backoff: { type: 'exponential' as const, delay: 1000 } },
  [QUEUES.WEBHOOK]: { concurrency: 10, attempts: 3, backoff: { type: 'exponential' as const, delay: 1000 } },
  [QUEUES.REVIEW_REQUEST]: { concurrency: 3, attempts: 3, backoff: { type: 'exponential' as const, delay: 1000 } },
  [QUEUES.SEO_AUDIT]: { concurrency: 1, attempts: 2, backoff: { type: 'exponential' as const, delay: 1000 } },
  [QUEUES.ANALYTICS]: { concurrency: 1, attempts: 1, backoff: { type: 'exponential' as const, delay: 1000 } },
  [QUEUES.SEARCH_INDEX]: { concurrency: 5, attempts: 3, backoff: { type: 'exponential' as const, delay: 1000 } },
} as const

// Job type interfaces
export interface EmailJob {
  shopId: string
  toEmail: string
  subject: string
  htmlContent: string
  campaignId?: string
  automationId?: string
  customerId?: string
}

export interface WebhookJob {
  shopId: string
  topic: string
  payload: Record<string, unknown>
  webhookEventId: string
}

export interface ReviewRequestJob {
  shopId: string
  orderId: string
  customerEmail: string
  customerName: string
  productTitle: string
  shopName: string
  reviewRequestId: string
}

export interface SeoAuditJob {
  shopId: string
  productId?: string // If set, audit only this product
}

export interface AnalyticsJob {
  shopId: string
  date: string // ISO date string for the day to aggregate
}

export interface SearchIndexJob {
  shopId: string
  action: 'upsert' | 'delete'
  index: 'customers' | 'products'
  documentId: string
  document?: Record<string, unknown>
}

/**
 * Schedule the nightly analytics aggregation for every active shop.
 * Runs daily at 00:05 UTC and enqueues one AnalyticsJob per active shop
 * for the previous UTC day.
 *
 * The repeatable job itself is registered with a unique jobId
 * ("analytics-daily-aggregator") so BullMQ deduplicates across worker restarts.
 */
export async function scheduleAnalyticsCron() {
  // Register the repeatable scheduler
  await analyticsQueue.add(
    'analytics-daily-aggregator',
    { kind: 'scheduler' },
    {
      repeat: {
        // 5 minutes past midnight UTC every day — gives the day's events time
        // to land in postgres before aggregation.
        pattern: '5 0 * * *',
        tz: 'UTC',
      },
      jobId: 'analytics-daily-aggregator',
      removeOnComplete: 100,
      removeOnFail: 100,
    }
  )

  console.log(
    '🕛 Scheduled daily analytics aggregation (00:05 UTC via cron "5 0 * * *")'
  )
}

// Export worker config for use by individual worker files
export { WORKER_CONFIG, connection }

console.log('🚀 BullMQ workers initialized with queues:', Object.values(QUEUES).join(', '))

/**
 * Boot all worker factories and register repeatable jobs.
 * Called automatically when this file is launched as the main module
 * (via PM2's bullmq-workers process pointing at workers/dist/index.js).
 *
 * When the file is merely imported by Remix routes (to access the exported
 * queues), this function is NOT invoked — routes only need to enqueue jobs,
 * not process them.
 */
export async function startWorkers() {
  // Lazy-import worker factories so merely importing this module from routes
  // doesn't pull heavy PrismaClient/BullMQ Worker instances into the web tier.
  const { createEmailWorker } = await import('./email.worker')
  const { createWebhookWorker } = await import('./webhook.worker')
  const { createReviewWorker } = await import('./review.worker')
  const { createSeoWorker } = await import('./seo.worker')
  const { createAnalyticsWorker } = await import('./analytics.worker')
  const { createSearchWorker } = await import('./search.worker')

  createEmailWorker()
  createWebhookWorker()
  createReviewWorker()
  createSeoWorker()
  createAnalyticsWorker()
  createSearchWorker()

  await scheduleAnalyticsCron()

  console.log('✅ All BullMQ workers running')
}

// Only auto-boot when run as the main process (e.g. PM2 "bullmq-workers" app),
// not when imported by Remix routes for enqueueing.
// Use the ESM-friendly main-module check, falling back gracefully if unavailable.
const isMainModule = (() => {
  try {
    // In ESM, import.meta.url points at this file. When run directly,
    // process.argv[1] points at the same file (modulo file:// prefix).
    const entry = process.argv[1] ?? ''
    return (
      import.meta.url.endsWith(entry.replace(/\\/g, '/')) ||
      import.meta.url.endsWith('index.js') && entry.endsWith('index.js')
    )
  } catch {
    return false
  }
})()

if (isMainModule || process.env.WORKERS_ROLE === 'worker') {
  startWorkers().catch((err) => {
    console.error('❌ Failed to start workers:', err)
    process.exit(1)
  })
}
