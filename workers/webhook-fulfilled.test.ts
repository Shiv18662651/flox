import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { WebhookJob } from './index'

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const { mockFindUnique, mockUpdate, mockCreate, mockQueueAdd } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockQueueAdd: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    webhookEvent = {
      findUnique: mockFindUnique,
      update: mockUpdate,
    }
    reviewRequest = {
      create: mockCreate,
    }
  },
}))

vi.mock('./index', () => ({
  connection: {},
  QUEUES: { WEBHOOK: 'webhook', REVIEW_REQUEST: 'review-request' },
  WORKER_CONFIG: {
    webhook: { concurrency: 10, attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  },
  reviewRequestQueue: { add: mockQueueAdd },
}))

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor() {}
    on() { return this }
  },
}))

import { processWebhook } from './webhook.worker'

function createMockJob(data: WebhookJob): Job<WebhookJob> {
  return {
    id: 'test-job-1',
    data,
    attemptsMade: 0,
  } as unknown as Job<WebhookJob>
}

describe('handleOrderFulfilled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue({ status: 'pending' })
    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({
      id: 'rr-new-1',
      shopId: 'shop-1',
      orderId: '12345',
      customerEmail: 'alice@example.com',
      token: 'generated-token',
      status: 'pending',
      scheduledAt: new Date(),
    })
    mockQueueAdd.mockResolvedValue({})
  })

  it('creates a ReviewRequest and enqueues a review request job', async () => {
    const job = createMockJob({
      shopId: 'shop-1',
      topic: 'ORDERS_FULFILLED',
      payload: {
        id: 12345,
        email: 'alice@example.com',
        customer: { first_name: 'Alice' },
        shop_name: 'My Store',
        line_items: [{ title: 'Blue Widget' }],
      },
      webhookEventId: 'evt-fulfilled-1',
    })

    await processWebhook(job)

    // Should create ReviewRequest
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const createCall = mockCreate.mock.calls[0][0]
    expect(createCall.data.shopId).toBe('shop-1')
    expect(createCall.data.orderId).toBe('12345')
    expect(createCall.data.customerEmail).toBe('alice@example.com')
    expect(createCall.data.status).toBe('pending')
    expect(createCall.data.scheduledAt).toBeInstanceOf(Date)

    // Should enqueue review request job with 7-day delay
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    const [jobName, jobData, jobOpts] = mockQueueAdd.mock.calls[0]
    expect(jobName).toBe('review-request')
    expect(jobData.shopId).toBe('shop-1')
    expect(jobData.orderId).toBe('12345')
    expect(jobData.customerEmail).toBe('alice@example.com')
    expect(jobData.customerName).toBe('Alice')
    expect(jobData.productTitle).toBe('Blue Widget')
    expect(jobData.shopName).toBe('My Store')
    expect(jobData.reviewRequestId).toBe('rr-new-1')
    expect(jobOpts.delay).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('uses contact_email as fallback when email is missing', async () => {
    const job = createMockJob({
      shopId: 'shop-2',
      topic: 'ORDERS_FULFILLED',
      payload: {
        id: 67890,
        contact_email: 'bob@example.com',
        customer: { first_name: 'Bob' },
        line_items: [{ title: 'Red Gadget' }],
      },
      webhookEventId: 'evt-fulfilled-2',
    })

    await processWebhook(job)

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0].data.customerEmail).toBe('bob@example.com')
  })

  it('uses default product title when line_items is empty', async () => {
    const job = createMockJob({
      shopId: 'shop-3',
      topic: 'ORDERS_FULFILLED',
      payload: {
        id: 11111,
        email: 'carol@example.com',
        customer: { first_name: 'Carol' },
        line_items: [],
      },
      webhookEventId: 'evt-fulfilled-3',
    })

    await processWebhook(job)

    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    expect(mockQueueAdd.mock.calls[0][1].productTitle).toBe('your order')
  })

  it('skips when customer email is missing', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const job = createMockJob({
      shopId: 'shop-4',
      topic: 'ORDERS_FULFILLED',
      payload: {
        id: 22222,
        customer: { first_name: 'Dave' },
        line_items: [{ title: 'Green Thing' }],
      },
      webhookEventId: 'evt-fulfilled-4',
    })

    await processWebhook(job)

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('uses "Customer" as default name when customer first_name is missing', async () => {
    const job = createMockJob({
      shopId: 'shop-5',
      topic: 'ORDERS_FULFILLED',
      payload: {
        id: 33333,
        email: 'eve@example.com',
        customer: {},
        line_items: [{ title: 'Purple Item' }],
      },
      webhookEventId: 'evt-fulfilled-5',
    })

    await processWebhook(job)

    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    expect(mockQueueAdd.mock.calls[0][1].customerName).toBe('Customer')
  })
})
