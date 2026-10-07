import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { FolderKanban, FileDown, FileText } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";
import { exportCSV, exportPDF } from "@/lib/export-utils";

type Row = {
  project_id: string; code: string; name: string; status: string; customer_id: string | null; customer_name: string | null;
  revenue: number; materials: number; other_cogs: number; expenses: number; gross_profit: number; net_profit: number;
  budget: number | null; quoted: number | null; variance: number | null;
};

const n = (v: any) => Number(v || 0);

export default function ProjectPnL() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [drill, setDrill] = useState<Row | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["project-pnl-report", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("project_pnl_report", { _from: from || null, _to: to || null });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const customers = useMemo(() => {
    const m = new Map<string, string>();
    data.forEach((r) => r.customer_id && m.set(r.customer_id, r.customer_name ?? "—"));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const rows = useMemo(() => data.filter((r) =>
    (status === "all" || r.status === status) &&
    (customer === "all" || r.customer_id === customer) &&
    (n(r.revenue) || n(r.materials) || n(r.other_cogs) || n(r.expenses) || n(r.budget))
  ), [data, status, customer]);

  const tot = useMemo(() => rows.reduce((t, r) => ({
    revenue: t.revenue + n(r.revenue), materials: t.materials + n(r.materials), other: t.other + n(r.other_cogs),
    expenses: t.expenses + n(r.expenses), net: t.net + n(r.net_profit), budget: t.budget + n(r.budget ?? r.quoted),
    variance: t.variance + n(r.variance),
  }), { revenue: 0, materials: 0, other: 0, expenses: 0, net: 0, budget: 0, variance: 0 }), [rows]);

  const margin = (r: Row) => (n(r.revenue) > 0 ? (n(r.net_profit) / n(r.revenue)) * 100 : null);

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["project-pnl-lines", drill?.project_id, from, to],
    enabled: !!drill,
    queryFn: async () => {
      let q = supabase.from("accounting_transactions")
        .select("id, transaction_date, transaction_number, description, account_type, category, debit_amount, credit_amount, currency")
        .eq("project_id", drill!.project_id)
        .in("account_type", ["revenue", "cost_of_goods", "expense"])
        .order("transaction_date", { ascending: false }).limit(1000);
      if (from) q = q.gte("transaction_date", from);
      if (to) q = q.lte("transaction_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const headers = ["Code", "Project", "Customer", "Revenue", "Materials", "Other COGS", "Expenses", "Net profit", "Margin %", "Budget", "Variance"];
  const exportRows = () => rows.map((r) => [
    r.code ?? "", r.name, r.customer_name ?? "", String(n(r.revenue)), String(n(r.materials)), String(n(r.other_cogs)),
    String(n(r.expenses)), String(n(r.net_profit)), margin(r)?.toFixed(1) ?? "", String(r.budget ?? r.quoted ?? ""), String(r.variance ?? ""),
  ]);

  const typeLabel = (l: any) => l.account_type === "revenue" ? "Revenue"
    : l.category === "cogs_conversion_materials" ? "Materials"
    : l.account_type === "cost_of_goods" ? "Cost of sales" : "Expense";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FolderKanban className="h-6 w-6" />Project Profit &amp; Loss</h1>
          <p className="text-muted-foreground">Revenue, materials, expenses and budget variance per project. Click a project for the entries behind it.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => exportCSV("project_pnl.csv", headers, exportRows())}><FileDown className="h-4 w-4 mr-1" />CSV</Button>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => exportPDF("Project P&L", "project_pnl.pdf", headers, exportRows(), { landscape: true })}><FileText className="h-4 w-4 mr-1" />PDF</Button>
        </div>
      </div>

      <Card><CardContent className="flex flex-wrap gap-3 items-end pt-4">
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="w-40"><Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["all", "active", "on_hold", "completed", "archived"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="w-56"><Label className="text-xs">Customer</Label>
          <Select value={customer} onValueChange={setCustomer}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All customers</SelectItem>{customers.map(([id, nm]) => <SelectItem key={id} value={id}>{nm}</SelectItem>)}</SelectContent>
          </Select></div>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>All time</Button>}
      </CardContent></Card>

      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Project</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Materials</TableHead>
            <TableHead className="text-right">Other cost of sales</TableHead><TableHead className="text-right">Expenses</TableHead>
            <TableHead className="text-right">Net profit</TableHead><TableHead className="text-right">Margin</TableHead>
            <TableHead className="text-right">Budget</TableHead><TableHead className="text-right">Variance</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : !rows.length ? <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No project activity for this selection.</TableCell></TableRow>
            : rows.map((r) => {
              const m = margin(r);
              return (
                <TableRow key={r.project_id} className="cursor-pointer" onClick={() => setDrill(r)}>
                  <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.code}{r.customer_name ? ` · ${r.customer_name}` : ""}</div></TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.revenue)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.materials)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.other_cogs)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.expenses)}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${n(r.net_profit) >= 0 ? "text-success" : "text-destructive"}`}>{fmtMoney(r.net_profit)}</TableCell>
                  <TableCell className="text-right font-mono">{m == null ? "—" : `${m.toFixed(1)}%`}</TableCell>
                  <TableCell className="text-right font-mono">{r.budget != null ? fmtMoney(r.budget) : r.quoted ? <span title="Quoted price (no budget set)">{fmtMoney(r.quoted)}*</span> : "—"}</TableCell>
                  <TableCell className={`text-right font-mono ${r.variance == null ? "" : n(r.variance) >= 0 ? "text-success" : "text-destructive"}`}>{r.variance == null ? "—" : fmtMoney(r.variance)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {!!rows.length && <TableFooter><TableRow>
            <TableCell className="font-semibold">Total ({rows.length})</TableCell>
            <TableCell className="text-right font-mono">{fmtMoney(tot.revenue)}</TableCell>
            <TableCell className="text-right font-mono">{fmtMoney(tot.materials)}</TableCell>
            <TableCell className="text-right font-mono">{fmtMoney(tot.other)}</TableCell>
            <TableCell className="text-right font-mono">{fmtMoney(tot.expenses)}</TableCell>
            <TableCell className="text-right font-mono font-semibold">{fmtMoney(tot.net)}</TableCell>
            <TableCell className="text-right font-mono">{tot.revenue > 0 ? `${((tot.net / tot.revenue) * 100).toFixed(1)}%` : "—"}</TableCell>
            <TableCell className="text-right font-mono">{fmtMoney(tot.budget)}</TableCell>
            <TableCell className="text-right font-mono">{fmtMoney(tot.variance)}</TableCell>
          </TableRow></TableFooter>}
        </Table>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">* Quoted job price shown where no budget is set. Variance = budget (or quote) minus total costs; positive means under budget.</p>

      <Sheet open={!!drill} onOpenChange={(v) => !v && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader><SheetTitle>{drill?.code} — {drill?.name}</SheetTitle></SheetHeader>
          {drill && <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>Revenue: <span className="font-mono">{fmtMoney(drill.revenue)}</span></div>
            <div>Materials: <span className="font-mono">{fmtMoney(drill.materials)}</span></div>
            <div>Other cost of sales: <span className="font-mono">{fmtMoney(drill.other_cogs)}</span></div>
            <div>Expenses: <span className="font-mono">{fmtMoney(drill.expenses)}</span></div>
            <div className="col-span-2"><Link className="text-primary underline" to={`/finance/projects/${drill.project_id}`}>Open full project page</Link></div>
          </div>}
          <Table className="mt-4">
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {linesLoading ? <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              : !lines.length ? <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No entries.</TableCell></TableRow>
              : lines.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{format(new Date(l.transaction_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-xs">{typeLabel(l)}</TableCell>
                  <TableCell className="text-xs max-w-[280px] truncate" title={l.description}>{l.description}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtMoney(l.account_type === "revenue" ? n(l.credit_amount) - n(l.debit_amount) : n(l.debit_amount) - n(l.credit_amount), l.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SheetContent>
      </Sheet>
    </div>
  );
}
