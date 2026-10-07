import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { file_data, filename, mime } = body ?? {};
    if (!file_data || typeof file_data !== 'string') {
      return new Response(JSON.stringify({ error: 'file_data (base64) is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const fileMime = typeof mime === 'string' && mime ? mime : 'application/pdf';
    const fname = typeof filename === 'string' && filename ? filename : 'quote.pdf';

    const systemPrompt = `You extract Bill of Quantities (BOQ) / quotation line items from documents.
Return STRICT JSON matching this TypeScript type, and nothing else:
{
  "sections": [
    {
      "title": string,
      "items": [
        {
          "description": string,
          "unit": string | null,
          "quantity": number,
          "unit_price": number,
          "discount_pct": number,
          "tax_pct": number
        }
      ]
    }
  ]
}
Rules:
- Group items by their heading/section in the document; if none, use a single section "Items".
- Numbers must be plain numbers (no currency symbols, no thousands separators).
- Use 0 for missing quantity/price/discount/tax.
- Do NOT include totals or subtotal rows as items.
- Do NOT wrap in markdown code fences.`;

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the BOQ sections and line items from this quote document. Return JSON only.' },
              { type: 'file', file: { filename: fname, file_data: `data:${fileMime};base64,${file_data}` } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiRes.ok) {
      const errorBody = await aiRes.text();
      console.error(`AI gateway failed [${aiRes.status}]: ${errorBody}`);
      return new Response(
        JSON.stringify({ error: 'AI extraction failed', status: aiRes.status, details: errorBody }),
        { status: aiRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? '{}';
    let parsed: any = {};
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      const m = String(raw).match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { sections: [] };
    }

    const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
    const clean = sections.map((s: any) => ({
      title: String(s?.title ?? 'Items').slice(0, 200),
      items: Array.isArray(s?.items) ? s.items.map((i: any) => ({
        description: String(i?.description ?? '').slice(0, 500),
        unit: i?.unit != null ? String(i.unit).slice(0, 40) : null,
        quantity: Number(i?.quantity) || 0,
        unit_price: Number(i?.unit_price) || 0,
        discount_pct: Number(i?.discount_pct) || 0,
        tax_pct: Number(i?.tax_pct) || 0,
      })).filter((i: any) => i.description) : [],
    })).filter((s: any) => s.items.length);

    return new Response(JSON.stringify({ sections: clean }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (e: any) {
    console.error('parse-quote-pdf error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
