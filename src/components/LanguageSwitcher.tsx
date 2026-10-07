import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANG_NAMES, SUPPORTED_LANGS, type AppLang } from "@/i18n";
import { applyLanguage } from "@/lib/i18n-locale";

type Props = { compact?: boolean; className?: string };

export function LanguageSwitcher({ compact, className }: Props) {
  const { i18n, t } = useTranslation("common");
  const current = (i18n.language?.split("-")[0] ?? "en") as AppLang;
  return (
    <Select value={current} onValueChange={(v) => applyLanguage(v)}>
      <SelectTrigger className={className} aria-label={t("language")}>
        <div className="flex items-center gap-2 truncate">
          <Languages className="h-4 w-4 shrink-0" />
          {!compact && <SelectValue placeholder={t("language")} />}
        </div>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGS.map((l) => (
          <SelectItem key={l} value={l}>{LANG_NAMES[l]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
