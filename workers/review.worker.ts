// Review request worker - sends review request emails after order fulfillment
// Requirements: 4.1, 4.2

import { Worker, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { connection, QUEUES, WORKER_CONFIG, type ReviewRequestJob } from './index'
import { sendEmail } from '../app/utils/brevo.server'

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

/**
 * Build the review request email HTML content.
 */
export function buildReviewEmailHtml(params: {
  customerName: string
  productTitle: string
  reviewLink: string
}): string {
  const { customerName, productTitle, reviewLink } = params
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2>How was your purchase?</h2>
  <p>Hi ${customerName},</p>
  <p>We'd love to hear about your experience with ${productTitle}.</p>
  <a href="${reviewLink}" style="display: inline-block; background-color: #4F46E5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Write a Review</a>
  <p style="margin-top: 20px; color: #6B7280; font-size: 14px;">Thank you for your purchase!</p>
</body>
</html>`
}

/**
 * Process a review request job:
 * 1. Look up the ReviewRequest record
 * 2. Send email via Brevo with tokenized review link
 * 3. Update status to "sent" and set sentAt
 */
export async function processReviewRequest(job: Job<ReviewRequestJob>) {
  const { reviewRequestId, customerEmail, customerName, productTitle, shopName } = job.data

  // Look up the ReviewRequest record
  const reviewRequest = await db.reviewRequest.findUnique({
    where: { id: reviewRequestId },
  })

  if (!reviewRequest) {
    console.warn(`[review] ReviewRequest ${reviewRequestId} not found, skipping`)
    return
  }

  // Skip if already sent or reviewed
  if (reviewRequest.status !== 'pending') {
    console.log(`[review] ReviewRequest ${reviewRequestId} already in status "${reviewRequest.status}", skipping`)
    return
  }

  const appUrl = process.env.SHOPIFY_APP_URL || ''
  const reviewLink = `${appUrl}/api/reviews?token=${reviewRequest.token}`

  const subject = `${shopName ? shopName + ': ' : ''}How was your purchase?`
  const htmlContent = buildReviewEmailHtml({
    customerName,
    productTitle,
    reviewLink,
  })

  // Send email via Brevo - throws on error to allow BullMQ retry
  await sendEmail(customerEmail, subject, htmlContent)

  // Update ReviewRequest status to "sent"
  await db.reviewRequest.update({
    where: { id: reviewRequestId },
    data: {
      status: 'sent',
      sentAt: new Date(),
    },
  })

  console.log(`[review] Sent review request email to ${customerEmail} for ReviewRequest ${reviewRequestId}`)
}

export function createReviewWorker() {
  const config = WORKER_CONFIG[QUEUES.REVIEW_REQUEST]

  const worker = new Worker<ReviewRequestJob>(
    QUEUES.REVIEW_REQUEST,
    processReviewRequest,
    {
      connection,
      concurrency: config.concurrency,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: config.backoff,
      },
    }
  )

  worker.on('failed', (job, err) => {
    if (job) {
      console.error(`[review] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`)
    }
  })

  return worker
}

// Export for testing
export { db }
