// Email template renderer - converts block JSON to HTML email
// Requirements: 7.1, 7.2

export interface TextBlock {
  type: 'text'
  content: string
}

export interface ImageBlock {
  type: 'image'
  src: string
  alt: string
}

export interface ButtonBlock {
  type: 'button'
  text: string
  url: string
}

export interface DividerBlock {
  type: 'divider'
}

export interface ProductBlock {
  type: 'product'
  title: string
  imageUrl: string
  price: string
  url: string
}

export type EmailBlock = TextBlock | ImageBlock | ButtonBlock | DividerBlock | ProductBlock

/**
 * Render a single block to HTML table-based email markup.
 */
export function renderBlock(block: EmailBlock): string {
  switch (block.type) {
    case 'text':
      return `<tr><td style="padding: 12px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #333333;">${escapeHtml(block.content)}</td></tr>`

    case 'image':
      return `<tr><td style="padding: 12px 24px; text-align: center;"><img src="${escapeAttr(block.src)}" alt="${escapeAttr(block.alt)}" style="max-width: 100%; height: auto; border-radius: 4px;" /></td></tr>`

    case 'button':
      return `<tr><td style="padding: 12px 24px; text-align: center;"><a href="${escapeAttr(block.url)}" style="display: inline-block; padding: 12px 32px; background-color: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 600;">${escapeHtml(block.text)}</a></td></tr>`

    case 'divider':
      return `<tr><td style="padding: 12px 24px;"><hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;" /></td></tr>`

    case 'product':
      return `<tr><td style="padding: 12px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
    <tr>
      <td style="width: 120px; vertical-align: top;"><img src="${escapeAttr(block.imageUrl)}" alt="${escapeAttr(block.title)}" style="width: 120px; height: 120px; object-fit: cover;" /></td>
      <td style="padding: 12px; vertical-align: top; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #333333;">${escapeHtml(block.title)}</p>
        <p style="margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #111827;">${escapeHtml(block.price)}</p>
        <a href="${escapeAttr(block.url)}" style="display: inline-block; padding: 8px 16px; background-color: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 14px;">View Product</a>
      </td>
    </tr>
  </table>
</td></tr>`

    default:
      return ''
  }
}

/**
 * Render an array of blocks into a complete HTML email document.
 * Wraps content in a responsive email boilerplate with table-based layout.
 */
export function renderEmailHtml(blocks: EmailBlock[]): string {
  const bodyRows = blocks.map(renderBlock).join('\n')

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Email</title>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; }
    td { font-family: Arial, sans-serif; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 24px 0;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
${bodyRows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Inject tracking pixel and wrap links for click tracking.
 */
export function injectTracking(html: string, emailSendId: string, baseUrl: string): string {
  // Inject open tracking pixel before closing </body>
  const pixelUrl = `${baseUrl}/api/tracking?type=open&id=${emailSendId}`
  const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`
  let tracked = html.replace('</body>', `${pixel}\n</body>`)

  // Wrap links for click tracking (replace href values in <a> tags)
  tracked = tracked.replace(
    /(<a\s[^>]*href=")([^"]+)(")/gi,
    (match, prefix, url, suffix) => {
      // Don't wrap the tracking pixel URL or unsubscribe links
      if (url.includes('/api/tracking') || url.includes('/api/unsubscribe')) {
        return match
      }
      const trackingUrl = `${baseUrl}/api/tracking?type=click&id=${emailSendId}&url=${encodeURIComponent(url)}`
      return `${prefix}${trackingUrl}${suffix}`
    }
  )

  return tracked
}

/**
 * Inject unsubscribe link at the bottom of the email.
 */
export function injectUnsubscribeLink(html: string, customerId: string, baseUrl: string): string {
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?id=${customerId}`
  const unsubscribeHtml = `<tr><td style="padding: 24px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #9ca3af;"><a href="${unsubscribeUrl}" style="color: #9ca3af; text-decoration: underline;">Unsubscribe</a></td></tr>`

  // Insert before the closing content table
  return html.replace(
    /(<\/table>\s*<\/td>\s*<\/tr>\s*<\/table>\s*<\/body>)/,
    `${unsubscribeHtml}\n$1`
  )
}

// HTML escaping utilities
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
