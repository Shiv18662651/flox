// Webhook worker - processes Shopify webhooks with idempotency
// Requirements: 13.3, 13.4, 13.5, 13.6, 13.7

import { Worker, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { connection, QUEUES, WORKER_CONFIG, reviewRequestQueue, emailQueue, seoAuditQueue, searchIndexQueue, type WebhookJob } from './index'
import { renderEmailHtml, injectTracking, injectUnsubscribeLink, type EmailBlock } from '../app/utils/email-renderer.server'

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

// Topic handler type
type TopicHandler = (shopId: string, payload: Record<string, unknown>) => Promise<void>

// Handler stubs — will be implemented in later tasks
async function handleOrderCreated(shopId: string, payload: Record<string, unknown>) {
  // FOMO event is emitted in real-time from the webhook route (api.webhooks.tsx)
  // before enqueueing to BullMQ, since the route runs in the Remix process with Socket.io access.
  // Task 15.1: Record analytics event
  console.log(`[webhook] orders/create for shop ${shopId}`)
}

async function handleOrderPaid(shopId: string, payload: Record<string, unknown>) {
  // Task 13.1: Calculate and award loyalty points
  const orderId = String(payload.id || '')
  const subtotal = parseFloat(String(payload.subtotal_price || '0'))
  const shopifyCustomerId = String((payload.customer as Record<string, unknown>)?.id || '')

  if (shopifyCustomerId && subtotal > 0) {
    try {
      // Look up loyalty program for this shop
      const loyaltyProgram = await db.loyaltyProgram.findUnique({
        where: { shopId },
      })

      if (loyaltyProgram && loyaltyProgram.isActive) {
        // Find the customer record
        const customer = await db.customer.findFirst({
          where: { shopId, shopifyId: shopifyCustomerId },
          select: { id: true, loyaltyPoints: true },
        })

        if (customer) {
          const pointsEarned = Math.floor(subtotal * loyaltyProgram.pointsPerDollar)

          if (pointsEarned > 0) {
            // Create earn transaction and update balance
            await db.$transaction([
              db.loyaltyTransaction.create({
                data: {
                  shopId,
                  customerId: customer.id,
                  programId: loyaltyProgram.id,
                  type: 'earn',
                  points: pointsEarned,
                  reason: `Order #${orderId} - ${subtotal} × ${loyaltyProgram.pointsPerDollar} pts/$`,
                  orderId,
                },
              }),
              db.customer.update({
                where: { id: customer.id },
                data: {
                  loyaltyPoints: { increment: pointsEarned },
                },
              }),
            ])

            // Assign VIP tier if tiers are configured
            if (loyaltyProgram.tiers) {
              const newBalance = customer.loyaltyPoints + pointsEarned
              const tiers = loyaltyProgram.tiers as Array<{ name: string; minPoints: number }>
              if (tiers.length > 0) {
                const sortedTiers = [...tiers].sort((a, b) => b.minPoints - a.minPoints)
                const qualifyingTier = sortedTiers.find(t => newBalance >= t.minPoints)
                await db.customer.update({
                  where: { id: customer.id },
                  data: { loyaltyTier: qualifyingTier?.name || null },
                })
              }
            }

            console.log(`[webhook] orders/paid: awarded ${pointsEarned} points to customer ${customer.id}`)
          }
        }
      }
    } catch (error) {
      console.error(`[webhook] orders/paid loyalty error:`, error)
    }
  }

  // Task 17.2: Handle referral purchase (Req 11.5, 11.6)
  if (shopifyCustomerId) {
    try {
      const customer = await db.customer.findFirst({
        where: { shopId, shopifyId: shopifyCustomerId },
        select: { id: true, referredBy: true, totalOrders: true },
      })

      // Only trigger on first purchase (totalOrders was 0 before this order)
      if (customer && customer.referredBy && customer.totalOrders <= 1) {
        const signedUpReferral = await db.referral.findFirst({
          where: {
            shopId,
            referredCustomerId: customer.id,
            status: 'signed_up',
          },
          include: { program: true },
        })

        if (signedUpReferral) {
          const { randomBytes } = await import('crypto')
          const discountCode = `REF-${randomBytes(4).toString('hex').toUpperCase()}`

          // Attempt to create a real Shopify discount code for the advocate's reward.
          // Non-blocking: referral status still advances to 'purchased' even if Shopify call fails.
          try {
            const shop = await db.shop.findUnique({
              where: { id: shopId },
              select: { shopDomain: true, accessToken: true },
            })

            if (shop?.shopDomain && shop.accessToken) {
              const { createShopAdminClient } = await import('../app/utils/shopify-admin-client')
              const { createDiscountCode } = await import('../app/utils/discount.server')
              const admin = createShopAdminClient(shop.shopDomain, shop.accessToken)
              const advocateReward = signedUpReferral.program?.advocateReward ?? 10
              const discountResult = await createDiscountCode(admin, {
                code: discountCode,
                title: `Referral advocate reward: $${advocateReward}`,
                valueType: 'fixed_amount',
                value: advocateReward,
                oncePerCustomer: true,
                usageLimit: 1,
              })
              if (!discountResult.success) {
                console.error(
                  `[webhook] referral discount creation failed for ${discountCode}: ${discountResult.error}`
                )
              }
            }
          } catch (discountErr) {
            console.error(
              `[webhook] orders/paid referral discount error:`,
              discountErr
            )
          }

          // Update referral status to purchased
          await db.referral.update({
            where: { id: signedUpReferral.id },
            data: {
              status: 'purchased',
              discountCode,
              orderId,
            },
          })

          // Award loyalty points to the referrer (Req 11.6)
          const loyaltyProg = await db.loyaltyProgram.findUnique({
            where: { shopId },
          })

          if (loyaltyProg && loyaltyProg.isActive && loyaltyProg.pointsForReferral > 0) {
            await db.$transaction([
              db.loyaltyTransaction.create({
                data: {
                  shopId,
                  customerId: signedUpReferral.referrerCustomerId,
                  programId: loyaltyProg.id,
                  type: 'earn',
                  points: loyaltyProg.pointsForReferral,
                  reason: 'Referral reward - friend completed purchase',
                  orderId,
                },
              }),
              db.customer.update({
                where: { id: signedUpReferral.referrerCustomerId },
                data: {
                  loyaltyPoints: { increment: loyaltyProg.pointsForReferral },
                },
              }),
            ])

            console.log(`[webhook] orders/paid: awarded ${loyaltyProg.pointsForReferral} referral points to customer ${signedUpReferral.referrerCustomerId}`)
          }
        }
      }
    } catch (error) {
      console.error(`[webhook] orders/paid referral purchase error:`, error)
    }
  }

  // Task 15.1: Record purchase analytics event
  try {
    const landingSite = (payload.landing_site as string) || ''
    let utmSource: string | null = null
    let utmMedium: string | null = null
    let utmCampaign: string | null = null

    // Extract UTM params from the order's landing_site URL
    if (landingSite) {
      try {
        const url = new URL(landingSite, 'https://placeholder.com')
        utmSource = url.searchParams.get('utm_source')
        utmMedium = url.searchParams.get('utm_medium')
        utmCampaign = url.searchParams.get('utm_campaign')
      } catch {
        // Invalid URL — skip UTM extraction
      }
    }

    const revenue = parseFloat(String(payload.total_price || '0'))

    await db.analyticsEvent.create({
      data: {
        shopId,
        sessionId: String(payload.checkout_token || payload.token || orderId),
        visitorId: shopifyCustomerId || 'unknown',
        eventType: 'purchase',
        orderId,
        revenue: revenue || null,
        source: utmSource,
        medium: utmMedium,
        campaign: utmCampaign,
        userAgent: (payload.browser_ip as string) || null,
        ipAddress: (payload.browser_ip as string) || null,
      },
    })

    console.log(`[webhook] orders/paid: recorded purchase analytics event for order ${orderId}`)
  } catch (error) {
    console.error(`[webhook] orders/paid analytics event error:`, error)
    // Non-blocking — don't fail the webhook for analytics
  }

  console.log(`[webhook] orders/paid for shop ${shopId}`)
}

async function handleOrderFulfilled(shopId: string, payload: Record<string, unknown>) {
  // Task 7.1: Schedule review request
  const orderId = String(payload.id || '')
  const customerEmail = (payload.email as string) || (payload.contact_email as string) || ''
  const customerName = (payload.customer as Record<string, unknown>)?.first_name as string || 'Customer'
  const shopName = (payload.shop_name as string) || ''

  // Extract first line item product title
  const lineItems = (payload.line_items as Array<Record<string, unknown>>) || []
  const productTitle = (lineItems[0]?.title as string) || 'your order'

  if (!customerEmail || !orderId) {
    console.warn(`[webhook] orders/fulfilled missing email or orderId for shop ${shopId}`)
    return
  }

  // Default delay: 7 days
  const REVIEW_REQUEST_DELAY_MS = 7 * 24 * 60 * 60 * 1000

  // Create ReviewRequest record with status "pending"
  const reviewRequest = await db.reviewRequest.create({
    data: {
      shopId,
      orderId,
      customerEmail,
      status: 'pending',
      scheduledAt: new Date(Date.now() + REVIEW_REQUEST_DELAY_MS),
    },
  })

  // Enqueue REVIEW_REQUEST job with 7-day delay
  await reviewRequestQueue.add(
    'review-request',
    {
      shopId,
      orderId,
      customerEmail,
      customerName,
      productTitle,
      shopName,
      reviewRequestId: reviewRequest.id,
    },
    { delay: REVIEW_REQUEST_DELAY_MS }
  )

  console.log(`[webhook] orders/fulfilled: scheduled review request ${reviewRequest.id} for shop ${shopId}`)
}

async function handleCustomerCreated(shopId: string, payload: Record<string, unknown>) {
  // Task 11.5: Welcome email automation
  const customerEmail = (payload.email as string) || ''
  const shopifyCustomerId = String(payload.id || '')

  if (customerEmail && shopifyCustomerId) {
    try {
      // Check if there's an active welcome automation for this shop
      const welcomeAutomation = await db.automation.findFirst({
        where: { shopId, trigger: 'welcome', isActive: true },
      })

      if (welcomeAutomation) {
        // Check if customer is subscribed
        const customer = await db.customer.findFirst({
          where: { shopId, shopifyId: shopifyCustomerId },
          select: { id: true, isSubscribed: true },
        })

        if (customer && customer.isSubscribed) {
          const baseUrl = process.env.SHOPIFY_APP_URL || 'https://app.example.com'
          const htmlContent = welcomeAutomation.templateHtml || renderEmailHtml(welcomeAutomation.templateJson as unknown as EmailBlock[])

          // Create EmailSend record
          const emailSend = await db.emailSend.create({
            data: {
              shopId,
              customerId: customer.id,
              automationId: welcomeAutomation.id,
              toEmail: customerEmail,
              subject: welcomeAutomation.subject,
              status: 'queued',
            },
          })

          // Inject tracking and unsubscribe
          const finalHtml = injectUnsubscribeLink(
            injectTracking(htmlContent, emailSend.id, baseUrl),
            customer.id,
            baseUrl
          )

          // Enqueue with configured delay
          await emailQueue.add(
            'welcome-email',
            {
              shopId,
              toEmail: customerEmail,
              subject: welcomeAutomation.subject,
              htmlContent: finalHtml,
              automationId: welcomeAutomation.id,
              customerId: customer.id,
            },
            { delay: welcomeAutomation.delayMinutes * 60 * 1000 }
          )

          // Increment automation sent count
          await db.automation.update({
            where: { id: welcomeAutomation.id },
            data: { totalSent: { increment: 1 } },
          })

          console.log(`[webhook] customers/create: enqueued welcome email for ${customerEmail}`)
        }
      }
    } catch (error) {
      console.error(`[webhook] customers/create welcome email error:`, error)
    }
  }

  // Task 13.1: Loyalty signup bonus
  if (shopifyCustomerId) {
    try {
      const loyaltyProgram = await db.loyaltyProgram.findUnique({
        where: { shopId },
      })

      if (loyaltyProgram && loyaltyProgram.isActive && loyaltyProgram.pointsForSignup > 0) {
        const customer = await db.customer.findFirst({
          where: { shopId, shopifyId: shopifyCustomerId },
          select: { id: true, loyaltyPoints: true },
        })

        if (customer) {
          await db.$transaction([
            db.loyaltyTransaction.create({
              data: {
                shopId,
                customerId: customer.id,
                programId: loyaltyProgram.id,
                type: 'earn',
                points: loyaltyProgram.pointsForSignup,
                reason: 'Signup bonus',
              },
            }),
            db.customer.update({
              where: { id: customer.id },
              data: {
                loyaltyPoints: { increment: loyaltyProgram.pointsForSignup },
              },
            }),
          ])

          console.log(`[webhook] customers/create: awarded ${loyaltyProgram.pointsForSignup} signup points to customer ${customer.id}`)
        }
      }
    } catch (error) {
      console.error(`[webhook] customers/create loyalty signup error:`, error)
    }
  }

  // Task 19.1: Search index upsert
  if (shopifyCustomerId) {
    try {
      const firstName = (payload.first_name as string) || ''
      const lastName = (payload.last_name as string) || ''
      const phone = (payload.phone as string) || ''

      await searchIndexQueue.add('search-index', {
        shopId,
        action: 'upsert',
        index: 'customers',
        documentId: shopifyCustomerId,
        document: {
          shopId,
          email: customerEmail,
          firstName,
          lastName,
          phone,
          shopifyId: shopifyCustomerId,
        },
      })
      console.log(`[webhook] customers/create: enqueued search index upsert for customer ${shopifyCustomerId}`)
    } catch (error) {
      console.error(`[webhook] customers/create search index error:`, error)
    }
  }

  // Task 17.1: Generate referral code for new customer (Req 11.2)
  if (shopifyCustomerId) {
    try {
      const referralProgram = await db.referralProgram.findUnique({
        where: { shopId },
        select: { id: true, isActive: true },
      })

      if (referralProgram && referralProgram.isActive) {
        const customer = await db.customer.findFirst({
          where: { shopId, shopifyId: shopifyCustomerId },
          select: { id: true, referralCode: true, email: true, referredBy: true },
        })

        if (customer && !customer.referralCode) {
          // Generate unique referral code
          const { randomBytes } = await import('crypto')
          let code: string = ''
          for (let i = 0; i < 5; i++) {
            code = randomBytes(4).toString('hex')
            const existing = await db.customer.findFirst({
              where: { referralCode: code },
              select: { id: true },
            })
            if (!existing) break
          }
          if (code) {
            await db.customer.update({
              where: { id: customer.id },
              data: { referralCode: code },
            })
            console.log(`[webhook] customers/create: generated referral code ${code} for customer ${customer.id}`)
          }
        }

        // Task 17.2: Handle referral signup tracking (Req 11.4)
        // If this customer was referred, update the Referral record
        if (customer && customer.email) {
          const pendingReferral = await db.referral.findFirst({
            where: {
              shopId,
              status: 'pending',
              referredEmail: customer.email,
            },
          })

          if (pendingReferral) {
            await db.referral.update({
              where: { id: pendingReferral.id },
              data: {
                status: 'signed_up',
                referredCustomerId: customer.id,
              },
            })

            // Find the referrer's referral code to store in referredBy
            const referrer = await db.customer.findFirst({
              where: { id: pendingReferral.referrerCustomerId },
              select: { referralCode: true },
            })

            if (referrer?.referralCode) {
              await db.customer.update({
                where: { id: customer.id },
                data: { referredBy: referrer.referralCode },
              })
            }

            console.log(`[webhook] customers/create: updated referral ${pendingReferral.id} to signed_up`)
          }
        }
      }
    } catch (error) {
      console.error(`[webhook] customers/create referral code error:`, error)
    }
  }

  console.log(`[webhook] customers/create for shop ${shopId}`)
}

async function handleCustomerUpdated(shopId: string, payload: Record<string, unknown>) {
  // Task 19.1: Search index update
  const shopifyCustomerId = String(payload.id || '')
  const customerEmail = (payload.email as string) || ''
  const firstName = (payload.first_name as string) || ''
  const lastName = (payload.last_name as string) || ''
  const phone = (payload.phone as string) || ''

  if (shopifyCustomerId) {
    try {
      await searchIndexQueue.add('search-index', {
        shopId,
        action: 'upsert',
        index: 'customers',
        documentId: shopifyCustomerId,
        document: {
          shopId,
          email: customerEmail,
          firstName,
          lastName,
          phone,
          shopifyId: shopifyCustomerId,
        },
      })
      console.log(`[webhook] customers/update: enqueued search index upsert for customer ${shopifyCustomerId}`)
    } catch (error) {
      console.error(`[webhook] customers/update search index error:`, error)
    }
  }

  console.log(`[webhook] customers/update for shop ${shopId}`)
}

async function handleCheckoutUpdated(shopId: string, payload: Record<string, unknown>) {
  // Task 11.5: Abandoned cart email
  const abandonedCheckoutUrl = payload.abandoned_checkout_url as string | undefined
  const customerEmail = (payload.email as string) || ''

  // Only trigger if checkout appears abandoned (has abandoned_checkout_url or no completed_at)
  if (customerEmail && !payload.completed_at && abandonedCheckoutUrl) {
    try {
      // Check if there's an active abandoned_cart automation
      const cartAutomation = await db.automation.findFirst({
        where: { shopId, trigger: 'abandoned_cart', isActive: true },
      })

      if (cartAutomation) {
        // Find the customer
        const customer = await db.customer.findFirst({
          where: { shopId, email: customerEmail },
          select: { id: true, isSubscribed: true },
        })

        // Suppression check: never enqueue for unsubscribed customers
        if (customer && customer.isSubscribed) {
          const baseUrl = process.env.SHOPIFY_APP_URL || 'https://app.example.com'
          const htmlContent = cartAutomation.templateHtml || renderEmailHtml(cartAutomation.templateJson as unknown as EmailBlock[])

          // Create EmailSend record
          const emailSend = await db.emailSend.create({
            data: {
              shopId,
              customerId: customer.id,
              automationId: cartAutomation.id,
              toEmail: customerEmail,
              subject: cartAutomation.subject,
              status: 'queued',
            },
          })

          // Inject tracking and unsubscribe
          const finalHtml = injectUnsubscribeLink(
            injectTracking(htmlContent, emailSend.id, baseUrl),
            customer.id,
            baseUrl
          )

          // Enqueue with configured delay
          await emailQueue.add(
            'abandoned-cart-email',
            {
              shopId,
              toEmail: customerEmail,
              subject: cartAutomation.subject,
              htmlContent: finalHtml,
              automationId: cartAutomation.id,
              customerId: customer.id,
            },
            { delay: cartAutomation.delayMinutes * 60 * 1000 }
          )

          // Increment automation sent count
          await db.automation.update({
            where: { id: cartAutomation.id },
            data: { totalSent: { increment: 1 } },
          })

          console.log(`[webhook] checkouts/update: enqueued abandoned cart email for ${customerEmail}`)
        }
      }
    } catch (error) {
      console.error(`[webhook] checkouts/update abandoned cart error:`, error)
    }
  }

  console.log(`[webhook] checkouts/update for shop ${shopId}`)
}

async function handleProductCreated(shopId: string, payload: Record<string, unknown>) {
  // Task 19.1: Search index upsert
  const productId = String(payload.id || '')
  if (productId) {
    try {
      const title = (payload.title as string) || ''
      const vendor = (payload.vendor as string) || ''
      const productType = (payload.product_type as string) || ''
      const tags = (payload.tags as string) || ''

      await searchIndexQueue.add('search-index', {
        shopId,
        action: 'upsert',
        index: 'products',
        documentId: productId,
        document: {
          shopId,
          title,
          vendor,
          productType,
          tags,
          shopifyId: productId,
        },
      })
      console.log(`[webhook] products/create: enqueued search index upsert for product ${productId}`)
    } catch (error) {
      console.error(`[webhook] products/create search index error:`, error)
    }
  }

  // Task 18.3: SEO check - enqueue targeted SEO audit for this product (Req 12.8)
  if (productId) {
    try {
      await seoAuditQueue.add('seo-audit-product', { shopId, productId })
      console.log(`[webhook] products/create: enqueued SEO check for product ${productId}`)
    } catch (error) {
      console.error(`[webhook] products/create SEO enqueue error:`, error)
    }
  }
  console.log(`[webhook] products/create for shop ${shopId}`)
}

async function handleProductUpdated(shopId: string, payload: Record<string, unknown>) {
  // Task 19.1: Search index upsert
  const productId = String(payload.id || '')
  if (productId) {
    try {
      const title = (payload.title as string) || ''
      const vendor = (payload.vendor as string) || ''
      const productType = (payload.product_type as string) || ''
      const tags = (payload.tags as string) || ''

      await searchIndexQueue.add('search-index', {
        shopId,
        action: 'upsert',
        index: 'products',
        documentId: productId,
        document: {
          shopId,
          title,
          vendor,
          productType,
          tags,
          shopifyId: productId,
        },
      })
      console.log(`[webhook] products/update: enqueued search index upsert for product ${productId}`)
    } catch (error) {
      console.error(`[webhook] products/update search index error:`, error)
    }
  }

  // Task 18.3: SEO check - enqueue targeted SEO audit for this product (Req 12.8)
  if (productId) {
    try {
      await seoAuditQueue.add('seo-audit-product', { shopId, productId })
      console.log(`[webhook] products/update: enqueued SEO check for product ${productId}`)
    } catch (error) {
      console.error(`[webhook] products/update SEO enqueue error:`, error)
    }
  }
  console.log(`[webhook] products/update for shop ${shopId}`)
}

async function handleProductDeleted(shopId: string, payload: Record<string, unknown>) {
  // Task 19.1: Search index removal
  const productId = String(payload.id || '')
  if (productId) {
    try {
      await searchIndexQueue.add('search-index', {
        shopId,
        action: 'delete',
        index: 'products',
        documentId: productId,
      })
      console.log(`[webhook] products/delete: enqueued search index removal for product ${productId}`)
    } catch (error) {
      console.error(`[webhook] products/delete search index error:`, error)
    }
  }
  console.log(`[webhook] products/delete for shop ${shopId}`)
}

async function handleAppUninstalled(shopId: string, payload: Record<string, unknown>) {
  // Task 2.4: Mark shop as inactive
  console.log(`[webhook] app/uninstalled for shop ${shopId}`)
}

// Topic to handler mapping
const TOPIC_HANDLERS: Record<string, TopicHandler> = {
  ORDERS_CREATE: handleOrderCreated,
  ORDERS_PAID: handleOrderPaid,
  ORDERS_FULFILLED: handleOrderFulfilled,
  CUSTOMERS_CREATE: handleCustomerCreated,
  CUSTOMERS_UPDATE: handleCustomerUpdated,
  CHECKOUTS_UPDATE: handleCheckoutUpdated,
  PRODUCTS_CREATE: handleProductCreated,
  PRODUCTS_UPDATE: handleProductUpdated,
  PRODUCTS_DELETE: handleProductDeleted,
  APP_UNINSTALLED: handleAppUninstalled,
}

/**
 * Process a webhook job with idempotency check.
 * - Skips if the WebhookEvent is already marked as 'processed'
 * - Routes to the appropriate topic handler
 * - Marks as 'processed' on success
 * - Marks as 'failed' on error (BullMQ handles retry)
 */
export async function processWebhook(job: Job<WebhookJob>) {
  const { shopId, topic, payload, webhookEventId } = job.data

  // Idempotency check: skip if already processed
  const existing = await db.webhookEvent.findUnique({
    where: { id: webhookEventId },
    select: { status: true },
  })

  if (existing?.status === 'processed') {
    console.log(`[webhook] Skipping already-processed event: ${webhookEventId}`)
    return
  }

  // Route to appropriate handler
  const handler = TOPIC_HANDLERS[topic]
  if (handler) {
    await handler(shopId, payload as Record<string, unknown>)
  } else {
    console.warn(`[webhook] No handler for topic: ${topic}`)
  }

  // Mark as processed
  await db.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      status: 'processed',
      processedAt: new Date(),
    },
  })
}

export function createWebhookWorker() {
  const config = WORKER_CONFIG[QUEUES.WEBHOOK]

  const worker = new Worker<WebhookJob>(
    QUEUES.WEBHOOK,
    processWebhook,
    {
      connection,
      concurrency: config.concurrency,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: config.backoff,
      },
    }
  )

  worker.on('failed', async (job, err) => {
    if (job) {
      const { webhookEventId } = job.data

      try {
        await db.webhookEvent.update({
          where: { id: webhookEventId },
          data: {
            status: 'failed',
            error: err.message,
          },
        })
      } catch (updateErr) {
        console.error(`[webhook] Failed to update event status for ${webhookEventId}:`, updateErr)
      }

      // After final retry, fire Sentry alert (placeholder)
      if (job.attemptsMade >= (config.attempts || 3)) {
        console.error(
          `[webhook] Job ${job.id} moved to dead-letter after ${job.attemptsMade} attempts: ${err.message}`
        )
        // TODO: Sentry.captureException(err, { extra: { webhookEventId, topic: job.data.topic } })
      }
    }
  })

  return worker
}

// Export for testing
export { TOPIC_HANDLERS, db }
