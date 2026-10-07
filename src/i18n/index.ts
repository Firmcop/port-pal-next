import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en";
import fr from "./locales/fr";
import es from "./locales/es";
import ar from "./locales/ar";
import sw from "./locales/sw";

export const SUPPORTED_LANGS = ["en", "fr", "es", "ar", "sw"] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];

export const LANG_NAMES: Record<AppLang, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  ar: "العربية",
  sw: "Kiswahili",
};

export const RTL_LANGS: AppLang[] = ["ar"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en, fr, es, ar, sw },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    nonExplicitSupportedLngs: true,
    ns: ["common", "auth", "trial", "nav", "onboarding", "reports"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "app_lang",
      caches: ["localStorage"],
    },
    returnNull: false,
  });

export default i18n;
