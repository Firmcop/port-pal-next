import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FinancialAccount = {
  id: string;
  name: string;
  account_type: string;
  currency: string | null;
  is_active: boolean;
};

export function useFinancialAccounts() {
  return useQuery<FinancialAccount[]>({
    queryKey: ["financial-accounts-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financial_accounts")
        .select("id, name, account_type, currency, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
