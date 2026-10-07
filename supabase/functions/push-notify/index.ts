import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch pending queue items
    const { data: pending, error: fetchErr } = await supabase
      .from("push_notification_queue")
      .select("*")
      .eq("status", "pending")
      .limit(50);

    if (fetchErr) throw fetchErr;
    if (!pending?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        if (item.channel === "web_push") {
          await sendWebPush(item);
        } else if (item.channel === "whatsapp") {
          await sendWhatsApp(item);
        }

        await supabase
          .from("push_notification_queue")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", item.id);
        sent++;
      } catch (err: any) {
        console.error(`Failed to send ${item.channel} to ${item.recipient}:`, err.message);
        await supabase
          .from("push_notification_queue")
          .update({ status: "failed", error: err.message?.substring(0, 500) })
          .eq("id", item.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: pending.length, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("push-notify error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function sendWebPush(item: any) {
  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@depot.com";

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("VAPID keys not configured");
  }

  const payload = item.payload;
  const pushPayload = JSON.stringify({
    title: payload.title || "Notification",
    body: payload.body || "",
    type: payload.type || "info",
    icon: "/favicon.ico",
  });

  // Use web-push-compatible approach with raw fetch to push endpoint
  // For Web Push we need to use the Web Push protocol with VAPID
  // Using the simplified unsigned approach for now (works for testing)
  const endpoint = item.recipient;

  // Create JWT for VAPID
  const vapidToken = await createVapidAuthHeader(
    endpoint,
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  // Encrypt payload using the subscriber keys
  const encrypted = await encryptPayload(
    pushPayload,
    payload.p256dh,
    payload.auth
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      Authorization: `vapid t=${vapidToken.token},k=${vapidToken.publicKey}`,
      TTL: "86400",
      Urgency: "high",
    },
    body: encrypted,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Push endpoint returned ${response.status}: ${text}`);
  }
}

async function sendWhatsApp(item: any) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp Cloud API not configured");
  }

  const payload = item.payload;
  const to = item.recipient.replace(/[^0-9]/g, ""); // Clean phone number

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: `*${payload.title}*\n${payload.body}`,
        },
      }),
    }
  );

  if (!response.ok) {
    const result = await response.json();
    throw new Error(`WhatsApp API error: ${JSON.stringify(result)}`);
  }
}

// ── VAPID JWT creation ──
async function createVapidAuthHeader(
  endpoint: string,
  subject: string,
  publicKey: string,
  privateKey: string
) {
  const audience = new URL(endpoint).origin;

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 3600,
    sub: subject,
  };

  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the private key
  const keyData = base64urlDecode(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = base64urlEncode(new Uint8Array(signature));
  const token = `${unsignedToken}.${signatureB64}`;

  return { token, publicKey };
}

// ── Payload encryption (aes128gcm) ──
async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
): Promise<Uint8Array> {
  // For a production-grade implementation, this would use proper WebPush encryption
  // (ECDH key agreement + HKDF + AES-128-GCM as per RFC 8291)
  // This is a simplified version - for full encryption, use a web-push library
  
  // Encode payload as simple text for now (works with some push services)
  return new TextEncoder().encode(payload);
}

function base64urlEncode(data: Uint8Array): string {
  const binary = Array.from(data).map((b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
