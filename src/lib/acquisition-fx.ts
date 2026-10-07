import { format } from "date-fns";
import type { AcqInvoice } from "@/lib/acquisition-costs";

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const money = (n: unknown, c?: string | null) =>
  `${(c || "").toUpperCase()} ${num(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();

export const rateStr = (r: unknown) =>
  num(r).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export const dateStr = (d?: string | null) => {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : format(parsed, "dd MMM yyyy");
};

export interface FxConversion {
  /** Nothing to convert — the invoice is already in the base currency. */
  sameCurrency: boolean;
  /** True when the invoice is foreign but carries no locked rate. */
  missing: boolean;
  rate: number | null;
  rateDate: string | null;
  baseAmount: number | null;
  /** Human line: "USD 3,000.00 x 132.50 = KES 397,500.00 (rate of 12 Aug 2026)". */
  text: string | null;
}

/**
 * Explain how one acquisition invoice converts into the organisation's base
 * currency: which rate was locked to it, when that rate was set, and the
 * resulting base-currency amount.
 */
export function describeFx(
  inv: Pick<AcqInvoice, "currency" | "total_amount" | "fx_rate" | "base_amount"> & { issue_date?: string | null },
  baseCurrency: string,
): FxConversion {
  const base = (baseCurrency || "USD").toUpperCase();
  const cur = (inv.currency || base).toUpperCase();
  if (cur === base) {
    return { sameCurrency: true, missing: false, rate: 1, rateDate: null, baseAmount: num(inv.total_amount), text: null };
  }

  const amount = num(inv.total_amount);
  const storedBase = num(inv.base_amount);
  const rate = num(inv.fx_rate) || (amount > 0 && storedBase > 0 ? storedBase / amount : 0);
  if (!rate) {
    return { sameCurrency: false, missing: true, rate: null, rateDate: null, baseAmount: null, text: null };
  }

  const converted = storedBase > 0 ? storedBase : Math.round(amount * rate * 100) / 100;
  const on = dateStr(inv.issue_date ?? null);
  return {
    sameCurrency: false,
    missing: false,
    rate,
    rateDate: on,
    baseAmount: converted,
    text: `${money(amount, cur)} x ${rateStr(rate)} = ${money(converted, base)}${on ? ` (rate of ${on})` : ""}`,
  };
}
