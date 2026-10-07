import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, ExternalLink, Receipt, RefreshCw } from "lucide-react";
import { Link } from "@/lib/router";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { RepatriationSettlementBadge } from "./RepatriationSettlementBadge";

type Props = {
  repatriationId: string;
  repatriationNumber: string;
  organizationId: string | null;
  onRecordPayment: (ctx: { outstanding: number; currency: string }) => void;
};

export function RepatriationBillingCard({
  repatriationId, repatriationNumber, organizationId, onRecordPayment,
}: Props) {
  const qc = useQueryClient();
  const [fixing, setFixing] = useState(false);
  const invoiceQ = useQuery({
    queryKey: ["repatriation-invoice", repatriationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, currency, status, total_amount, subtotal, tax_amount, issued_at, paid_at, notes, invoice_line_items(id, description, quantity, unit_price, total_price, charge_type)")
        .eq("organization_id", organizationId!)
        .eq("invoice_number", `REP-${repatriationNumber}`)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const invoiceId = (invoiceQ.data as any)?.id as string | undefined;

  const paymentsQ = useQuery({
    queryKey: ["repatriation-invoice-payments", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, payment_number, amount, payment_method, reference_number, paid_at, notes")
        .eq("invoice_id", invoiceId!)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (invoiceQ.isLoading) return <Skeleton className="h-32 w-full" />;

  const inv: any = invoiceQ.data;
  if (!inv) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4" /> Billing</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No invoice yet. Complete the repatriation to generate a draft invoice for the container owner.
        </CardContent>
      </Card>
    );
  }

  const paidTotal = (paymentsQ.data ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const outstanding = Math.max(0, Number(inv.total_amount) - paidTotal);
  const fmt = (n: number) => `${inv.currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Receipt className="h-4 w-4" /> Billing
          <span className="font-mono text-xs text-muted-foreground">{inv.invoice_number}</span>
          <Badge variant="outline" className="font-mono">{inv.currency}</Badge>
          <RepatriationSettlementBadge invoice={inv} paidTotal={paidTotal} />
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/billing/invoices"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Open</Link>
          </Button>
          {inv.status !== "paid" && (
            <Button
              variant="outline"
              size="sm"
              disabled={fixing}
              onClick={async () => {
                setFixing(true);
                const { error } = await supabase.rpc("restamp_repatriation_invoice_currency" as any, { _invoice_id: inv.id });
                setFixing(false);
                if (error) return toast({ title: "Fix failed", description: error.message, variant: "destructive" });
                toast({ title: "Invoice currency restamped from owner registry" });
                qc.invalidateQueries({ queryKey: ["repatriation-invoice", repatriationId] });
              }}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> {fixing ? "Fixing…" : "Fix currency"}
            </Button>
          )}
          {outstanding > 0 && (
            <Button size="sm" onClick={() => onRecordPayment({ outstanding, currency: inv.currency })}>
              <CreditCard className="mr-1 h-3.5 w-3.5" /> Record payment
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(inv.invoice_line_items ?? []).map((li: any) => (
              <TableRow key={li.id}>
                <TableCell>
                  <div>{li.description}</div>
                  <Badge variant="outline" className="mt-1 text-[10px] capitalize">{li.charge_type?.replace("_"," ")}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{Number(li.quantity).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono">{fmt(Number(li.unit_price))}</TableCell>
                <TableCell className="text-right font-mono">{fmt(Number(li.total_price))}</TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2">
              <TableCell colSpan={3} className="font-semibold text-right">Total</TableCell>
              <TableCell className="text-right font-mono font-semibold">{fmt(Number(inv.total_amount))}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} className="text-right text-muted-foreground">Paid</TableCell>
              <TableCell className="text-right font-mono">{fmt(paidTotal)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} className="text-right font-medium">Outstanding</TableCell>
              <TableCell className={`text-right font-mono font-semibold ${outstanding <= 0 ? "text-success" : "text-warning"}`}>{fmt(outstanding)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {(paymentsQ.data?.length ?? 0) > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Payments</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Paid at</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(paymentsQ.data ?? []).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.payment_number}</TableCell>
                    <TableCell className="capitalize">{p.payment_method?.replace("_"," ")}</TableCell>
                    <TableCell>{p.reference_number || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.paid_at ? format(new Date(p.paid_at), "PPp") : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(Number(p.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
