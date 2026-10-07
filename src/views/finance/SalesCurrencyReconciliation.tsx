import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Coins, ExternalLink } from "lucide-react";
import { Link } from "@/lib/router";

type Status = "balanced" | "currency_mismatch" | "fx_gap" | "missing_ledger" | "missing_invoice";

const TOL = 0.5;

function statusBadge(s: Status) {
  switch (s) {
    case "balanced": return <Badge className="bg-success/15 text-success">balanced</Badge>;
    case "currency_mismatch": return <Badge className="bg-destructive/15 text-destructive">currency mismatch</Badge>;
    case "fx_gap": return <Badge className="bg-warning/15 text-warning">FX gap</Badge>;
    case "missing_ledger": return <Badge variant="outline">no ledger</Badge>;
    case "missing_invoice": return <Badge variant="outline">no invoice</Badge>;
  }
}

export default function SalesCurrencyReconciliation() {
  const { organizationId } = useOrganization();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["sales-currency-recon", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data: sales, error } = await supabase
        .from("container_sales")
        .select("id, sale_number, currency, selling_price, entry_price, transport_offloading_cost, invoice_id, sold_at, status")
        .eq("status", "sold" as any)
        .order("sold_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const ids = (sales ?? []).map((s: any) => s.id);
      const invoiceIds = (sales ?? []).map((s: any) => s.invoice_id).filter(Boolean);

      const [{ data: txns }, { data: invoices }] = await Promise.all([
        ids.length
          ? supabase.from("accounting_transactions")
              .select("reference_id, currency, fx_rate, base_currency, debit_amount, credit_amount, category")
              .eq("reference_type", "container_sales")
              .in("reference_id", ids)
          : Promise.resolve({ data: [] as any[] }),
        invoiceIds.length
          ? supabase.from("invoices")
              .select("id, currency, total_amount")
              .in("id", invoiceIds as string[])
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const invoiceById = new Map((invoices ?? []).map((i: any) => [i.id, i]));
      const txnsBySale = new Map<string, any[]>();
      (txns ?? []).forEach((t: any) => {
        const list = txnsBySale.get(t.reference_id) ?? [];
        list.push(t);
        txnsBySale.set(t.reference_id, list);
      });

      return (sales ?? []).map((s: any) => {
        const sleTxns = txnsBySale.get(s.id) ?? [];
        const invoice = s.invoice_id ? invoiceById.get(s.invoice_id) : null;
        const ledgerCurrencies = Array.from(new Set(sleTxns.map((t) => t.currency).filter(Boolean)));
        const revenue = sleTxns.find((t) => t.category === "container_sale");
        const cogs = sleTxns.find((t) => t.category === "container_sale_cogs");
        const baseRev = revenue ? Number(revenue.credit_amount || 0) * Number(revenue.fx_rate || 1) : 0;
        const expectedBase = Number(s.selling_price || 0) * Number(revenue?.fx_rate || 1);
        const fxGap = baseRev - expectedBase;

        let status: Status = "balanced";
        if (!sleTxns.length) status = "missing_ledger";
        else if (!invoice && s.invoice_id == null) status = "missing_invoice";
        else if (
          (ledgerCurrencies.length && !ledgerCurrencies.every((c) => c === s.currency)) ||
          (invoice && invoice.currency && invoice.currency !== s.currency)
        ) status = "currency_mismatch";
        else if (Math.abs(fxGap) > TOL) status = "fx_gap";

        return {
          ...s,
          ledgerCurrencies,
          revenueAmount: revenue ? Number(revenue.credit_amount || 0) : null,
          cogsAmount: cogs ? Number(cogs.debit_amount || 0) : null,
          invoiceCurrency: invoice?.currency ?? null,
          invoiceTotal: invoice ? Number(invoice.total_amount) : null,
          fxRate: revenue?.fx_rate ?? null,
          baseCurrency: revenue?.base_currency ?? null,
          fxGap,
          status,
        };
      });
    },
  });

  const filtered = useMemo(() => {
    return (data ?? []).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search && !r.sale_number?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, statusFilter, search]);

  const kpis = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      mismatched: rows.filter((r) => r.status === "currency_mismatch").length,
      fxGap: rows.filter((r) => r.status === "fx_gap").length,
      missing: rows.filter((r) => r.status === "missing_ledger" || r.status === "missing_invoice").length,
      gapTotal: rows.reduce((s, r) => s + (Number.isFinite(r.fxGap) ? Math.abs(r.fxGap) : 0), 0),
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Coins className="h-6 w-6" />Sales Currency Reconciliation</h1>
          <p className="text-muted-foreground">Match Container Sales against ledger entries and invoices by currency.</p>
        </div>
        <Button asChild variant="outline"><Link to="/finance/currency-backfill">Open Backfill</Link></Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Sales</p><p className="text-xl font-mono">{kpis.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Currency mismatch</p><p className="text-xl font-mono text-destructive">{kpis.mismatched}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">FX gap</p><p className="text-xl font-mono text-warning">{kpis.fxGap}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Missing posts</p><p className="text-xl font-mono">{kpis.missing}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Σ |FX gap|</p><p className="text-xl font-mono">{kpis.gapTotal.toFixed(2)}</p></CardContent></Card>
      </div>

      <div className="flex gap-2 items-center">
        <Input placeholder="Search sale #" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="balanced">Balanced</SelectItem>
            <SelectItem value="currency_mismatch">Currency mismatch</SelectItem>
            <SelectItem value="fx_gap">FX gap</SelectItem>
            <SelectItem value="missing_ledger">Missing ledger</SelectItem>
            <SelectItem value="missing_invoice">Missing invoice</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale</TableHead>
                <TableHead>Sale ccy / amount</TableHead>
                <TableHead>Ledger ccy</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">FX gap</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No matching sales</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.sale_number}</TableCell>
                  <TableCell className="font-mono text-xs">{r.currency ?? "—"} {Number(r.selling_price || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.ledgerCurrencies.length ? r.ledgerCurrencies.join(", ") : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.revenueAmount != null ? r.revenueAmount.toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.cogsAmount != null ? r.cogsAmount.toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-xs">{r.invoiceCurrency ? `${r.invoiceCurrency} ${(r.invoiceTotal ?? 0).toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Number.isFinite(r.fxGap) ? r.fxGap.toFixed(2) : "—"}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/finance/currency-backfill"><ExternalLink className="h-3.5 w-3.5" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
