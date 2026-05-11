// Unit tests for email-renderer.server.ts
// Requirements: 7.1, 7.2, 7.5, 7.6

import { describe, it, expect } from 'vitest'
import {
  renderBlock,
  renderEmailHtml,
  injectTracking,
  injectUnsubscribeLink,
  type EmailBlock,
} from './email-renderer.server'

describe('renderBlock', () => {
  it('renders a text block with escaped HTML', () => {
    const block: EmailBlock = { type: 'text', content: 'Hello <world> & "friends"' }
    const html = renderBlock(block)
    expect(html).toContain('Hello &lt;world&gt; &amp; &quot;friends&quot;')
    expect(html).toContain('<tr>')
    expect(html).toContain('</tr>')
  })

  it('renders an image block with src and alt', () => {
    const block: EmailBlock = { type: 'image', src: 'https://example.com/img.png', alt: 'Test image' }
    const html = renderBlock(block)
    expect(html).toContain('src="https://example.com/img.png"')
    expect(html).toContain('alt="Test image"')
    expect(html).toContain('<img')
  })

  it('renders a button block with link and text', () => {
    const block: EmailBlock = { type: 'button', text: 'Click Me', url: 'https://shop.com/sale' }
    const html = renderBlock(block)
    expect(html).toContain('href="https://shop.com/sale"')
    expect(html).toContain('Click Me')
    expect(html).toContain('background-color: #3b82f6')
  })

  it('renders a divider block', () => {
    const block: EmailBlock = { type: 'divider' }
    const html = renderBlock(block)
    expect(html).toContain('<hr')
    expect(html).toContain('border-top: 1px solid')
  })

  it('renders a product block with title, price, image, and link', () => {
    const block: EmailBlock = {
      type: 'product',
      title: 'Cool Shirt',
      imageUrl: 'https://cdn.example.com/shirt.jpg',
      price: '$29.99',
      url: 'https://shop.com/products/cool-shirt',
    }
    const html = renderBlock(block)
    expect(html).toContain('Cool Shirt')
    expect(html).toContain('$29.99')
    expect(html).toContain('src="https://cdn.example.com/shirt.jpg"')
    expect(html).toContain('href="https://shop.com/products/cool-shirt"')
    expect(html).toContain('View Product')
  })

  it('returns empty string for unknown block type', () => {
    const block = { type: 'unknown' } as unknown as EmailBlock
    const html = renderBlock(block)
    expect(html).toBe('')
  })
})

describe('renderEmailHtml', () => {
  it('wraps blocks in a complete HTML email document', () => {
    const blocks: EmailBlock[] = [
      { type: 'text', content: 'Hello World' },
    ]
    const html = renderEmailHtml(blocks)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('Hello World')
    expect(html).toContain('role="presentation"')
    expect(html).toContain('max-width: 600px')
  })

  it('renders multiple blocks in order', () => {
    const blocks: EmailBlock[] = [
      { type: 'text', content: 'First' },
      { type: 'divider' },
      { type: 'text', content: 'Second' },
    ]
    const html = renderEmailHtml(blocks)
    const firstIdx = html.indexOf('First')
    const dividerIdx = html.indexOf('<hr')
    const secondIdx = html.indexOf('Second')
    expect(firstIdx).toBeLessThan(dividerIdx)
    expect(dividerIdx).toBeLessThan(secondIdx)
  })

  it('handles empty blocks array', () => {
    const html = renderEmailHtml([])
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('</html>')
  })
})

describe('injectTracking', () => {
  const baseHtml = renderEmailHtml([
    { type: 'text', content: 'Hello' },
    { type: 'button', text: 'Shop', url: 'https://shop.com/products' },
  ])

  it('injects a 1x1 tracking pixel before </body>', () => {
    const tracked = injectTracking(baseHtml, 'send-123', 'https://app.example.com')
    expect(tracked).toContain('/api/tracking?type=open&id=send-123')
    expect(tracked).toContain('width="1"')
    expect(tracked).toContain('height="1"')
  })

  it('wraps links with click tracking redirect', () => {
    const tracked = injectTracking(baseHtml, 'send-123', 'https://app.example.com')
    expect(tracked).toContain('/api/tracking?type=click&id=send-123&url=')
    expect(tracked).toContain(encodeURIComponent('https://shop.com/products'))
  })

  it('does not wrap tracking pixel URL itself', () => {
    const tracked = injectTracking(baseHtml, 'send-123', 'https://app.example.com')
    // The tracking pixel src should not be double-wrapped
    const pixelMatches = tracked.match(/\/api\/tracking\?type=open/g)
    expect(pixelMatches?.length).toBe(1)
  })
})

describe('injectUnsubscribeLink', () => {
  it('adds an unsubscribe link to the email', () => {
    const html = renderEmailHtml([{ type: 'text', content: 'Hello' }])
    const result = injectUnsubscribeLink(html, 'cust-456', 'https://app.example.com')
    expect(result).toContain('/api/unsubscribe?id=cust-456')
    expect(result).toContain('Unsubscribe')
  })
})
