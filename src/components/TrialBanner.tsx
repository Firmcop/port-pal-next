import { useEffect, useState } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { Link } from "@/lib/router";
import { Sparkles, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCountdown } from "@/lib/format";

export function TrialBanner() {
  const org = useOrganization();
  const { t, i18n } = useTranslation(["trial", "common"]);
  const [now, setNow] = useState(() => Date.now());

  const endsAt = org.trialEndsAt ? new Date(org.trialEndsAt).getTime() : null;
  const info = endsAt ? formatCountdown(endsAt - now) : null;

  useEffect(() => {
    if (!info) return;
    const tick = setInterval(() => setNow(Date.now()), info.tickMs);
    return () => clearInterval(tick);
  // re-create timer on language change so localized text re-renders
  }, [info?.tickMs, i18n.language]);

  if (org.loading || !org.organizationId) return null;
  if (org.status !== "trial" || !info) return null;

  const Icon = info.expired ? AlertCircle : Sparkles;
  const tone = info.expired
    ? "bg-destructive/10 border-destructive/20 text-destructive"
    : "bg-primary/10 border-primary/20";

  return (
    <div className={`border-b px-4 py-2 text-sm flex items-center gap-2 ${tone}`}>
      <Icon className="h-4 w-4" />
      <span>{t("trial:on_trial")} <strong>{info.text}</strong></span>
      <Link to="/settings/subscription" className="ms-auto font-medium hover:underline">
        {t("common:manage_subscription")} →
      </Link>
    </div>
  );
}
