import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'
import type { ReviewRequestJob } from './index'

// Use vi.hoisted to create mocks that are available during vi.mock hoisting
const { mockFindUnique, mockUpdate, mockCreate, mockSendEmail, mockQueueAdd } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockSendEmail: vi.fn(),
  mockQueueAdd: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    reviewRequest = {
      findUnique: mockFindUnique,
      update: mockUpdate,
      create: mockCreate,
    }
    webhookEvent = {
      findUnique: vi.fn().mockResolvedValue({ status: 'pending' }),
      update: vi.fn().mockResolvedValue({}),
    }
  },
}))

vi.mock('../app/utils/brevo.server', () => ({
  sendEmail: mockSendEmail,
}))

vi.mock('./index', () => ({
  connection: {},
  QUEUES: { REVIEW_REQUEST: 'review-request', WEBHOOK: 'webhook' },
  WORKER_CONFIG: {
    'review-request': { concurrency: 3, attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
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

import { processReviewRequest, buildReviewEmailHtml } from './review.worker'

function createMockJob(data: ReviewRequestJob): Job<ReviewRequestJob> {
  return {
    id: 'test-review-job-1',
    data,
    attemptsMade: 0,
  } as unknown as Job<ReviewRequestJob>
}

describe('review.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockResolvedValue({})
    mockSendEmail.mockResolvedValue({ messageId: 'brevo-msg-123' })
    process.env.SHOPIFY_APP_URL = 'https://myapp.example.com'
  })

  describe('buildReviewEmailHtml', () => {
    it('generates HTML with customer name, product title, and review link', () => {
      const html = buildReviewEmailHtml({
        customerName: 'Alice',
        productTitle: 'Blue Widget',
        reviewLink: 'https://myapp.example.com/api/reviews?token=abc123',
      })

      expect(html).toContain('Hi Alice,')
      expect(html).toContain('Blue Widget')
      expect(html).toContain('https://myapp.example.com/api/reviews?token=abc123')
      expect(html).toContain('Write a Review')
      expect(html).toContain('How was your purchase?')
    })
  })

  describe('processReviewRequest', () => {
    it('sends email and updates status to sent for pending review request', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'rr-1',
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'alice@example.com',
        token: 'unique-token-abc',
        status: 'pending',
        scheduledAt: new Date(),
        sentAt: null,
      })

      const job = createMockJob({
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'alice@example.com',
        customerName: 'Alice',
        productTitle: 'Blue Widget',
        shopName: 'My Store',
        reviewRequestId: 'rr-1',
      })

      await processReviewRequest(job)

      // Should send email
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      expect(mockSendEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'My Store: How was your purchase?',
        expect.stringContaining('unique-token-abc')
      )

      // Should update status to sent
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rr-1' },
        data: {
          status: 'sent',
          sentAt: expect.any(Date),
        },
      })
    })

    it('skips if review request not found', async () => {
      mockFindUnique.mockResolvedValue(null)

      const job = createMockJob({
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'alice@example.com',
        customerName: 'Alice',
        productTitle: 'Blue Widget',
        shopName: 'My Store',
        reviewRequestId: 'rr-nonexistent',
      })

      await processReviewRequest(job)

      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('skips if review request is already sent', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'rr-2',
        status: 'sent',
        token: 'token-xyz',
      })

      const job = createMockJob({
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'alice@example.com',
        customerName: 'Alice',
        productTitle: 'Blue Widget',
        shopName: 'My Store',
        reviewRequestId: 'rr-2',
      })

      await processReviewRequest(job)

      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('skips if review request is already reviewed', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'rr-3',
        status: 'reviewed',
        token: 'token-xyz',
      })

      const job = createMockJob({
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'alice@example.com',
        customerName: 'Alice',
        productTitle: 'Blue Widget',
        shopName: 'My Store',
        reviewRequestId: 'rr-3',
      })

      await processReviewRequest(job)

      expect(mockSendEmail).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('throws on Brevo API error to allow BullMQ retry', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'rr-4',
        status: 'pending',
        token: 'token-retry',
      })
      mockSendEmail.mockRejectedValue(new Error('Brevo API error (500): Internal Server Error'))

      const job = createMockJob({
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'alice@example.com',
        customerName: 'Alice',
        productTitle: 'Blue Widget',
        shopName: 'My Store',
        reviewRequestId: 'rr-4',
      })

      await expect(processReviewRequest(job)).rejects.toThrow('Brevo API error (500)')

      // Should NOT update status since email failed
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('includes correct review link with token in email', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'rr-5',
        status: 'pending',
        token: 'my-unique-token-123',
      })

      const job = createMockJob({
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'bob@example.com',
        customerName: 'Bob',
        productTitle: 'Red Gadget',
        shopName: '',
        reviewRequestId: 'rr-5',
      })

      await processReviewRequest(job)

      const emailHtml = mockSendEmail.mock.calls[0][2]
      expect(emailHtml).toContain('https://myapp.example.com/api/reviews?token=my-unique-token-123')
    })

    it('uses plain subject when shopName is empty', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'rr-6',
        status: 'pending',
        token: 'token-plain',
      })

      const job = createMockJob({
        shopId: 'shop-1',
        orderId: 'order-1',
        customerEmail: 'bob@example.com',
        customerName: 'Bob',
        productTitle: 'Red Gadget',
        shopName: '',
        reviewRequestId: 'rr-6',
      })

      await processReviewRequest(job)

      expect(mockSendEmail).toHaveBeenCalledWith(
        'bob@example.com',
        'How was your purchase?',
        expect.any(String)
      )
    })
  })
})
