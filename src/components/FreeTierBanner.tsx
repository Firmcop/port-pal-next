import { useOrganization } from "@/hooks/use-organization";
import { Link } from "@/lib/router";
import { Lock } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

export function FreeTierBanner() {
  const org = useOrganization();
  const { t } = useTranslation("common");
  if (org.loading || !org.organizationId) return null;
  if (org.status !== "free") return null;
  return (
    <div className="bg-warning/10 border-b border-warning/20 px-4 py-2 text-sm flex items-center gap-2">
      <Lock className="h-4 w-4 text-warning" />
      <span>
        <Trans i18nKey="free_banner" ns="common" defaults="You're on the <1>Free plan</1> — 1 user, core features only." components={[<span key="0" />, <strong key="1" />]} />
      </span>
      <Link to="/settings/subscription" className="ms-auto font-medium text-warning hover:underline">
        {t("upgrade", { defaultValue: "Upgrade" })} →
      </Link>
    </div>
  );
}
