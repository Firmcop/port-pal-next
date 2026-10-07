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

    // Meta webhook verification (GET)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "depot-verify-token";

      if (mode === "subscribe" && token === verifyToken) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    // Meta webhook payload (POST)
    if (req.method === "POST") {
      const payload = await req.json();

      // Meta sends a specific structure
      const entry = payload?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages?.length) {
        // Status update or other non-message event
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const msg of value.messages) {
        const phone = msg.from; // sender phone number
        const body = msg.text?.body ?? "";
        const messageType = msg.type === "image" ? "image" : "text";

        // Find matching customer
        const { data: customer } = await supabase
          .from("customers")
          .select("id, company_name")
          .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
          .maybeSingle();

        // Parse intent using Lovable AI
        let parsedIntent = "unknown";
        let intentData: any = {};

        try {
          const aiResponse = await fetch(
            "https://ai-gateway.lovable.dev/api/chat",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  {
                    role: "system",
                    content: `You are a container depot assistant. Parse the user's WhatsApp message and determine their intent. 
Return JSON only with format: {"intent": "release"|"appointment"|"query", "data": {...}}
For release: extract container_number, driver_name, truck_plate, release_type (pickup/delivery/reposition)
For appointment: extract container_number, appointment_type (drop_off/pick_up), scheduled_date
For query: extract topic`,
                  },
                  { role: "user", content: body },
                ],
              }),
            }
          );
          const aiResult = await aiResponse.json();
          const parsed = JSON.parse(
            aiResult.choices?.[0]?.message?.content ?? "{}"
          );
          parsedIntent = parsed.intent ?? "unknown";
          intentData = parsed.data ?? {};
        } catch {
          parsedIntent = "unknown";
        }

        let linkedInstructionId = null;

        if (parsedIntent === "release" && customer) {
          const num = `REL-WA-${Date.now().toString(36).toUpperCase()}`;
          const { data: release } = await supabase
            .from("release_instructions")
            .insert({
              instruction_number: num,
              customer_id: customer.id,
              container_number: intentData.container_number ?? null,
              release_type: intentData.release_type ?? "pickup",
              driver_name: intentData.driver_name ?? null,
              truck_plate: intentData.truck_plate ?? null,
              source: "whatsapp",
              status: "pending",
            })
            .select("id")
            .single();
          linkedInstructionId = release?.id;
        }

        if (parsedIntent === "appointment" && customer) {
          const num = `APT-WA-${Date.now().toString(36).toUpperCase()}`;
          await supabase.from("gate_appointments").insert({
            appointment_number: num,
            appointment_type: intentData.appointment_type ?? "drop_off",
            container_number: intentData.container_number ?? null,
            scheduled_at:
              intentData.scheduled_date ?? new Date().toISOString(),
            shipping_line: customer.company_name,
            notes: `Created via WhatsApp: ${body}`,
          });
        }

        await supabase.from("whatsapp_messages").insert({
          customer_id: customer?.id ?? null,
          phone_number: phone,
          direction: "inbound",
          message_body: body,
          message_type: messageType,
          parsed_intent: parsedIntent,
          linked_instruction_id: linkedInstructionId,
          processed: true,
        });

        // Send confirmation reply via Meta Cloud API
        const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
        const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

        if (accessToken && phoneNumberId) {
          let replyBody =
            "Thank you for your message. We've received it and will process it shortly.";
          if (parsedIntent === "release")
            replyBody = `✅ Release instruction created for ${intentData.container_number ?? "your container"}. Status: Pending approval.`;
          if (parsedIntent === "appointment")
            replyBody = `✅ Appointment created for ${intentData.container_number ?? "your container"}.`;
          if (!customer)
            replyBody =
              "We couldn't identify your account. Please contact the depot directly.";

          await fetch(
            `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: phone,
                type: "text",
                text: { body: replyBody },
              }),
            }
          );
        }
      }

      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
