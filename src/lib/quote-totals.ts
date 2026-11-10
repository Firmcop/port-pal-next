/**
 * Quote totals with one discount for the whole quote (amount or %), taken off
 * the subtotal before tax. Mirrors the database function quote_totals(), which
 * stores quotes.total_amount and feeds generate_invoice_from_quote.
 *
 * Line discounts (discount_pct) are no longer offered in the editor; old lines
 * that still carry one are honoured so their totals do not change.
 */
export type QuoteDiscountType = "amount" | "percent";

export interface QuoteLine {
  quantity: number | string | null;
  unit_price: number | string | null;
  discount_pct?: number | string | null;
  tax_pct?: number | string | null;
}

export interface QuoteTotals {
  /** sum of line amounts before the quote discount and tax */
  subtotal: number;
  /** the quote discount in money */
  discount: number;
  /** subtotal − discount */
  net: number;
  /** tax on the discounted amounts */
  tax: number;
  total: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function lineNet(it: QuoteLine) {
  return n(it.quantity) * n(it.unit_price) * (1 - n(it.discount_pct) / 100);
}

export function quoteDiscountAmount(subtotal: number, type: QuoteDiscountType | null | undefined, value: number | string | null | undefined) {
  const v = Math.max(0, n(value));
  const d = type === "percent" ? (subtotal * Math.min(v, 100)) / 100 : v;
  return Math.min(r2(d), r2(Math.max(subtotal, 0)));
}

export function quoteTotals(
  items: QuoteLine[],
  discount?: { type?: QuoteDiscountType | null; value?: number | string | null } | null,
): QuoteTotals {
  const subtotal = r2(items.reduce((s, it) => s + lineNet(it), 0));
  const lineTax = items.reduce((s, it) => s + lineNet(it) * (n(it.tax_pct) / 100), 0);
  const d = quoteDiscountAmount(subtotal, discount?.type, discount?.value);
  const ratio = subtotal > 0 ? d / subtotal : 0;
  const tax = r2(lineTax * (1 - ratio));
  const net = r2(subtotal - d);
  return { subtotal, discount: d, net, tax, total: r2(net + tax) };
}
