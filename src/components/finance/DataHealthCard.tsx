import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

type Finding = {
  organization_id: string;
  finding_code: string;
  severity: "high" | "medium" | "low";
  count: number;
  detail: string;
};

const SEV_STYLE: Record<string, string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted text-muted-foreground",
};

const LABELS: Record<string, string> = {
  orphan_gl_account: "Ledger entries not linked to Chart of Accounts",
  null_currency: "Ledger entries missing currency",
  unbalanced_currency_ledger: "Currency ledger out of balance",
  unbilled_container_sale: "Container sales without invoice",
  payment_missing_currency: "Payments missing currency",
  po_payment_currency_mismatch: "Vendor payments in a different currency to their purchase order",
  po_invoice_currency_mismatch: "Supplier invoices in a different currency to their purchase order",
  vendor_payment_currency_mismatch: "Vendor payments in a different currency to their purchase order",
  supplier_invoice_currency_mismatch: "Supplier invoices in a different currency to their purchase order",
  foreign_doc_missing_fx: "Foreign-currency documents without an FX rate",
  self_billed_purchase_invoice: "Purchase invoices raised against our own company",
  customer_invoice_currency_mismatch: "Sales invoices in a different currency to the customer's registered currency",
};


export function DataHealthCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: findings } = useQuery({
    queryKey: ["finance-data-health"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_finance_data_health").select("*");
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
  });

  const refresh = () =>
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("finance-") });

  async function billSales() {
    setBusy("bill");
    try {
      const { data, error } = await (supabase as any).rpc("bill_unbilled_container_sales");
      if (error) throw error;
      toast({ title: "Invoices generated", description: `${data?.length ?? 0} sale(s) billed.` });
      refresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function balanceCurrency(currency: string) {
    setBusy(`bal-${currency}`);
    try {
      const { error } = await (supabase as any).rpc("post_currency_balancing_journal", {
        _currency: currency,
        _reason: "Auto-balancing journal (Data Health)",
      });
      if (error) throw error;
      toast({ title: "Balancing journal posted", description: `${currency} ledger now balanced.` });
      refresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (!findings) return null;
  if (findings.length === 0) {
    return (
      <Card className="border-success/40 bg-success/5">
        <CardContent className="p-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-success" />
          <div className="flex-1">
            <p className="text-sm font-medium">Finance data is healthy.</p>
            <p className="text-xs text-muted-foreground">No integrity issues detected.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-warning/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-warning">
          <AlertTriangle className="h-4 w-4" />
          Finance Data Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {findings.map((f) => (
          <div key={f.finding_code} className="flex items-center gap-3 py-1.5">
            <Badge variant="secondary" className={SEV_STYLE[f.severity]}>{f.severity}</Badge>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {LABELS[f.finding_code] ?? f.finding_code}
              </p>
              <p className="text-xs text-muted-foreground truncate">{f.detail}</p>
            </div>
            <span className="font-mono text-sm tabular-nums">{f.count}</span>
            {f.finding_code === "unbilled_container_sale" && (
              <Button size="sm" variant="outline" onClick={billSales} disabled={busy === "bill"}>
                <Wand2 className="h-3 w-3 mr-1" />
                {busy === "bill" ? "Billing…" : "Auto-bill"}
              </Button>
            )}
            {f.finding_code === "unbalanced_currency_ledger" && (
              <>
                {["KES", "USD", "EUR", "GBP"].map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant="outline"
                    onClick={() => balanceCurrency(c)}
                    disabled={busy === `bal-${c}`}
                  >
                    Balance {c}
                  </Button>
                ))}
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
