import { useParams, Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import LoanReconciliationPanel from "@/components/finance/LoanReconciliationPanel";
import { ArrowLeft, Scale } from "lucide-react";

export default function LoanReconciliation() {
  const { id } = useParams<{ id: string }>();

  const { data: loan } = useQuery({
    queryKey: ["loan", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("loan_facilities").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: balance } = useQuery({
    queryKey: ["loan-balance-row", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("loan_balances");
      if (error) throw error;
      return (data ?? []).find((r: any) => r.loan_id === id) ?? null;
    },
  });

  if (!id) return null;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-1 -ml-2">
          <Link to={`/finance/loans/${id}`}><ArrowLeft className="h-4 w-4 mr-1" />Back to loan</Link>
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scale className="h-6 w-6" />Statement reconciliation
        </h1>
        <p className="text-muted-foreground text-sm">
          {loan?.lender_name ?? "Loan"} {loan?.reference ? `· ${loan.reference}` : ""}
        </p>
      </div>

      <LoanReconciliationPanel
        loanId={id}
        currency={loan?.currency ?? balance?.currency}
        stmtBalance={loan?.stmt_principal_outstanding ?? null}
        systemBalance={balance?.principal_outstanding ?? null}
      />
    </div>
  );
}
