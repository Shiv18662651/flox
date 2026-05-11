// Unit tests for the search index worker
// Tests: processSearchIndexJob logic for upsert and delete operations

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processSearchIndexJob } from './search.worker'
import type { Job } from 'bullmq'
import type { SearchIndexJob } from './index'

// Mock Meilisearch client
function createMockMeiliClient() {
  const addDocuments = vi.fn().mockResolvedValue({ taskUid: 1 })
  const deleteDocument = vi.fn().mockResolvedValue({ taskUid: 2 })

  const mockIndex = vi.fn().mockReturnValue({
    addDocuments,
    deleteDocument,
  })

  return {
    index: mockIndex,
    _mocks: { addDocuments, deleteDocument, mockIndex },
  }
}

function createMockJob(data: SearchIndexJob): Job<SearchIndexJob> {
  return {
    data,
    id: 'test-job-1',
    attemptsMade: 0,
  } as unknown as Job<SearchIndexJob>
}

describe('search.worker - processSearchIndexJob', () => {
  let mockClient: ReturnType<typeof createMockMeiliClient>

  beforeEach(() => {
    mockClient = createMockMeiliClient()
    vi.clearAllMocks()
  })

  describe('upsert action', () => {
    it('should upsert a customer document to the customers index', async () => {
      const job = createMockJob({
        shopId: 'shop-1',
        action: 'upsert',
        index: 'customers',
        documentId: 'cust-123',
        document: {
          shopId: 'shop-1',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
        },
      })

      await processSearchIndexJob(job, mockClient as any)

      expect(mockClient.index).toHaveBeenCalledWith('customers')
      expect(mockClient._mocks.addDocuments).toHaveBeenCalledWith([
        {
          id: 'cust-123',
          shopId: 'shop-1',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
        },
      ])
    })

    it('should upsert a product document to the products index', async () => {
      const job = createMockJob({
        shopId: 'shop-1',
        action: 'upsert',
        index: 'products',
        documentId: 'prod-456',
        document: {
          shopId: 'shop-1',
          title: 'Cool Widget',
          vendor: 'Acme',
          productType: 'Gadgets',
          tags: 'cool, widget, gadget',
        },
      })

      await processSearchIndexJob(job, mockClient as any)

      expect(mockClient.index).toHaveBeenCalledWith('products')
      expect(mockClient._mocks.addDocuments).toHaveBeenCalledWith([
        {
          id: 'prod-456',
          shopId: 'shop-1',
          title: 'Cool Widget',
          vendor: 'Acme',
          productType: 'Gadgets',
          tags: 'cool, widget, gadget',
        },
      ])
    })

    it('should throw an error if document is missing for upsert', async () => {
      const job = createMockJob({
        shopId: 'shop-1',
        action: 'upsert',
        index: 'customers',
        documentId: 'cust-123',
        // No document provided
      })

      await expect(processSearchIndexJob(job, mockClient as any)).rejects.toThrow(
        'SEARCH_INDEX upsert job missing document'
      )
    })

    it('should include the documentId as the id field in the document', async () => {
      const job = createMockJob({
        shopId: 'shop-1',
        action: 'upsert',
        index: 'products',
        documentId: 'prod-789',
        document: {
          title: 'Test Product',
        },
      })

      await processSearchIndexJob(job, mockClient as any)

      expect(mockClient._mocks.addDocuments).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'prod-789', title: 'Test Product' }),
      ])
    })
  })

  describe('delete action', () => {
    it('should delete a product document from the products index', async () => {
      const job = createMockJob({
        shopId: 'shop-1',
        action: 'delete',
        index: 'products',
        documentId: 'prod-456',
      })

      await processSearchIndexJob(job, mockClient as any)

      expect(mockClient.index).toHaveBeenCalledWith('products')
      expect(mockClient._mocks.deleteDocument).toHaveBeenCalledWith('prod-456')
    })

    it('should delete a customer document from the customers index', async () => {
      const job = createMockJob({
        shopId: 'shop-1',
        action: 'delete',
        index: 'customers',
        documentId: 'cust-123',
      })

      await processSearchIndexJob(job, mockClient as any)

      expect(mockClient.index).toHaveBeenCalledWith('customers')
      expect(mockClient._mocks.deleteDocument).toHaveBeenCalledWith('cust-123')
    })
  })

  describe('error handling', () => {
    it('should throw on unknown action', async () => {
      const job = createMockJob({
        shopId: 'shop-1',
        action: 'unknown' as any,
        index: 'products',
        documentId: 'prod-456',
      })

      await expect(processSearchIndexJob(job, mockClient as any)).rejects.toThrow(
        'Unknown search index action'
      )
    })

    it('should propagate Meilisearch errors on upsert', async () => {
      mockClient._mocks.addDocuments.mockRejectedValue(new Error('Meilisearch connection failed'))

      const job = createMockJob({
        shopId: 'shop-1',
        action: 'upsert',
        index: 'customers',
        documentId: 'cust-123',
        document: { email: 'test@example.com' },
      })

      await expect(processSearchIndexJob(job, mockClient as any)).rejects.toThrow(
        'Meilisearch connection failed'
      )
    })

    it('should propagate Meilisearch errors on delete', async () => {
      mockClient._mocks.deleteDocument.mockRejectedValue(new Error('Document not found'))

      const job = createMockJob({
        shopId: 'shop-1',
        action: 'delete',
        index: 'products',
        documentId: 'prod-456',
      })

      await expect(processSearchIndexJob(job, mockClient as any)).rejects.toThrow(
        'Document not found'
      )
    })
  })
})
