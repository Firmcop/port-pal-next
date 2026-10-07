import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve an FX rate from the org's `fx_rates` table via the
 * `get_fx_rate` SECURITY DEFINER RPC. Returns 1 when from == to.
 * Throws when no rate is available so callers can refuse to post
 * mismatched-currency ledger entries.
 */
export async function getFxRate(
  organizationId: string,
  from: string,
  to: string,
  on: Date | string = new Date(),
): Promise<number> {
  if (!from || !to || from.toUpperCase() === to.toUpperCase()) return 1;
  const asOf = typeof on === "string" ? on : on.toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("get_fx_rate" as any, {
    _org: organizationId,
    _from: from,
    _to: to,
    _on: asOf,
  });
  if (error) throw error;
  const rate = Number(data);
  if (!rate || Number.isNaN(rate)) {
    throw new Error(
      `Missing FX rate ${from} → ${to} on ${asOf}. Add it under Finance → FX Rates and retry.`,
    );
  }
  return rate;
}
