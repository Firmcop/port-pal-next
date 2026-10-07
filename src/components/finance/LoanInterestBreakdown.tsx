import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoneyCode } from "@/lib/money";
import { Percent } from "lucide-react";

type Breakdown = {
  currency: string;
  interest_charged: number;
  interest_paid: number;
  interest_outstanding: number;
  penalty_charged: number;
  penalty_paid: number;
  penalty_outstanding: number;
  fees_charged: number;
  fees_stamp_duty: number;
  fees_insurance: number;
  fees_other: number;
  accrued_interest: number;
  stmt_accrued_interest: number | null;
  accrual_variance: number | null;
};

export default function LoanInterestBreakdown({ loanId, currency }: { loanId: string; currency?: string }) {
  const { data } = useQuery<Breakdown | null>({
    queryKey: ["loan-interest-breakdown", loanId],
    enabled: !!loanId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("loan_interest_breakdown", { _loan_id: loanId });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as Breakdown | null;
    },
  });

  if (!data) return null;
  const cur = currency ?? data.currency;

  const rows: Array<{ label: string; charged: number; paid: number; outstanding: number; hint?: string }> = [
    { label: "Interest", charged: data.interest_charged, paid: data.interest_paid, outstanding: data.interest_outstanding },
    { label: "Penalty interest", charged: data.penalty_charged, paid: data.penalty_paid, outstanding: data.penalty_outstanding },
    {
      label: "Fees, duty & insurance",
      charged: data.fees_charged,
      paid: data.fees_charged,
      outstanding: 0,
      hint: `Charges ${formatMoneyCode(data.fees_other, cur)} · Stamp duty ${formatMoneyCode(data.fees_stamp_duty, cur)} · Insurance ${formatMoneyCode(data.fees_insurance, cur)}`,
    },
  ];

  const variance = data.accrual_variance;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Percent className="h-4 w-4" />Interest, penalties & fees
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left font-normal pb-1">Component</th>
                <th className="text-right font-normal pb-1">Charged</th>
                <th className="text-right font-normal pb-1">Paid</th>
                <th className="text-right font-normal pb-1">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t">
                  <td className="py-2">
                    <span className="font-medium">{r.label}</span>
                    {r.hint && <p className="text-xs text-muted-foreground">{r.hint}</p>}
                  </td>
                  <td className="py-2 text-right font-mono">{formatMoneyCode(r.charged, cur)}</td>
                  <td className="py-2 text-right font-mono">{formatMoneyCode(r.paid, cur)}</td>
                  <td className={`py-2 text-right font-mono ${r.outstanding > 0 ? "text-destructive" : ""}`}>
                    {formatMoneyCode(r.outstanding, cur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-md border p-3">
          <div>
            <p className="text-xs text-muted-foreground">Current accrued interest (system)</p>
            <p className="text-lg font-bold font-mono">{formatMoneyCode(data.accrued_interest, cur)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bank-declared accrued interest</p>
            <p className="text-lg font-bold font-mono">
              {data.stmt_accrued_interest != null ? formatMoneyCode(data.stmt_accrued_interest, cur) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Variance</p>
            {variance == null ? (
              <p className="text-lg font-bold font-mono">—</p>
            ) : (
              <p className={`text-lg font-bold font-mono ${Math.abs(variance) > 0.01 ? "text-destructive" : "text-success"}`}>
                {formatMoneyCode(variance, cur)}{" "}
                {Math.abs(variance) <= 0.01 && <Badge variant="secondary" className="bg-success/15 text-success align-middle">agrees</Badge>}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
