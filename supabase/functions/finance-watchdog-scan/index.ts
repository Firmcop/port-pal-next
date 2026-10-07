import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

const JOB = 'finance_watchdog';
const MAX_ORGS_PER_RUN = 10;
const MAX_EXPLANATIONS_PER_RUN = 25;

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Finding = {
  id: string;
  finding_type: string;
  severity: string;
  title: string;
  entity_label: string | null;
  amount: number | null;
  currency: string | null;
  details: Record<string, unknown>;
};

const SYSTEM_PROMPT = `You are a finance controller for a container depot ERP.
For each finding you receive, write a short plain-English explanation of why it matters and a concrete suggested fix inside this system.
Return STRICT JSON: {"findings":[{"id":"<uuid>","explanation":"...","suggested_action":"..."}]}
Rules:
- explanation: max 2 sentences, no jargon, reference the actual numbers given.
- suggested_action: one imperative sentence naming what a user should do (e.g. "Raise the missing offloading invoice for this container", "Cancel the duplicate invoice and keep the earliest one").
- Never invent numbers or records that are not in the input.
- No markdown, no code fences.`;

async function explainFindings(findings: Finding[]) {
  if (!LOVABLE_API_KEY || findings.length === 0) return { map: new Map<string, { explanation: string; suggested_action: string }>(), status: 0 };

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ findings }) },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`AI gateway ${res.status}: ${body}`);
    return { map: new Map(), status: res.status, error: body };
  }

  const json = await res.json();
  const raw = json?.choices?.[0]?.message?.content ?? '{}';
  let parsed: any = {};
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    const m = String(raw).match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }
  const map = new Map<string, { explanation: string; suggested_action: string }>();
  for (const f of Array.isArray(parsed?.findings) ? parsed.findings : []) {
    if (f?.id) {
      map.set(String(f.id), {
        explanation: String(f.explanation ?? '').slice(0, 800),
        suggested_action: String(f.suggested_action ?? '').slice(0, 400),
      });
    }
  }
  return { map, status: 200 };
}

async function runForOrg(db: ReturnType<typeof admin>, orgId: string) {
  const { data: locked } = await db.rpc('ai_job_acquire', {
    _org: orgId,
    _job: JOB,
    _lease_seconds: 600,
    _worker: 'finance-watchdog-scan',
  });
  if (!locked) return { organization_id: orgId, skipped: 'locked_or_paused' };

  try {
    const { data: scan, error: scanErr } = await db.rpc('finance_watchdog_scan', { _org: orgId });
    if (scanErr) throw scanErr;

    // Bounded batch of findings that still need an AI explanation
    const { data: pending } = await db
      .from('ai_findings')
      .select('id, finding_type, severity, title, entity_label, amount, currency, details')
      .eq('organization_id', orgId)
      .eq('job', JOB)
      .in('status', ['open', 'acknowledged'])
      .is('explanation', null)
      .limit(MAX_EXPLANATIONS_PER_RUN);

    let explained = 0;
    if (pending?.length) {
      const { map, status, error } = await explainFindings(pending as Finding[]);

      if (status === 402 || status === 403) {
        await db.rpc('ai_job_release', {
          _org: orgId,
          _job: JOB,
          _error: `AI blocked (${status})`,
          _pause: true,
          _pause_reason: status === 402 ? 'AI credits exhausted — top up to resume' : 'AI access blocked by workspace policy',
        });
        return { organization_id: orgId, ...(scan as object), paused: true, reason: error?.slice(0, 300) };
      }

      for (const [id, v] of map) {
        if (!v.explanation && !v.suggested_action) continue;
        await db
          .from('ai_findings')
          .update({ explanation: v.explanation, suggested_action: v.suggested_action, ai_generated: true })
          .eq('id', id)
          .eq('organization_id', orgId);
        explained++;
      }
    }

    await db.rpc('ai_job_release', { _org: orgId, _job: JOB, _error: null, _pause: false, _pause_reason: null });
    return { organization_id: orgId, ...(scan as object), explained };
  } catch (e: any) {
    await db.rpc('ai_job_release', { _org: orgId, _job: JOB, _error: String(e?.message ?? e).slice(0, 500), _pause: false, _pause_reason: null });
    return { organization_id: orgId, error: String(e?.message ?? e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();

    let orgIds: string[] = [];

    // Manual run by a signed-in user: scan only their organization.
    if (token && token !== ANON_KEY && token !== SERVICE_KEY) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: member } = await db
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userData.user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!member?.organization_id) {
        return new Response(JSON.stringify({ error: 'No active organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      orgIds = [member.organization_id];
    } else if (body?.organization_id) {
      orgIds = [String(body.organization_id)];
    } else {
      // Scheduled run: bounded set of organizations that are not paused.
      const { data: orgs } = await db.from('organizations').select('id').limit(MAX_ORGS_PER_RUN);
      const { data: paused } = await db.from('ai_job_state').select('organization_id').eq('job', JOB).eq('paused', true);
      const pausedSet = new Set((paused ?? []).map((p: any) => p.organization_id));
      orgIds = (orgs ?? []).map((o: any) => o.id).filter((id: string) => !pausedSet.has(id));
    }

    const results = [];
    for (const orgId of orgIds) results.push(await runForOrg(db, orgId));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (e: any) {
    console.error('finance-watchdog-scan error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
