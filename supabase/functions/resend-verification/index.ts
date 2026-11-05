// "Resend confirmation email" for the signed-in person. At most one email per 2 minutes.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendVerificationEmail } from '../_shared/verification.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  const url = Deno.env.get('SUPABASE_URL')!
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u?.user?.email) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: profile } = await admin.from('profiles').select('display_name, email_verified_at').eq('user_id', u.user.id).maybeSingle()
  if (profile?.email_verified_at) return json({ ok: true, verified: true })

  const { count } = await admin.from('email_verification_tokens').select('token_hash', { count: 'exact', head: true })
    .eq('user_id', u.user.id).gte('created_at', new Date(Date.now() - 2 * 60_000).toISOString())
  if ((count ?? 0) > 0) return json({ error: 'We just sent one. Check your inbox, or try again in 2 minutes.' }, 429)

  const { data: m } = await admin.from('organization_members').select('organizations(name)')
    .eq('user_id', u.user.id).eq('status', 'active').order('created_at').limit(1).maybeSingle()
  try {
    await sendVerificationEmail(admin, {
      id: u.user.id, email: u.user.email, name: profile?.display_name, company: (m as any)?.organizations?.name,
    })
  } catch (e) {
    console.error(e)
    return json({ error: 'Could not send the email. Please try again.' }, 500)
  }
  return json({ ok: true, sent: true })
})
