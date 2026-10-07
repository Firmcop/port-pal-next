import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PayslipPdfSettings } from "@/lib/payslip-pdf";

/**
 * Resolves the active payslip PDF settings for the current org and language.
 * Falls back to a NULL-language row, then to library defaults.
 */
export function usePayslipPdfSettings(language?: string) {
  return useQuery({
    queryKey: ["payslip-pdf-settings", language ?? "default"],
    queryFn: async (): Promise<PayslipPdfSettings | null> => {
      const { data } = await (supabase as any)
        .from("payslip_pdf_settings")
        .select("*");
      const rows = (data ?? []) as any[];
      if (rows.length === 0) return null;
      const langRow = language ? rows.find((r) => r.language === language) : null;
      const defRow = rows.find((r) => r.language === null) ?? rows[0];
      return langRow ?? defRow ?? null;
    },
  });
}
