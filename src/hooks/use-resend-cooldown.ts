import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_PREFIX = "resend_next_allowed:";

function readNext(email: string): number {
  if (!email) return 0;
  const v = localStorage.getItem(STORAGE_PREFIX + email.toLowerCase());
  return v ? parseInt(v, 10) : 0;
}
function writeNext(email: string, ts: number) {
  localStorage.setItem(STORAGE_PREFIX + email.toLowerCase(), String(ts));
}

export type ResendResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hourly_limit" | "error"; retryAfter?: number; message?: string };

export function useResendCooldown(email: string) {
  const [nextAllowedAt, setNextAllowedAt] = useState<number>(() => readNext(email));
  const [now, setNow] = useState<number>(() => Date.now());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setNextAllowedAt(readNext(email));
  }, [email]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((nextAllowedAt - now) / 1000));
  const canResend = secondsLeft === 0 && !submitting && !!email;

  const trigger = useCallback(async (): Promise<ResendResult> => {
    if (!email) return { ok: false, reason: "error", message: "No email" };
    setSubmitting(true);
    try {
      // Throttle check via DB RPC
      const { data, error } = await supabase.rpc("request_signup_resend", { _email: email });
      if (error) {
        const msg = error.message || "";
        const m = msg.match(/(cooldown|hourly_limit):(\d+)/);
        if (m) {
          const retry = parseInt(m[2], 10) * 1000;
          const next = Date.now() + retry;
          writeNext(email, next);
          setNextAllowedAt(next);
          return { ok: false, reason: m[1] as "cooldown" | "hourly_limit", retryAfter: parseInt(m[2], 10) };
        }
        return { ok: false, reason: "error", message: msg };
      }
      const d = (data ?? {}) as { next_allowed_at?: string };
      const next = d.next_allowed_at ? new Date(d.next_allowed_at).getTime() : Date.now() + 60_000;
      writeNext(email, next);
      setNextAllowedAt(next);

      const { error: rErr } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (rErr) return { ok: false, reason: "error", message: rErr.message };
      return { ok: true };
    } finally {
      setSubmitting(false);
    }
  }, [email]);

  return { secondsLeft, canResend, submitting, trigger };
}
