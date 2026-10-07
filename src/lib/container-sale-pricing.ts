import { supabase } from "@/integrations/supabase/client";

export interface SalePricingResult {
  entry_price: number;
  selling_price: number;
  markup_percentage: number;
  currency: string;
  delta_cogs: number;
  delta_revenue: number;
  ledger_posted: boolean;
  invoice_updated: boolean;
}

/**
 * Markup implied by an entry (acquisition) price and a typed selling price.
 * Returns 0 when there is no entry price to mark up.
 */
export function deriveMarkup(entry: number | string | null | undefined, selling: number | string | null | undefined): number {
  const e = Number(entry ?? 0);
  const s = Number(selling ?? 0);
  if (!Number.isFinite(e) || !Number.isFinite(s) || e <= 0) return 0;
  return Math.round(((s / e) - 1) * 100 * 100) / 100;
}

/**
 * Single call site for `set_sale_pricing`: refreshes the sale's entry price
 * from the container's live acquisition invoices, stores the typed selling
 * price, recomputes the markup and keeps the customer invoice + ledger in step.
 */
export async function setSalePricing(saleId: string, sellingPrice: number, reason: string): Promise<SalePricingResult> {
  if (!saleId) throw new Error("Sale is required");
  const price = Number(sellingPrice);
  if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid selling price");
  const why = (reason ?? "").trim();
  if (!why) throw new Error("A reason is required");

  const { data, error } = await supabase.rpc("set_sale_pricing" as any, {
    _id: saleId,
    _selling_price: price,
    _reason: why,
  });
  if (error) throw error;
  return data as unknown as SalePricingResult;
}
