import { getAppSettings, setAppSettings, formatMoney as fmtMoneyFromSettings } from "@/lib/app-settings";

/**
 * Legacy shim — all formatting now flows through `@/lib/app-settings`. Kept
 * exported so existing imports across the codebase continue to work.
 */
export function setDefaultCurrency(code: string | null | undefined) {
  if (code && typeof code === "string") setAppSettings({ currency: code });
}

export function getDefaultCurrency() {
  return getAppSettings().currency;
}

export function fmtMoney(n: any, currency?: string) {
  return fmtMoneyFromSettings(n, currency);
}

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expense",
  cost_of_goods: "Cost of Goods",
};

export const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "revenue", "cost_of_goods", "expense"] as const;
