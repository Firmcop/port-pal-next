import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

export interface GlBalanceRow {
  gl_account_id: string;
  code: string;
  name: string;
  account_type: string;
  /** Company base currency — every amount below is converted into it. */
  currency: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

/**
 * GL account balances in the company's base currency.
 * - P&L: pass both dates (activity within the period).
 * - Balance sheet / Trial balance: pass only `to` (position as at that date).
 */
export function useGlBalances(from: string | null, to: string | null, channel: string) {
  useRealtimeInvalidate([{ table: "accounting_transactions", queryKeys: ["gl-balances"] }], channel);
  return useQuery({
    queryKey: ["gl-balances", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("gl_account_balances", { _from: from, _to: to });
      if (error) throw error;
      return (data ?? []) as GlBalanceRow[];
    },
  });
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const startOfYearISO = () => `${new Date().getFullYear()}-01-01`;
