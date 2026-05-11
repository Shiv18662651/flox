// Unit tests for api.tracking route
// Requirements: 7.5, 7.6

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loader } from './api.tracking'

// Mock the db module
vi.mock('~/db.server', () => ({
  db: {
    emailSend: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    campaign: {
      update: vi.fn(),
    },
  },
}))

import { db } from '~/db.server'

const mockEmailSendFindUnique = vi.mocked(db.emailSend.findUnique)
const mockEmailSendUpdate = vi.mocked(db.emailSend.update)
const mockCampaignUpdate = vi.mocked(db.campaign.update)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/tracking', () => {
  describe('open tracking', () => {
    it('returns a 1x1 transparent GIF for open events', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        openedAt: null,
        campaignId: 'camp-1',
      } as any)
      mockEmailSendUpdate.mockResolvedValue({} as any)
      mockCampaignUpdate.mockResolvedValue({} as any)

      const request = new Request('http://localhost/api/tracking?type=open&id=send-1')
      const response = await loader({ request, params: {}, context: {} } as any)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/gif')
      expect(response.headers.get('Cache-Control')).toContain('no-store')
    })

    it('updates openedAt on EmailSend when not already opened', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        openedAt: null,
        campaignId: 'camp-1',
      } as any)
      mockEmailSendUpdate.mockResolvedValue({} as any)
      mockCampaignUpdate.mockResolvedValue({} as any)

      const request = new Request('http://localhost/api/tracking?type=open&id=send-1')
      await loader({ request, params: {}, context: {} } as any)

      expect(mockEmailSendUpdate).toHaveBeenCalledWith({
        where: { id: 'send-1' },
        data: { openedAt: expect.any(Date) },
      })
    })

    it('increments campaign openCount', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        openedAt: null,
        campaignId: 'camp-1',
      } as any)
      mockEmailSendUpdate.mockResolvedValue({} as any)
      mockCampaignUpdate.mockResolvedValue({} as any)

      const request = new Request('http://localhost/api/tracking?type=open&id=send-1')
      await loader({ request, params: {}, context: {} } as any)

      expect(mockCampaignUpdate).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: { openCount: { increment: 1 } },
      })
    })

    it('does not update if already opened', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        openedAt: new Date(),
        campaignId: 'camp-1',
      } as any)

      const request = new Request('http://localhost/api/tracking?type=open&id=send-1')
      await loader({ request, params: {}, context: {} } as any)

      expect(mockEmailSendUpdate).not.toHaveBeenCalled()
      expect(mockCampaignUpdate).not.toHaveBeenCalled()
    })
  })

  describe('click tracking', () => {
    it('redirects to the target URL with 302', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        clickedAt: null,
        campaignId: 'camp-1',
      } as any)
      mockEmailSendUpdate.mockResolvedValue({} as any)
      mockCampaignUpdate.mockResolvedValue({} as any)

      const targetUrl = encodeURIComponent('https://shop.com/products/cool-shirt')
      const request = new Request(`http://localhost/api/tracking?type=click&id=send-1&url=${targetUrl}`)
      const response = await loader({ request, params: {}, context: {} } as any)

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('https://shop.com/products/cool-shirt')
    })

    it('updates clickedAt on EmailSend', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        clickedAt: null,
        campaignId: 'camp-1',
      } as any)
      mockEmailSendUpdate.mockResolvedValue({} as any)
      mockCampaignUpdate.mockResolvedValue({} as any)

      const targetUrl = encodeURIComponent('https://shop.com/products')
      const request = new Request(`http://localhost/api/tracking?type=click&id=send-1&url=${targetUrl}`)
      await loader({ request, params: {}, context: {} } as any)

      expect(mockEmailSendUpdate).toHaveBeenCalledWith({
        where: { id: 'send-1' },
        data: { clickedAt: expect.any(Date) },
      })
    })

    it('increments campaign clickCount', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        clickedAt: null,
        campaignId: 'camp-1',
      } as any)
      mockEmailSendUpdate.mockResolvedValue({} as any)
      mockCampaignUpdate.mockResolvedValue({} as any)

      const targetUrl = encodeURIComponent('https://shop.com/products')
      const request = new Request(`http://localhost/api/tracking?type=click&id=send-1&url=${targetUrl}`)
      await loader({ request, params: {}, context: {} } as any)

      expect(mockCampaignUpdate).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: { clickCount: { increment: 1 } },
      })
    })

    it('does not update if already clicked', async () => {
      mockEmailSendFindUnique.mockResolvedValue({
        id: 'send-1',
        clickedAt: new Date(),
        campaignId: 'camp-1',
      } as any)

      const targetUrl = encodeURIComponent('https://shop.com/products')
      const request = new Request(`http://localhost/api/tracking?type=click&id=send-1&url=${targetUrl}`)
      await loader({ request, params: {}, context: {} } as any)

      expect(mockEmailSendUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 if URL parameter is missing', async () => {
      const request = new Request('http://localhost/api/tracking?type=click&id=send-1')
      const response = await loader({ request, params: {}, context: {} } as any)

      expect(response.status).toBe(400)
    })
  })

  describe('error handling', () => {
    it('returns 400 if type parameter is missing', async () => {
      const request = new Request('http://localhost/api/tracking?id=send-1')
      const response = await loader({ request, params: {}, context: {} } as any)

      expect(response.status).toBe(400)
    })

    it('returns 400 if id parameter is missing', async () => {
      const request = new Request('http://localhost/api/tracking?type=open')
      const response = await loader({ request, params: {}, context: {} } as any)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid tracking type', async () => {
      const request = new Request('http://localhost/api/tracking?type=invalid&id=send-1')
      const response = await loader({ request, params: {}, context: {} } as any)

      expect(response.status).toBe(400)
    })

    it('still returns GIF even if db update fails', async () => {
      mockEmailSendFindUnique.mockRejectedValue(new Error('DB error'))

      const request = new Request('http://localhost/api/tracking?type=open&id=send-1')
      const response = await loader({ request, params: {}, context: {} } as any)

      // Should still return the pixel (graceful failure)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/gif')
    })
  })
})
