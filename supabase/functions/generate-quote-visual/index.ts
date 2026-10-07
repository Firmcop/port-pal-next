// Generate an AI quote visual (render/floor plan/section design) via Lovable AI
// and upload it to the quote-visuals bucket. Returns a signed URL.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { prompt, kind = "render", quote_id, template_id, section_id, caption } = body as {
      prompt?: string; kind?: string; quote_id?: string; template_id?: string; section_id?: string | null; caption?: string;
    };
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!quote_id && !template_id) {
      return new Response(JSON.stringify({ error: "quote_id_or_template_id_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // resolve org id from quote or template using user-scoped client (RLS protects)
    let organizationId: string | null = null;
    if (quote_id) {
      const { data } = await userClient.from("quotes").select("organization_id").eq("id", quote_id).maybeSingle();
      organizationId = (data as any)?.organization_id ?? null;
    } else if (template_id) {
      const { data } = await userClient.from("quote_templates").select("organization_id").eq("id", template_id).maybeSingle();
      organizationId = (data as any)?.organization_id ?? null;
    }
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "not_found_or_forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // kind-specific prompt prefix
    const stylePrefix = (() => {
      switch (kind) {
        case "floor_plan":
          return "Clean architectural 2D floor plan, top-down view, labeled rooms, dimensions, walls as black lines on white background, professional CAD drawing style. ";
        case "section_design":
          return "Interior architectural rendering, photorealistic, professional, soft daylight, modern finishes. ";
        case "cover":
          return "Cinematic exterior architectural render, golden hour, photorealistic, marketing quality. ";
        case "material_sample":
          return "Catalog product photo on neutral background, material sample, studio lighting. ";
        default:
          return "Photorealistic architectural render, professional, high detail. ";
      }
    })();

    const fullPrompt = stylePrefix + prompt;

    // Call Lovable AI image gateway (non-streaming to keep edge function simple)
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image",
        messages: [{ role: "user", content: fullPrompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text().catch(() => "");
      return new Response(JSON.stringify({ error: "ai_failed", detail: txt, status: aiRes.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiJson = await aiRes.json();
    const b64 = aiJson?.data?.[0]?.b64_json;
    if (!b64) {
      return new Response(JSON.stringify({ error: "no_image_in_response", aiJson }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    // Upload using service role (RLS bypass) but path is org-scoped
    const svc = createClient(supabaseUrl, supabaseService);
    const fileName = `${organizationId}/${quote_id ?? template_id}/${kind}-${crypto.randomUUID()}.png`;
    const { error: upErr } = await svc.storage.from("quote-visuals").upload(fileName, bytes, {
      contentType: "image/png", upsert: false,
    });
    if (upErr) {
      return new Response(JSON.stringify({ error: "upload_failed", detail: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signed } = await svc.storage.from("quote-visuals").createSignedUrl(fileName, 60 * 60 * 24 * 365 * 5);
    const imageUrl = signed?.signedUrl ?? "";

    // Insert visual row (under user's RLS)
    if (quote_id) {
      const { error: insErr } = await userClient.from("quote_visuals").insert({
        organization_id: organizationId, quote_id, section_id: section_id ?? null,
        kind, image_url: imageUrl, caption: caption ?? prompt.slice(0, 240),
        source: "ai", created_by: user.id,
      } as any);
      if (insErr) {
        return new Response(JSON.stringify({ error: "insert_failed", detail: insErr.message, image_url: imageUrl }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (template_id) {
      const { error: insErr } = await userClient.from("quote_template_visuals").insert({
        organization_id: organizationId, template_id, section_id: section_id ?? null,
        kind, image_url: imageUrl, caption: caption ?? prompt.slice(0, 240), created_by: user.id,
      } as any);
      if (insErr) {
        return new Response(JSON.stringify({ error: "insert_failed", detail: insErr.message, image_url: imageUrl }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, image_url: imageUrl, path: fileName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "internal", detail: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
