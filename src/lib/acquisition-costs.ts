/**
 * Container acquisition cost helpers.
 *
 * A container's acquisition cost is the sum of up to three purchase invoices:
 *   1. the seller (purchase price)            -> reason "purchase"
 *   2. the transporter that delivered it      -> reason "acquisition_transport"
 *   3. the crane / offloading contractor      -> reason "acquisition_crane_offloading"
 *
 * The total shown in the UI is ALWAYS derived from the live invoices, never
 * from the amounts typed at intake, so a corrected or credited invoice flows
 * straight through to the container page.
 */

export const ACQ_REASONS = [
  "purchase",
  "acquisition_transport",
  "acquisition_crane_offloading",
] as const;

export type AcqReason = (typeof ACQ_REASONS)[number];

export const ACQ_LABELS: Record<AcqReason, string> = {
  purchase: "Seller (purchase price)",
  acquisition_transport: "Transport / delivery",
  acquisition_crane_offloading: "Crane / offloading",
};

/** Statuses that must not contribute to the acquisition total. */
export const VOID_STATUSES = ["cancelled", "void", "credited", "draft_void"];

export interface AcqInvoice {
  id: string;
  invoice_number: string;
  reason: string;
  total_amount: number | string | null;
  paid_amount?: number | string | null;
  currency: string | null;
  status: string | null;
  fx_rate?: number | string | null;
  base_amount?: number | string | null;
  issue_date?: string | null;

  suppliers?: { name: string | null } | null;
}

export interface AcqTotal {
  /** Single-currency total, or the base-currency total when conversion was possible. */
  total: number | null;
  currency: string;
  /** True when invoices span currencies and no reliable conversion exists. */
  mixed: boolean;
  /** Per-currency subtotals — always populated. */
  byCurrency: { currency: string; amount: number }[];
  /** Invoices excluded from the total because they are void/credited. */
  excluded: number;
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function isVoidInvoice(inv: Pick<AcqInvoice, "status">): boolean {
  return VOID_STATUSES.includes(String(inv.status ?? "").toLowerCase());
}

/**
 * Sum the acquisition invoices.
 *
 * - Void / credited invoices are excluded from the sum (but still listed).
 * - Same currency everywhere -> plain total.
 * - Mixed currencies -> converted with each invoice's stored `base_amount`
 *   (the FX-locked value) when every foreign invoice has one; otherwise the
 *   caller gets a per-currency breakdown instead of a misleading number.
 */
export function computeAcquisitionTotal(
  invoices: AcqInvoice[],
  baseCurrency: string,
): AcqTotal {
  const base = (baseCurrency || "USD").toUpperCase();
  const live = invoices.filter((i) => !isVoidInvoice(i));
  const excluded = invoices.length - live.length;

  const byCurrencyMap = new Map<string, number>();
  for (const inv of live) {
    const cur = (inv.currency || base).toUpperCase();
    byCurrencyMap.set(cur, (byCurrencyMap.get(cur) ?? 0) + num(inv.total_amount));
  }
  const byCurrency = Array.from(byCurrencyMap, ([currency, amount]) => ({ currency, amount }));

  if (byCurrency.length === 0) {
    return { total: 0, currency: base, mixed: false, byCurrency, excluded };
  }
  if (byCurrency.length === 1) {
    return { total: byCurrency[0].amount, currency: byCurrency[0].currency, mixed: false, byCurrency, excluded };
  }

  const convertible = live.every((inv) => {
    const cur = (inv.currency || base).toUpperCase();
    return cur === base || num(inv.base_amount) > 0;
  });
  if (convertible) {
    const total = live.reduce((s, inv) => {
      const cur = (inv.currency || base).toUpperCase();
      return s + (cur === base ? num(inv.total_amount) : num(inv.base_amount));
    }, 0);
    return { total, currency: base, mixed: false, byCurrency, excluded };
  }

  return { total: null, currency: base, mixed: true, byCurrency, excluded };
}

/**
 * Convert a single acquisition invoice into the base currency.
 *
 * Foreign invoices carry an FX-locked `base_amount` (and the `fx_rate` used).
 * When neither is present we cannot convert, and the caller must flag the
 * amount rather than silently treating a USD figure as KES.
 */
export function invoiceInBase(
  inv: AcqInvoice,
  baseCurrency: string,
): { amount: number; converted: boolean; rate: number | null; sourceCurrency: string } {
  const base = (baseCurrency || "USD").toUpperCase();
  const cur = (inv.currency || base).toUpperCase();
  const raw = num(inv.total_amount);
  if (cur === base) return { amount: raw, converted: true, rate: 1, sourceCurrency: cur };

  const stored = num(inv.base_amount);
  if (stored > 0) {
    return { amount: stored, converted: true, rate: raw > 0 ? stored / raw : num(inv.fx_rate) || null, sourceCurrency: cur };
  }
  const fx = num(inv.fx_rate);
  if (fx > 0) return { amount: raw * fx, converted: true, rate: fx, sourceCurrency: cur };

  return { amount: raw, converted: false, rate: null, sourceCurrency: cur };
}


/** Rows for the three services, whether or not an invoice exists yet. */
export function acquisitionRows(invoices: AcqInvoice[]) {
  return ACQ_REASONS.map((reason) => ({
    reason,
    label: ACQ_LABELS[reason],
    invoices: invoices.filter((i) => i.reason === reason),
  }));
}
