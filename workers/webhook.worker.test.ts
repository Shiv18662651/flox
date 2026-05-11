import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { WebhookJob } from './index'

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    webhookEvent = {
      findUnique: mockFindUnique,
      update: mockUpdate,
    }
  },
}))

// Mock the workers/index module
vi.mock('./index', () => ({
  connection: {},
  QUEUES: { WEBHOOK: 'webhook' },
  WORKER_CONFIG: {
    webhook: { concurrency: 10, attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  },
}))

// Mock bullmq Worker
vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor() {}
    on() { return this }
  },
}))

import { processWebhook, TOPIC_HANDLERS } from './webhook.worker'

function createMockJob(data: WebhookJob, overrides: Partial<Job<WebhookJob>> = {}): Job<WebhookJob> {
  return {
    id: 'test-job-1',
    data,
    attemptsMade: 0,
    ...overrides,
  } as unknown as Job<WebhookJob>
}

describe('webhook.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockResolvedValue({})
  })

  describe('idempotency', () => {
    it('skips processing when WebhookEvent is already processed', async () => {
      mockFindUnique.mockResolvedValue({ status: 'processed' })

      const job = createMockJob({
        shopId: 'shop-1',
        topic: 'ORDERS_CREATE',
        payload: { id: 'order-123' },
        webhookEventId: 'evt-1',
      })

      await processWebhook(job)

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        select: { status: true },
      })
      // Should NOT update the event (no processing occurred)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('processes event when status is pending', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })

      const job = createMockJob({
        shopId: 'shop-1',
        topic: 'ORDERS_CREATE',
        payload: { id: 'order-123' },
        webhookEventId: 'evt-2',
      })

      await processWebhook(job)

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'evt-2' },
        data: {
          status: 'processed',
          processedAt: expect.any(Date),
        },
      })
    })

    it('processes event when status is failed (retry scenario)', async () => {
      mockFindUnique.mockResolvedValue({ status: 'failed' })

      const job = createMockJob({
        shopId: 'shop-1',
        topic: 'ORDERS_PAID',
        payload: { id: 'order-456' },
        webhookEventId: 'evt-3',
      })

      await processWebhook(job)

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'evt-3' },
        data: {
          status: 'processed',
          processedAt: expect.any(Date),
        },
      })
    })

    it('processes event when no existing record is found', async () => {
      mockFindUnique.mockResolvedValue(null)

      const job = createMockJob({
        shopId: 'shop-1',
        topic: 'CUSTOMERS_CREATE',
        payload: { id: 'cust-1' },
        webhookEventId: 'evt-4',
      })

      await processWebhook(job)

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'evt-4' },
        data: {
          status: 'processed',
          processedAt: expect.any(Date),
        },
      })
    })
  })

  describe('topic routing', () => {
    it('routes ORDERS_CREATE to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const handlerSpy = vi.spyOn(
        { handler: TOPIC_HANDLERS.ORDERS_CREATE },
        'handler'
      )

      // We can't easily spy on the imported handler, so verify via console.log
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-1',
        topic: 'ORDERS_CREATE',
        payload: { id: 'order-1' },
        webhookEventId: 'evt-5',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] orders/create for shop shop-1')
      consoleSpy.mockRestore()
    })

    it('routes ORDERS_PAID to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-2',
        topic: 'ORDERS_PAID',
        payload: { id: 'order-2' },
        webhookEventId: 'evt-6',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] orders/paid for shop shop-2')
      consoleSpy.mockRestore()
    })

    it('routes ORDERS_FULFILLED to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-3',
        topic: 'ORDERS_FULFILLED',
        payload: { id: 'order-3' },
        webhookEventId: 'evt-7',
      })

      await processWebhook(job)

      // Without email in payload, handler logs a warning and skips
      expect(consoleSpy).toHaveBeenCalledWith('[webhook] orders/fulfilled missing email or orderId for shop shop-3')
      consoleSpy.mockRestore()
    })

    it('routes CUSTOMERS_CREATE to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-4',
        topic: 'CUSTOMERS_CREATE',
        payload: { id: 'cust-1' },
        webhookEventId: 'evt-8',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] customers/create for shop shop-4')
      consoleSpy.mockRestore()
    })

    it('routes CUSTOMERS_UPDATE to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-5',
        topic: 'CUSTOMERS_UPDATE',
        payload: { id: 'cust-2' },
        webhookEventId: 'evt-9',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] customers/update for shop shop-5')
      consoleSpy.mockRestore()
    })

    it('routes CHECKOUTS_UPDATE to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-6',
        topic: 'CHECKOUTS_UPDATE',
        payload: { id: 'checkout-1' },
        webhookEventId: 'evt-10',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] checkouts/update for shop shop-6')
      consoleSpy.mockRestore()
    })

    it('routes PRODUCTS_CREATE to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-7',
        topic: 'PRODUCTS_CREATE',
        payload: { id: 'prod-1' },
        webhookEventId: 'evt-11',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] products/create for shop shop-7')
      consoleSpy.mockRestore()
    })

    it('routes PRODUCTS_UPDATE to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-8',
        topic: 'PRODUCTS_UPDATE',
        payload: { id: 'prod-2' },
        webhookEventId: 'evt-12',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] products/update for shop shop-8')
      consoleSpy.mockRestore()
    })

    it('routes PRODUCTS_DELETE to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-9',
        topic: 'PRODUCTS_DELETE',
        payload: { id: 'prod-3' },
        webhookEventId: 'evt-13',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] products/delete for shop shop-9')
      consoleSpy.mockRestore()
    })

    it('routes APP_UNINSTALLED to the correct handler', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-10',
        topic: 'APP_UNINSTALLED',
        payload: {},
        webhookEventId: 'evt-14',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] app/uninstalled for shop shop-10')
      consoleSpy.mockRestore()
    })

    it('handles unknown topics gracefully without throwing', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const job = createMockJob({
        shopId: 'shop-11',
        topic: 'UNKNOWN_TOPIC',
        payload: {},
        webhookEventId: 'evt-15',
      })

      await processWebhook(job)

      expect(consoleSpy).toHaveBeenCalledWith('[webhook] No handler for topic: UNKNOWN_TOPIC')
      // Should still mark as processed
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'evt-15' },
        data: {
          status: 'processed',
          processedAt: expect.any(Date),
        },
      })
      consoleSpy.mockRestore()
    })
  })

  describe('success handling', () => {
    it('marks event as processed with processedAt timestamp on success', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })

      const job = createMockJob({
        shopId: 'shop-1',
        topic: 'ORDERS_CREATE',
        payload: { id: 'order-1' },
        webhookEventId: 'evt-16',
      })

      const beforeProcess = new Date()
      await processWebhook(job)

      expect(mockUpdate).toHaveBeenCalledTimes(1)
      const updateCall = mockUpdate.mock.calls[0][0]
      expect(updateCall.where.id).toBe('evt-16')
      expect(updateCall.data.status).toBe('processed')
      expect(updateCall.data.processedAt).toBeInstanceOf(Date)
      expect(updateCall.data.processedAt.getTime()).toBeGreaterThanOrEqual(beforeProcess.getTime())
    })
  })

  describe('failure handling', () => {
    it('throws error when handler fails, allowing BullMQ retry', async () => {
      mockFindUnique.mockResolvedValue({ status: 'pending' })
      // Simulate a handler failure by making the update throw after handler succeeds
      // Actually, let's test by making the handler throw
      const originalHandler = TOPIC_HANDLERS.ORDERS_CREATE
      TOPIC_HANDLERS.ORDERS_CREATE = vi.fn().mockRejectedValue(new Error('Handler failed'))

      const job = createMockJob({
        shopId: 'shop-1',
        topic: 'ORDERS_CREATE',
        payload: { id: 'order-1' },
        webhookEventId: 'evt-17',
      })

      await expect(processWebhook(job)).rejects.toThrow('Handler failed')

      // Should NOT mark as processed since handler threw
      expect(mockUpdate).not.toHaveBeenCalled()

      // Restore handler
      TOPIC_HANDLERS.ORDERS_CREATE = originalHandler
    })
  })

  describe('TOPIC_HANDLERS mapping', () => {
    it('has handlers for all expected topics', () => {
      const expectedTopics = [
        'ORDERS_CREATE',
        'ORDERS_PAID',
        'ORDERS_FULFILLED',
        'CUSTOMERS_CREATE',
        'CUSTOMERS_UPDATE',
        'CHECKOUTS_UPDATE',
        'PRODUCTS_CREATE',
        'PRODUCTS_UPDATE',
        'PRODUCTS_DELETE',
        'APP_UNINSTALLED',
      ]

      for (const topic of expectedTopics) {
        expect(TOPIC_HANDLERS[topic]).toBeDefined()
        expect(typeof TOPIC_HANDLERS[topic]).toBe('function')
      }
    })
  })
})
