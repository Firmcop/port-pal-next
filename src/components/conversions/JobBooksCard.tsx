import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { fmtMoney } from "@/lib/finance-format";
import { BookOpen } from "lucide-react";

/**
 * The job's figures as the books carry them (job_ledger_costs): the same
 * numbers the project page and the company P&L use.
 */
export function JobBooksCard({ conversionId }: { conversionId: string }) {
  const { data: j } = useQuery({
    queryKey: ["job-ledger-costs", conversionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("job_ledger_costs").select("*").eq("conversion_id", conversionId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  if (!j) return null;
  const margin = Number(j.revenue) - Number(j.total_cost);
  const cells: [string, number, string?][] = [
    ["Sales invoiced", j.revenue],
    ["Container(s)", j.container_cost],
    ["Materials", j.material_cost],
    ["Labour", j.labour_cost],
    ["Other costs", j.other_cost],
    ["Total cost", j.total_cost],
    ["Margin", margin, margin < 0 ? "text-destructive" : "text-success"],
  ];
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold flex items-center gap-1"><BookOpen className="h-4 w-4" />In the books</div>
          {Number(j.wip_balance) > 0.5 && (
            <div className="text-xs text-muted-foreground">
              {fmtMoney(j.wip_balance)} held in work in progress — moves to cost of sales when the job is completed or invoiced
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
          {cells.map(([label, v, cls]) => (
            <div key={label} className="rounded-md border p-2">
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className={`font-mono text-sm ${cls ?? ""}`}>{fmtMoney(v)}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Same figures as the project page and the company P&amp;L. Casual labour paid by M-Pesa is shared to jobs weekly from the labour recorded on them;
          M-Pesa material purchases are tagged in Finance → Cash to sort.
        </p>
      </CardContent>
    </Card>
  );
}
