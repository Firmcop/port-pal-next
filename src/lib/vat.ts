import { roundMoney } from "@/lib/money";

/** Kenya standard VAT rate. */
export const VAT_RATE = 16;

/**
 * How VAT applies to an invoice. VAT is a choice per invoice, never a default:
 * - "none":     no VAT on this invoice
 * - "added":    the amount entered is net; 16% VAT is added on top
 * - "included": the amount entered already contains 16% VAT
 */
export type VatMode = "none" | "added" | "included";

export const VAT_MODE_LABELS: Record<VatMode, string> = {
  none: "No VAT",
  added: `Add ${VAT_RATE}% VAT`,
  included: `${VAT_RATE}% VAT included in price`,
};

export function computeVat(amount: number, mode: VatMode, currency: string) {
  const a = roundMoney(Number(amount) || 0, currency);
  if (mode === "added") {
    const taxAmount = roundMoney(a * (VAT_RATE / 100), currency);
    return { subtotal: a, taxRate: VAT_RATE, taxAmount, total: roundMoney(a + taxAmount, currency) };
  }
  if (mode === "included") {
    const subtotal = roundMoney(a / (1 + VAT_RATE / 100), currency);
    return { subtotal, taxRate: VAT_RATE, taxAmount: roundMoney(a - subtotal, currency), total: a };
  }
  return { subtotal: a, taxRate: 0, taxAmount: 0, total: a };
}
