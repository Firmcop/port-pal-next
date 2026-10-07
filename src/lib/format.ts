import i18n from "@/i18n";
import { currentLang } from "@/lib/i18n-locale";
import { getDefaultCurrency } from "@/lib/finance-format";

function lng(override?: string) {
  return override || currentLang();
}

export function formatCurrency(amount: number, currency?: string, lngOverride?: string) {
  const code = currency || getDefaultCurrency();
  try {
    return new Intl.NumberFormat(lng(lngOverride), { style: "currency", currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export function formatNumber(value: number, lngOverride?: string) {
  return new Intl.NumberFormat(lng(lngOverride)).format(value);
}

export function formatDate(d: Date | string | number, lngOverride?: string) {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat(lng(lngOverride), { dateStyle: "medium" }).format(date);
}

export function formatDateTime(d: Date | string | number, lngOverride?: string) {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat(lng(lngOverride), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Localized countdown text. Returns a tuple of {text, tickMs, expired}.
 * Uses i18next plurals/keys under namespace "trial".
 */
export function formatCountdown(ms: number): { text: string; tickMs: number; expired: boolean } {
  const t = i18n.getFixedT(null, "trial");
  if (ms <= 0) return { text: t("ended"), tickMs: 60_000, expired: true };
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (days >= 1) {
    return {
      text: t("remaining_dh", {
        days: t("unit_day", { count: days }),
        hours: t("unit_hour", { count: hours }),
      }),
      tickMs: 60_000,
      expired: false,
    };
  }
  if (hours >= 1) {
    return {
      text: t("remaining_hm", {
        hours: t("unit_hour", { count: hours }),
        mins: t("unit_minute", { count: mins }),
      }),
      tickMs: 30_000,
      expired: false,
    };
  }
  return {
    text: t("remaining_ms", {
      mins: t("unit_minute", { count: mins }),
      seconds: t("unit_second", { count: seconds }),
    }),
    tickMs: 1000,
    expired: false,
  };
}

/**
 * Returns a user-friendly label for a financial account type.
 * Falls back to "Account" when the type is missing so dropdowns never render broken values.
 */
export function formatAccountTypeLabel(accountType?: string | null) {
  if (!accountType) return "Account";
  return accountType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
