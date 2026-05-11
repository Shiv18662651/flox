// Brevo transactional email utility
// Requirements: 4.2

/**
 * Send a transactional email via Brevo's SMTP API.
 * Throws on failure to allow BullMQ retry.
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string
): Promise<{ messageId: string }> {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  const senderName = process.env.BREVO_SENDER_NAME

  if (!apiKey || !senderEmail || !senderName) {
    throw new Error('Missing Brevo configuration: BREVO_API_KEY, BREVO_SENDER_EMAIL, or BREVO_SENDER_NAME')
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Brevo API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json() as { messageId: string }
  return { messageId: data.messageId }
}
