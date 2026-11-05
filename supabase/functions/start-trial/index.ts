// Public signup: creates the account and the company in one step, then the browser
// signs in with the same password. Email confirmation follows within 7 days.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getClientIp, hashWithSalt, recordAndCount } from '../_shared/public-api-helpers.ts'
import { sendVerificationEmail } from '../_shared/verification.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SIZES = ['1-10', '11-50', '51-200', '200+']
const TYPES = ['depot', 'cfs', 'conversions', 'transport', 'trading', 'other']
const MIN_FILL_MS = 3000 // bots submit instantly

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, 400)

  // Honeypot + minimum time on the form: answer "ok" so bots learn nothing.
  const startedAt = Number(body.started_at)
  if (str(body.website, 200) || (Number.isFinite(startedAt) && Date.now() - startedAt < MIN_FILL_MS)) {
    return json({ ok: true })
  }

  const fullName = str(body.full_name, 80)
  const email = str(body.email, 254).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const phone = str(body.phone, 40)
  const company = str(body.company, 120)
  const country = str(body.country, 80)
  const currency = str(body.currency, 3).toUpperCase() || 'USD'
  const timezone = str(body.timezone, 64) || 'UTC'
  const size = SIZES.includes(body.company_size) ? body.company_size : null
  const type = TYPES.includes(body.business_type) ? body.business_type : null
  const depotName = str(body.depot_name, 80)
  const modules = Array.isArray(body.modules)
    ? body.modules.filter((m: unknown) => typeof m === 'string' && /^[a-z_]{2,30}$/.test(m)).slice(0, 30)
    : []

  const problems: Record<string, string> = {}
  if (fullName.length < 2) problems.full_name = 'Enter your name'
  if (!EMAIL_RE.test(email)) problems.email = 'Enter a valid work email'
  if (password.length < 8) problems.password = 'Use at least 8 characters'
  if (company.length < 2) problems.company = 'Enter your company name'
  if (!country) problems.country = 'Choose your country'
  if (!modules.length) problems.modules = 'Pick at least one module'
  if (Object.keys(problems).length) return json({ error: 'invalid', fields: problems }, 400)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Rate limits: 5 signups per hour per network, 3 per hour per email address.
  const counts = await recordAndCount(admin, 'start-trial', await hashWithSalt(getClientIp(req)), await hashWithSalt(email), null)
  if (counts.perHour > 5 || counts.emailPerHour > 3) {
    return json({ error: 'Too many attempts. Please try again in an hour.' }, 429)
  }

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // let them in now; our own 7-day confirmation follows
    user_metadata: { display_name: fullName, phone },
  })
  if (userErr || !created?.user) {
    const msg = userErr?.message ?? ''
    if (/already|registered|exists/i.test(msg)) {
      return json({ error: 'account_exists', message: 'An account with this email already exists. Sign in instead.' }, 409)
    }
    if (/password/i.test(msg)) return json({ error: 'invalid', fields: { password: msg } }, 400)
    console.error('createUser failed', msg)
    return json({ error: 'Could not create your account. Please try again.' }, 500)
  }
  const user = created.user

  const { data: result, error: coErr } = await admin.rpc('create_company', {
    _owner: user.id,
    _name: company,
    _country: country,
    _currency: currency,
    _timezone: timezone,
    _depot_name: depotName || null,
    _depot_code: null,
    _company_size: size,
    _business_type: type,
    _modules: modules,
  })
  if (coErr) {
    console.error('create_company failed', coErr)
    await admin.auth.admin.deleteUser(user.id).catch(() => {}) // nothing half-made
    return json({ error: 'Could not set up your company. Please try again.' }, 500)
  }

  await admin.from('profiles').update({ phone: phone || null, email_verified_at: null }).eq('user_id', user.id)
  try {
    await sendVerificationEmail(admin, { id: user.id, email, name: fullName, company })
  } catch (e) {
    console.error('verification email', (e as Error).message) // they can resend from the app
  }

  return json({ ok: true, ...result })
})
