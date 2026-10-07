/**
 * Currency-aware money helpers. Rounding uses half-away-from-zero to the
 * correct number of minor units for the given ISO 4217 code.
 */

export const CURRENCY_MINOR_UNITS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 0, TWD: 0, UGX: 0, RWF: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};

export function currencyDigits(currency?: string | null): number {
  const c = (currency ?? "").toUpperCase();
  return CURRENCY_MINOR_UNITS[c] ?? 2;
}

/** Rounds to the currency's minor unit precision (uses toFixed to avoid IEEE-754 artefacts). */
export function roundMoney(amount: number | string | null | undefined, currency?: string | null): number {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return 0;
  const d = currencyDigits(currency);
  return Number(n.toFixed(d));
}

export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
  locale?: string,
): string {
  const code = (currency ?? "USD").toUpperCase();
  const d = currencyDigits(code);
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(locale ?? undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(d)}`;
  }
}

/** Currency code + amount (no locale symbol), e.g. "KES 12,345.00". */
export function formatMoneyCode(
  amount: number | string | null | undefined,
  currency?: string | null,
): string {
  const code = (currency ?? "USD").toUpperCase();
  const d = currencyDigits(code);
  const n = Number(amount ?? 0);
  return `${code} ${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export type TotalsInput = {
  subtotal: number | string | null | undefined;
  taxAmount: number | string | null | undefined;
  total: number | string | null | undefined;
};

/**
 * Throws when subtotal + tax doesn't equal total (after rounding to currency digits).
 * Safe to call before an invoice INSERT — mirrors the `check_invoice_totals` DB trigger.
 */
export function assertTotalsMatch(t: TotalsInput, currency?: string | null): void {
  const s = roundMoney(t.subtotal, currency);
  const x = roundMoney(t.taxAmount, currency);
  const g = roundMoney(t.total, currency);
  if (roundMoney(s + x, currency) !== g) {
    throw new Error(
      `Totals mismatch in ${(currency ?? "").toUpperCase()}: ${s} + ${x} ≠ ${g}`,
    );
  }
}
