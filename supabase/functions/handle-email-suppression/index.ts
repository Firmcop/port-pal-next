import { createClient } from 'npm:@supabase/supabase-js@2'

// Resend webhook: hard bounces and spam complaints put the address on the
// suppression list so we never email it again.
// Resend signs webhooks with Svix: headers svix-id, svix-timestamp, svix-signature,
// secret RESEND_WEBHOOK_SECRET ("whsec_...").
// Events handled: email.bounced (permanent only), email.complained. Others are acknowledged.

interface ResendEvent {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    subject?: string
    bounce?: { type?: string; subType?: string; message?: string }
  }
}

const TOLERANCE_SECONDS = 5 * 60

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: ArrayBuffer): string {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin)
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifySvix(req: Request, body: string, secret: string): Promise<boolean> {
  const id = req.headers.get('svix-id')
  const ts = req.headers.get('svix-timestamp')
  const sigHeader = req.headers.get('svix-signature')
  if (!id || !ts || !sigHeader) return false
  const now = Math.floor(Date.now() / 1000)
  if (!/^\d+$/.test(ts) || Math.abs(now - Number(ts)) > TOLERANCE_SECONDS) return false

  const key = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = bytesToB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))
  return sigHeader.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    return version === 'v1' && !!sig && safeEqual(sig, expected)
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const body = await req.text()
  if (!(await verifySvix(req, body, secret))) return jsonResponse({ error: 'Invalid signature' }, 401)

  let event: ResendEvent
  try {
    event = JSON.parse(body)
  } catch {
    return jsonResponse({ error: 'Invalid payload' }, 400)
  }

  let reason: 'bounce' | 'complaint' | null = null
  if (event.type === 'email.complained') reason = 'complaint'
  if (event.type === 'email.bounced') {
    // Temporary bounces (mailbox full, greylisting) are retried by the receiving side; don't suppress.
    const kind = (event.data?.bounce?.type ?? 'Permanent').toLowerCase()
    if (kind !== 'transient' && kind !== 'temporary') reason = 'bounce'
  }
  if (!reason) return jsonResponse({ success: true, ignored: event.type })

  const recipients = ([] as string[]).concat(event.data?.to ?? []).map((e) => e.toLowerCase().trim()).filter(Boolean)
  if (!recipients.length) return jsonResponse({ error: 'No recipient in event' }, 400)

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const metadata = { provider: 'resend', email_id: event.data?.email_id ?? null, bounce: event.data?.bounce ?? null }

  for (const email of recipients) {
    const { error } = await supabase
      .from('suppressed_emails')
      .upsert({ email, reason, metadata }, { onConflict: 'email' })
    if (error) {
      console.error('Failed to upsert suppressed email', { error })
      return jsonResponse({ error: 'Failed to write suppression' }, 500) // Resend will retry
    }
    await supabase.from('email_send_log').insert({
      message_id: event.data?.email_id ?? null,
      template_name: 'system',
      recipient_email: email,
      status: reason === 'bounce' ? 'bounced' : 'complained',
      error_message: reason === 'bounce'
        ? 'Permanent bounce — email address is invalid or rejected'
        : 'Spam complaint — recipient marked email as spam',
      metadata,
    })
  }

  return jsonResponse({ success: true })
})
