// Issues a one-time email confirmation link and queues the "verify-email" message.
// Server side only: the template is restricted to service-role callers.
// deno-lint-ignore-file no-explicit-any

export async function sendVerificationEmail(
  admin: any,
  user: { id: string; email: string; name?: string | null; company?: string | null },
): Promise<void> {
  const { data: token, error } = await admin.rpc('issue_email_verification', { _user: user.id })
  if (error || !token) throw new Error(`Could not issue verification link: ${error?.message ?? 'no token'}`)

  const appUrl = (Deno.env.get('APP_URL') ?? 'https://portal.firmcop.com').replace(/\/+$/, '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const res = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateName: 'verify-email',
      recipientEmail: user.email,
      idempotencyKey: `verify-${user.id}-${String(token).slice(0, 12)}`,
      templateData: {
        name: user.name ?? undefined,
        company: user.company ?? undefined,
        url: `${appUrl}/verify-email?token=${token}`,
      },
    }),
  })
  if (!res.ok) throw new Error(`Verification email not queued: ${res.status} ${await res.text()}`)
}
