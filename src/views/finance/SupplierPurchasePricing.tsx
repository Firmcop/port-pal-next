import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, Download, Tags } from "lucide-react";
import { exportCSV } from "@/lib/export-utils";

type Row = {
  supplier_id: string | null;
  supplier_name: string | null;
  container_id: string;
  container_number: string;
  size: string;
  category: string | null;
  invoice_id: string;
  invoice_number: string;
  supplier_ref: string | null;
  issue_date: string;
  currency: string;
  amount: number;
  reference_rate: number | null;
  reference_rate_converted: number | null;
  variance: number | null;
};

const num = (n: any) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SupplierPurchasePricing() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [supplier, setSupplier] = useState("all");
  const [size, setSize] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["supplier-purchase-pricing", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("supplier_purchase_price_variance", {
        _from: from || null,
        _to: to || null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        amount: Number(r.amount || 0),
        reference_rate: r.reference_rate == null ? null : Number(r.reference_rate),
        reference_rate_converted: r.reference_rate_converted == null ? null : Number(r.reference_rate_converted),
        variance: r.variance == null ? null : Number(r.variance),
      })) as Row[];
    },
  });

  const suppliers = useMemo(() => Array.from(new Set(rows.map((r) => r.supplier_name).filter(Boolean))) as string[], [rows]);
  const sizes = useMemo(() => Array.from(new Set(rows.map((r) => r.size).filter(Boolean))).sort(), [rows]);
  const currencies = useMemo(() => Array.from(new Set(rows.map((r) => r.currency).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(
    () => rows.filter((r) =>
      (supplier === "all" || r.supplier_name === supplier) &&
      (size === "all" || r.size === size) &&
      (currency === "all" || r.currency === currency)),
    [rows, supplier, size, currency],
  );

  const groups = useMemo(() => {
    const map = new Map<string, { supplier: string; size: string; currency: string; rows: Row[] }>();
    for (const r of filtered) {
      const key = `${r.supplier_name ?? "—"}|${r.size}|${r.currency}`;
      if (!map.has(key)) map.set(key, { supplier: r.supplier_name ?? "—", size: r.size, currency: r.currency, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return Array.from(map.entries())
      .map(([key, g]) => {
        const amounts = g.rows.map((r) => r.amount);
        const ref = g.rows[0]?.reference_rate_converted ?? g.rows[0]?.reference_rate ?? null;
        return {
          key, ...g,
          count: g.rows.length,
          avg: amounts.reduce((s, a) => s + a, 0) / (amounts.length || 1),
          min: Math.min(...amounts),
          max: Math.max(...amounts),
          reference: ref,
          variance: g.rows.reduce((s, r) => s + Number(r.variance || 0), 0),
        };
      })
      .sort((a, b) => a.supplier.localeCompare(b.supplier) || a.size.localeCompare(b.size));
  }, [filtered]);

  const exportCsv = () => {
    exportCSV(
      `supplier-purchase-pricing-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Supplier", "Container", "Size", "Invoice", "Supplier ref", "Date", "Currency", "Amount", "Standard rate", "Variance"],
      filtered.map((r) => [
        r.supplier_name ?? "", r.container_number, r.size, r.invoice_number, r.supplier_ref ?? "",
        r.issue_date ?? "", r.currency, r.amount.toFixed(2),
        r.reference_rate_converted == null ? "" : r.reference_rate_converted.toFixed(2),
        r.variance == null ? "" : r.variance.toFixed(2),
      ]),
    );
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Tags className="h-5 w-5" />Supplier purchase pricing</h1>
          <p className="text-sm text-muted-foreground">What each supplier charged per container, and how far it sits from the standard 20ft / 40ft rate.</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="mr-1 h-3 w-3" />Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="space-y-1">
            <Label className="text-xs">Supplier</Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All suppliers</SelectItem>{suppliers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Size</Label>
            <Select value={size} onValueChange={setSize}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All sizes</SelectItem>{sizes.map((s) => <SelectItem key={s} value={s}>{s}ft</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All currencies</SelectItem>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">By supplier and size</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead>Supplier</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Containers</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">Min</TableHead>
                <TableHead className="text-right">Max</TableHead>
                <TableHead className="text-right">Standard rate</TableHead>
                <TableHead className="text-right">Total variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !groups.length ? (
                <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">No purchase invoices in this range</TableCell></TableRow>
              ) : groups.map((g) => (
                <>
                  <TableRow key={g.key} className="cursor-pointer" onClick={() => setOpen((p) => ({ ...p, [g.key]: !p[g.key] }))}>
                    <TableCell className="w-8">{open[g.key] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                    <TableCell className="text-sm font-medium">{g.supplier}</TableCell>
                    <TableCell className="text-sm">{g.size}ft <Badge variant="outline" className="ml-1 text-[10px]">{g.currency}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-sm">{g.count}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{num(g.avg)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{num(g.min)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{num(g.max)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{g.reference == null ? "—" : num(g.reference)}</TableCell>
                    <TableCell className={`text-right font-mono text-sm font-medium ${g.variance < 0 ? "text-success" : g.variance > 0 ? "text-destructive" : ""}`}>{num(g.variance)}</TableCell>
                  </TableRow>
                  {open[g.key] && g.rows.map((r) => (
                    <TableRow key={r.invoice_id + r.container_id} className="bg-muted/30">
                      <TableCell />
                      <TableCell className="font-mono text-xs">{r.container_number}</TableCell>
                      <TableCell className="text-xs">{r.issue_date ? new Date(r.issue_date).toLocaleDateString() : "—"}</TableCell>
                      <TableCell colSpan={2} className="text-xs">
                        {r.invoice_number}{r.supplier_ref ? ` · ${r.supplier_ref}` : ""}
                      </TableCell>
                      <TableCell colSpan={2} className="text-right font-mono text-xs">{r.currency} {num(r.amount)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.reference_rate_converted == null ? "—" : num(r.reference_rate_converted)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${Number(r.variance || 0) < 0 ? "text-success" : Number(r.variance || 0) > 0 ? "text-destructive" : ""}`}>
                        {r.variance == null ? "—" : num(r.variance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
