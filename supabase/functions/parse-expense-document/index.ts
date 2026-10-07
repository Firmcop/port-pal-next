import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM = `You extract structured data from supplier invoices, bills and receipts for an accounting system.
Return ONLY a JSON object, no prose, with this shape:
{
  "vendor_name": string|null,
  "invoice_number": string|null,
  "invoice_date": "YYYY-MM-DD"|null,
  "due_date": "YYYY-MM-DD"|null,
  "currency": string|null,
  "subtotal": number|null,
  "tax_amount": number|null,
  "total_amount": number|null,
  "lines": [{ "description": string, "amount": number, "tax_amount": number|null }],
  "confidence": number
}
Amounts are plain numbers without thousand separators. If a value is not visible, use null.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const storagePath: string | undefined = body?.storage_path;
    const attachmentId: string | undefined = body?.attachment_id;
    let mime: string = body?.mime_type ?? "application/pdf";
    let fileName: string = body?.file_name ?? "document";
    let base64: string | undefined = body?.file_base64;

    if (!base64) {
      if (!storagePath || typeof storagePath !== "string") {
        return new Response(JSON.stringify({ error: "storage_path or file_base64 is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: file, error: dlErr } = await supabase.storage.from("expense-receipts").download(storagePath);
      if (dlErr || !file) {
        return new Response(JSON.stringify({ error: `Could not read file: ${dlErr?.message ?? "not found"}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      mime = file.type || mime;
      fileName = storagePath.split("/").pop() ?? fileName;
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buf.length; i += 8192) {
        binary += String.fromCharCode(...buf.subarray(i, i + 8192));
      }
      base64 = btoa(binary);
    }

    const isImage = mime.startsWith("image/");
    const contentBlock = isImage
      ? { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }
      : { type: "file", file: { filename: fileName, file_data: `data:${mime};base64,${base64}` } };

    const aiRes = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Lovable-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the supplier invoice details from this document." },
              contentBlock,
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const details = await aiRes.text();
      console.error(`AI gateway failed [${aiRes.status}]: ${details}`);
      const message = aiRes.status === 429
        ? "AI rate limit reached — try again shortly."
        : aiRes.status === 402
        ? "AI credits exhausted — top up credits to keep using extraction."
        : "Document extraction failed.";
      return new Response(JSON.stringify({ error: message, status: aiRes.status, details }), {
        status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await aiRes.json();
    const raw: string = payload?.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    let extracted: any;
    try {
      extracted = JSON.parse(jsonText);
    } catch {
      const match = jsonText.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : null;
    }
    if (!extracted) {
      return new Response(JSON.stringify({ error: "Could not read any details from this document." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (attachmentId) {
      await supabase
        .from("operating_expense_attachments")
        .update({
          extraction_status: "extracted",
          extracted_data: extracted,
          extracted_at: new Date().toISOString(),
        })
        .eq("id", attachmentId);
    }

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-expense-document error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
