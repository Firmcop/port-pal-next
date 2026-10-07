import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatMoneyCode } from "@/lib/money";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { Scale, FileDown, FileText, RefreshCw, ArrowLeftRight, AlertTriangle } from "lucide-react";

type Row = {
  supplier_id: string; supplier_name: string;
  customer_id: string | null; customer_name: string | null;
  linked: boolean; currency: string;
  ar_total: number; ap_total: number; offsettable: number;
  offsets_posted: number; cash_settled: number; unallocated_onaccount: number;
  net_position: number;
  flags: { code: string; severity: string; message: string }[];
};

const sevRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };

export default function CounterpartyReconciliation() {
  const [search, setSearch] = useState("");
  const [onlyExceptions, setOnlyExceptions] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["counterparty-reconciliation"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("counterparty_reconciliation");
      if (error) throw error;
      return data as any;
    },
  });

  const rows: Row[] = useMemo(() => data?.rows ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.supplier_name} ${r.customer_name ?? ""} ${r.currency}`.toLowerCase().includes(q)) return false;
      if (onlyExceptions && !(r.flags ?? []).some((f) => f.severity !== "info")) return false;
      return true;
    });
  }, [rows, search, onlyExceptions]);

  const byCurrency = useMemo(() => {
    const m: Record<string, { ar: number; ap: number; off: number; net: number }> = {};
    filtered.forEach((r) => {
      const b = (m[r.currency] ??= { ar: 0, ap: 0, off: 0, net: 0 });
      b.ar += Number(r.ar_total || 0);
      b.ap += Number(r.ap_total || 0);
      b.off += Number(r.offsettable || 0);
      b.net += Number(r.net_position || 0);
    });
    return Object.entries(m);
  }, [filtered]);

  const exceptions = rows.filter((r) => (r.flags ?? []).some((f) => f.severity !== "info")).length;
  const basis = data?.policy?.presentation_basis ?? "gross";
  const nettingEnabled = data?.policy?.netting_enabled !== false;

  const headers = ["Counterparty", "Currency", "AR", "AP", "Offsettable", "Offsets posted", "Cash settled", "Unallocated on account", "Net position", "Flags"];
  const csvRows = () => filtered.map((r) => [
    r.supplier_name, r.currency, String(r.ar_total), String(r.ap_total), String(r.offsettable),
    String(r.offsets_posted), String(r.cash_settled), String(r.unallocated_onaccount), String(r.net_position),
    (r.flags ?? []).map((f) => f.code).join(" | "),
  ]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="h-5 w-5" />Counterparty reconciliation
          </h1>
          <p className="text-muted-foreground text-sm">
            AP netted against AR per counterparty and currency, with residuals and mismatches flagged for investigation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" variant="outline" disabled={!filtered.length}
            onClick={() => exportCSV("counterparty-reconciliation.csv", headers, csvRows())}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button size="sm" variant="outline" disabled={!filtered.length}
            onClick={() => exportPDF("Counterparty reconciliation", "counterparty-reconciliation.pdf", headers, csvRows())}>
            <FileText className="h-4 w-4 mr-1" />PDF
          </Button>
        </div>
      </div>

      <Alert>
        <Scale className="h-4 w-4" />
        <AlertTitle>Presentation basis: {basis === "net" ? "Net" : "Gross"} {nettingEnabled ? "" : "· netting disabled"}</AlertTitle>
        <AlertDescription className="text-sm">
          Balances stay gross in the ledger. This report shows what could be offset under IAS 32 and what remains to be
          settled in cash. Change the rules in <Link className="underline" to="/finance/accounting-policies">accounting policies</Link>.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Counterparty positions</div>
          <div className="text-2xl font-semibold">{rows.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">With exceptions</div>
          <div className={`text-2xl font-semibold ${exceptions ? "text-destructive" : ""}`}>{exceptions}</div>
        </CardContent></Card>
        {byCurrency.slice(0, 2).map(([cur, b]) => (
          <Card key={cur}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{cur} offsettable</div>
            <div className="text-2xl font-semibold">{formatMoneyCode(b.off, cur)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              AR {formatMoneyCode(b.ar, cur)} · AP {formatMoneyCode(b.ap, cur)}
            </div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-2">
          <CardTitle>Positions</CardTitle>
          <CardDescription>Only counterparties that exist as both supplier and customer are listed.</CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Input className="max-w-xs" placeholder="Search counterparty or currency…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button size="sm" variant={onlyExceptions ? "default" : "outline"} onClick={() => setOnlyExceptions((v) => !v)}>
              <AlertTriangle className="h-4 w-4 mr-1" />Exceptions only
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">AR</TableHead>
                  <TableHead className="text-right">AP</TableHead>
                  <TableHead className="text-right">Offsettable</TableHead>
                  <TableHead className="text-right">Offsets posted</TableHead>
                  <TableHead className="text-right">Net position</TableHead>
                  <TableHead>Exceptions</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    {isFetching ? "Loading…" : "No supplier-customer counterparties found."}
                  </TableCell></TableRow>
                )}
                {filtered.map((r) => {
                  const flags = [...(r.flags ?? [])].sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0));
                  return (
                    <TableRow key={`${r.supplier_id}-${r.currency}`}>
                      <TableCell>
                        <div className="font-medium">{r.supplier_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.customer_name}{r.linked ? "" : " · matched by name"}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{r.currency}</Badge></TableCell>
                      <TableCell className="text-right">{formatMoneyCode(Number(r.ar_total), r.currency)}</TableCell>
                      <TableCell className="text-right">{formatMoneyCode(Number(r.ap_total), r.currency)}</TableCell>
                      <TableCell className="text-right font-medium">{formatMoneyCode(Number(r.offsettable), r.currency)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatMoneyCode(Number(r.offsets_posted), r.currency)}
                        {Number(r.cash_settled) > 0 && (
                          <div className="text-xs">cash {formatMoneyCode(Number(r.cash_settled), r.currency)}</div>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${Number(r.net_position) < 0 ? "text-destructive" : ""}`}>
                        {formatMoneyCode(Number(r.net_position), r.currency)}
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        {flags.length === 0 ? <span className="text-xs text-muted-foreground">Clean</span> : (
                          <div className="space-y-1">
                            {flags.map((f) => (
                              <div key={f.code} className="flex items-start gap-1">
                                <Badge variant={f.severity === "critical" ? "destructive" : f.severity === "warning" ? "secondary" : "outline"} className="shrink-0">
                                  {f.severity}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{f.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(r.offsettable) > 0.01 && (
                          <Button asChild size="sm" variant="ghost">
                            <Link to="/finance/contra-settlements"><ArrowLeftRight className="h-4 w-4 mr-1" />Offset</Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
