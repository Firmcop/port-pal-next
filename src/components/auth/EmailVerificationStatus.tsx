import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, MailCheck, Clock } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useResendCooldown } from "@/hooks/use-resend-cooldown";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  email: string;
  verified: boolean;
  onChangeEmail?: () => void;
};

export function EmailVerificationStatus({ email, verified, onChangeEmail }: Props) {
  const { t } = useTranslation("auth");
  const { secondsLeft, canResend, submitting, trigger } = useResendCooldown(email);
  const [liveVerified, setLiveVerified] = useState(verified);

  useEffect(() => setLiveVerified(verified), [verified]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user?.email_confirmed_at) setLiveVerified(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleResend = async () => {
    const r = await trigger();
    if (r.ok === true) { toast.success(t("resend_sent", { email })); return; }
    const fail = r as Extract<typeof r, { ok: false }>;
    if (fail.reason === "cooldown") toast.error(t("cooldown_wait", { seconds: fail.retryAfter }));
    else if (fail.reason === "hourly_limit") toast.error(t("hourly_limit"));
    else toast.error(fail.message || t("resend_failed"));
  };

  if (liveVerified) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
        <div className="flex-1">
          <div className="font-medium">{t("verified")}</div>
          <div className="text-muted-foreground text-xs break-all">{email}</div>
        </div>
      </div>
    );
  }

  const cooldownPct = secondsLeft > 0 ? Math.max(0, 100 - (secondsLeft / 60) * 100) : 100;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm flex items-start gap-3">
        <MailCheck className="h-5 w-5 text-warning mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-medium">{t("awaiting_verification")}</div>
          <div className="text-muted-foreground text-xs break-all">{email}</div>
          <p className="text-xs mt-1">{t("verify_help")}</p>
        </div>
      </div>

      {secondsLeft > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{t("next_resend_in")} <strong>{secondsLeft}s</strong></span>
          </div>
          <Progress value={cooldownPct} className="h-1" />
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={handleResend} disabled={!canResend}>
        {submitting ? t("sending") : secondsLeft > 0 ? t("resend_in", { seconds: secondsLeft }) : t("resend")}
      </Button>

      {onChangeEmail && (
        <button onClick={onChangeEmail} className="block w-full text-xs text-primary hover:underline">
          {t("use_different_email")}
        </button>
      )}
    </div>
  );
}
