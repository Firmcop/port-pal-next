import i18n, { SUPPORTED_LANGS, RTL_LANGS, type AppLang } from "@/i18n";

const COUNTRY_TO_LANG: Record<string, AppLang> = {
  // Swahili
  KE: "sw", UG: "sw", TZ: "sw", RW: "sw",
  // French
  FR: "fr", BE: "fr", CH: "fr", SN: "fr", MA: "fr", DZ: "fr",
  // Spanish
  ES: "es", AR: "es", CL: "es", CO: "es", MX: "es", PE: "es",
  // Arabic
  SA: "ar", AE: "ar", EG: "ar", IQ: "ar", KW: "ar", QA: "ar", OM: "ar",
};

export function resolveLanguageFromCountry(code?: string | null): AppLang {
  if (!code) return "en";
  return COUNTRY_TO_LANG[code.toUpperCase()] ?? "en";
}

export function applyLanguage(lng: string) {
  const safe = (SUPPORTED_LANGS as readonly string[]).includes(lng) ? lng : "en";
  if (i18n.language !== safe) i18n.changeLanguage(safe);
  try { localStorage.setItem("app_lang", safe); } catch {}
  if (typeof document !== "undefined") {
    document.documentElement.lang = safe;
    document.documentElement.dir = (RTL_LANGS as string[]).includes(safe) ? "rtl" : "ltr";
  }
}

export function currentLang(): AppLang {
  const l = (i18n.language || "en").split("-")[0];
  return ((SUPPORTED_LANGS as readonly string[]).includes(l) ? l : "en") as AppLang;
}
