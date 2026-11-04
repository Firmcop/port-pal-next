// Sends one email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// Throws EmailSendError with the HTTP status so the queue can decide to retry,
// back off (429) or give up (4xx configuration errors).

export class EmailSendError extends Error {
  constructor(message: string, public status: number, public retryAfterSeconds: number | null = null) {
    super(message)
  }
}

export interface OutgoingEmail {
  to: string | string[]
  from: string
  subject: string
  html?: string
  text?: string
  reply_to?: string
  idempotency_key?: string
  unsubscribe_url?: string
  tags?: { name: string; value: string }[]
}

export async function sendViaResend(email: OutgoingEmail, apiKey: string): Promise<{ id: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (email.idempotency_key) headers['Idempotency-Key'] = email.idempotency_key.slice(0, 256)

  const extraHeaders: Record<string, string> = {}
  if (email.unsubscribe_url) {
    extraHeaders['List-Unsubscribe'] = `<${email.unsubscribe_url}>`
    extraHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: email.from,
      to: Array.isArray(email.to) ? email.to : [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      reply_to: email.reply_to,
      headers: Object.keys(extraHeaders).length ? extraHeaders : undefined,
      tags: email.tags,
    }),
  })

  const body = await res.text()
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'))
    let message = body
    try { message = JSON.parse(body)?.message ?? body } catch { /* keep raw */ }
    throw new EmailSendError(`Resend ${res.status}: ${message}`, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null)
  }
  return JSON.parse(body)
}

// Resend tag values allow only ASCII letters, numbers, underscores and dashes.
export function tagValue(v: unknown): string {
  return String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) || 'none'
}
