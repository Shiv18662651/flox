// Analytics worker - nightly aggregation of raw events into daily summaries
// Requirements: 10.5, 10.6

import { Worker, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { connection, QUEUES, WORKER_CONFIG, analyticsQueue, type AnalyticsJob } from './index'

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

/**
 * Scheduler handler: fan out per-shop aggregation jobs for the previous UTC day.
 * Enqueued by the repeatable cron in workers/index.ts (pattern "5 0 * * *").
 */
async function handleSchedulerTick() {
  const yesterday = new Date()
  yesterday.setUTCHours(0, 0, 0, 0)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const dateIso = yesterday.toISOString().slice(0, 10) // YYYY-MM-DD

  const activeShops = await db.shop.findMany({
    where: { isActive: true },
    select: { id: true },
  })

  for (const shop of activeShops) {
    await analyticsQueue.add(
      'aggregate-day',
      { shopId: shop.id, date: dateIso },
      {
        // Dedupe per shop/day so a restart mid-fanout doesn't double-enqueue
        jobId: `aggregate-${shop.id}-${dateIso}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    )
  }

  console.log(
    `[analytics] scheduler: enqueued ${activeShops.length} shop aggregations for ${dateIso}`
  )
}

/**
 * Aggregates raw AnalyticsEvent records for a given date into AnalyticsDailySummary.
 * Groups by (shopId, date, source, medium).
 */
export async function aggregateAnalytics(job: Job<AnalyticsJob | { kind: 'scheduler' }>) {
  // Scheduler tick: fan out per-shop jobs and return
  const data = job.data as AnalyticsJob | { kind: 'scheduler' }
  if ('kind' in data && data.kind === 'scheduler') {
    await handleSchedulerTick()
    return
  }

  const { shopId, date } = data as AnalyticsJob

  const targetDate = new Date(date)
  targetDate.setUTCHours(0, 0, 0, 0)

  const nextDate = new Date(targetDate)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)

  console.log(`[analytics] Aggregating events for shop ${shopId} on ${date}`)

  // Fetch all events for this shop and date
  const events = await db.analyticsEvent.findMany({
    where: {
      shopId,
      createdAt: {
        gte: targetDate,
        lt: nextDate,
      },
    },
    select: {
      eventType: true,
      visitorId: true,
      revenue: true,
      orderId: true,
      source: true,
      medium: true,
    },
  })

  if (events.length === 0) {
    console.log(`[analytics] No events found for shop ${shopId} on ${date}`)
    return
  }

  // Group events by (source, medium)
  const groups = new Map<string, {
    source: string | null
    medium: string | null
    pageViews: number
    addToCarts: number
    totalOrders: number
    totalRevenue: number
    uniqueVisitors: Set<string>
    orderIds: Set<string>
  }>()

  for (const event of events) {
    const key = `${event.source || '__none__'}|${event.medium || '__none__'}`

    if (!groups.has(key)) {
      groups.set(key, {
        source: event.source || null,
        medium: event.medium || null,
        pageViews: 0,
        addToCarts: 0,
        totalOrders: 0,
        totalRevenue: 0,
        uniqueVisitors: new Set(),
        orderIds: new Set(),
      })
    }

    const group = groups.get(key)!

    group.uniqueVisitors.add(event.visitorId)

    switch (event.eventType) {
      case 'page_view':
        group.pageViews++
        break
      case 'add_to_cart':
        group.addToCarts++
        break
      case 'purchase':
        // Deduplicate by orderId
        if (event.orderId && !group.orderIds.has(event.orderId)) {
          group.orderIds.add(event.orderId)
          group.totalOrders++
          group.totalRevenue += event.revenue || 0
        }
        break
    }
  }

  // Upsert daily summaries for each group
  // Note: source/medium use empty string for null to work with the compound unique constraint
  for (const [, group] of groups) {
    const sourceVal = group.source || ''
    const mediumVal = group.medium || ''

    await db.analyticsDailySummary.upsert({
      where: {
        shopId_date_source_medium: {
          shopId,
          date: targetDate,
          source: sourceVal,
          medium: mediumVal,
        },
      },
      update: {
        pageViews: group.pageViews,
        addToCarts: group.addToCarts,
        totalOrders: group.totalOrders,
        totalRevenue: group.totalRevenue,
        uniqueVisitors: group.uniqueVisitors.size,
      },
      create: {
        shopId,
        date: targetDate,
        source: sourceVal,
        medium: mediumVal,
        pageViews: group.pageViews,
        addToCarts: group.addToCarts,
        totalOrders: group.totalOrders,
        totalRevenue: group.totalRevenue,
        uniqueVisitors: group.uniqueVisitors.size,
      },
    })
  }

  console.log(`[analytics] Aggregated ${events.length} events into ${groups.size} summaries for shop ${shopId} on ${date}`)
}

export function createAnalyticsWorker() {
  const config = WORKER_CONFIG[QUEUES.ANALYTICS]

  const worker = new Worker<AnalyticsJob | { kind: 'scheduler' }>(
    QUEUES.ANALYTICS,
    aggregateAnalytics,
    {
      connection,
      concurrency: config.concurrency,
    }
  )

  worker.on('completed', (job) => {
    console.log(`[analytics] Job ${job?.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[analytics] Job ${job?.id} failed:`, err.message)
    // TODO: Sentry.captureException(err)
  })

  return worker
}
