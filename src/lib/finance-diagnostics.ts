import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const LEGACY_ORG_ID = "00000000-0000-0000-0000-000000000001";

export const FINANCE_QUERY_KEYS = ["account-balances", "ar-aging-data", "ap-aging-data"] as const;

export async function syncFinanceData(queryClient: QueryClient) {
  const started = performance.now();
  try {
    await Promise.all(
      FINANCE_QUERY_KEYS.map((k) => queryClient.invalidateQueries({ queryKey: [k] }))
    );
    await Promise.all(
      FINANCE_QUERY_KEYS.map((k) => queryClient.refetchQueries({ queryKey: [k] }))
    );
    return { ok: true, durationMs: Math.round(performance.now() - started) };
  } catch (e: any) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - started),
      error: e?.message ?? String(e),
    };
  }
}

export type RowCounts = {
  gl_accounts: number | null;
  accounting_transactions: number | null;
  invoices: number | null;
  purchase_orders: number | null;
  error?: string;
};

export async function fetchVisibleRowCounts(): Promise<RowCounts> {
  const tables = ["gl_accounts", "accounting_transactions", "invoices", "purchase_orders"] as const;
  const out: RowCounts = {
    gl_accounts: null,
    accounting_transactions: null,
    invoices: null,
    purchase_orders: null,
  };
  try {
    const results = await Promise.all(
      tables.map((t) =>
        supabase.from(t as any).select("*", { count: "exact", head: true })
      )
    );
    results.forEach((r, i) => {
      if (r.error) out.error = `${tables[i]}: ${r.error.message}`;
      out[tables[i]] = r.count ?? 0;
    });
  } catch (e: any) {
    out.error = e?.message ?? String(e);
  }
  return out;
}
