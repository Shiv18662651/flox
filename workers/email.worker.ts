// Email worker - sends marketing and transactional emails via Brevo
// Requirements: 7.4, 7.13, 7.14

import { Worker, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { connection, QUEUES, WORKER_CONFIG, type EmailJob } from './index'

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

/**
 * Process an EMAIL job:
 * 1. Send email via Brevo API
 * 2. Store brevoMessageId on EmailSend record
 * 3. Update status to "sent" on success, "failed" on failure
 */
export async function processEmailJob(job: Job<EmailJob>) {
  const { shopId, toEmail, subject, htmlContent, campaignId, automationId, customerId } = job.data

  // Find the EmailSend record for this job
  const emailSend = await db.emailSend.findFirst({
    where: {
      shopId,
      toEmail,
      subject,
      status: 'queued',
      ...(campaignId ? { campaignId } : {}),
      ...(automationId ? { automationId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!emailSend) {
    console.warn(`[email-worker] No queued EmailSend found for ${toEmail} in shop ${shopId}`)
    return
  }

  try {
    // Send via Brevo API
    const apiKey = process.env.BREVO_API_KEY
    const senderEmail = process.env.BREVO_SENDER_EMAIL
    const senderName = process.env.BREVO_SENDER_NAME

    if (!apiKey || !senderEmail || !senderName) {
      throw new Error('Missing Brevo configuration')
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: toEmail }],
        subject,
        htmlContent,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Brevo API error (${response.status}): ${errorBody}`)
    }

    const data = await response.json() as { messageId: string }

    // Update EmailSend with success
    await db.emailSend.update({
      where: { id: emailSend.id },
      data: {
        status: 'sent',
        brevoMessageId: data.messageId,
      },
    })

    console.log(`[email-worker] Sent email to ${toEmail}, messageId: ${data.messageId}`)
  } catch (error) {
    // Update EmailSend with failure
    await db.emailSend.update({
      where: { id: emailSend.id },
      data: { status: 'failed' },
    })

    // Re-throw to trigger BullMQ retry
    throw error
  }
}

export function createEmailWorker() {
  const config = WORKER_CONFIG[QUEUES.EMAIL]

  const worker = new Worker<EmailJob>(
    QUEUES.EMAIL,
    processEmailJob,
    {
      connection,
      concurrency: config.concurrency,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: config.backoff,
      },
    }
  )

  worker.on('completed', (job) => {
    console.log(`[email-worker] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    if (job) {
      console.error(`[email-worker] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`)
    }
  })

  return worker
}

// Export for testing
export { db }
