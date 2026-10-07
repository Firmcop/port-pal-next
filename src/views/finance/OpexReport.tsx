import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BarChart3, FileDown, FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { fmtMoney } from "@/lib/finance-format";

const ALL = "all";

export default function OpexReport() {
  const today = new Date();
  const [from, setFrom] = useState(format(new Date(today.getFullYear(), 0, 1), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));
  const [depot, setDepot] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [supplier, setSupplier] = useState(ALL);
  const [drill, setDrill] = useState<{ title: string; expenseIds: string[] } | null>(null);

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["opex-report", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operating_expenses")
        .select("*, suppliers(name), depots(name), projects(code), operating_expense_lines(id, amount, tax_amount, gl_account_id, gl_accounts(code,name), expense_categories(id,name), depot_id, project_id)")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: ledger } = useQuery({
    queryKey: ["opex-report-ledger", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("accounting_transactions")
        .select("debit_amount, credit_amount, gl_account_id, reference_type")
        .eq("reference_type", "operating_expense")
        .gte("transaction_date", from)
        .lte("transaction_date", to);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: plRows } = useQuery({
    queryKey: ["account-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_account_balances" as any).select("*").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = useMemo(() => (expenses ?? []).filter((e) => {
    if (e.status === "reversed") return false;
    if (depot !== ALL && e.depot_id !== depot) return false;
    if (project !== ALL && e.project_id !== project) return false;
    if (supplier !== ALL && e.supplier_id !== supplier) return false;
    return true;
  }), [expenses, depot, project, supplier]);

  const approved = useMemo(() => filtered.filter((e) => e.approval_status === "approved"), [filtered]);
  const pending = useMemo(() => filtered.filter((e) => e.approval_status !== "approved"), [filtered]);

  const currency = approved[0]?.currency ?? undefined;

  type Group = { key: string; label: string; total: number; expenseIds: string[] };
  const groupBy = (fn: (line: any, exp: any) => { key: string; label: string } | null): Group[] => {
    const m = new Map<string, Group>();
    approved.forEach((e) =>
      (e.operating_expense_lines ?? []).forEach((l: any) => {
        const g = fn(l, e);
        if (!g) return;
        const cur = m.get(g.key) ?? { key: g.key, label: g.label, total: 0, expenseIds: [] };
        cur.total += Number(l.amount || 0);
        if (!cur.expenseIds.includes(e.id)) cur.expenseIds.push(e.id);
        m.set(g.key, cur);
      })
    );
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  };

  const byCategory = useMemo(() => groupBy((l) =>
    l.expense_categories
      ? { key: l.expense_categories.id, label: l.expense_categories.name }
      : { key: "uncat", label: "Uncategorised" }), [approved]);

  const byAccount = useMemo(() => groupBy((l) =>
    l.gl_accounts ? { key: l.gl_account_id, label: `${l.gl_accounts.code} — ${l.gl_accounts.name}` } : null), [approved]);

  const byDepot = useMemo(() => groupBy((l, e) =>
    ({ key: e.depot_id ?? "none", label: e.depots?.name ?? "Unassigned" })), [approved]);

  const byProject = useMemo(() => groupBy((l, e) =>
    ({ key: e.project_id ?? "none", label: e.projects?.code ?? "Unassigned" })), [approved]);

  const byMonth = useMemo(() => {
    const m = new Map<string, Group>();
    approved.forEach((e) => {
      const key = e.expense_date.slice(0, 7);
      const cur = m.get(key) ?? { key, label: format(new Date(e.expense_date), "MMM yyyy"), total: 0, expenseIds: [] };
      cur.total += Number(e.subtotal || 0);
      cur.expenseIds.push(e.id);
      m.set(key, cur);
    });
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [approved]);

  const totals = useMemo(() => {
    const opexNet = approved.reduce((s, e) => s + Number(e.subtotal || 0), 0);
    const draft = pending.reduce((s, e) => s + Number(e.subtotal || 0), 0);
    const ledgerExpense = (ledger ?? []).reduce((s, t) => s + Number(t.debit_amount || 0), 0);
    const ledgerTax = approved.reduce((s, e) => s + Number(e.tax_amount || 0), 0);
    const ledgerNet = ledgerExpense - ledgerTax; // debits include input VAT line
    return { opexNet, draft, ledgerNet, diff: opexNet - ledgerNet };
  }, [approved, pending, ledger]);

  const plExpenseTotal = useMemo(
    () => (plRows ?? []).filter((r) => r.account_type === "expense").reduce((s, r) => s + Number(r.balance || 0), 0),
    [plRows]
  );

  const headers = ["Group", "Total", "% of spend"];
  const rowsFor = (g: Group[]) => {
    const sum = g.reduce((s, x) => s + x.total, 0) || 1;
    return g.map((x) => [x.label, x.total.toFixed(2), `${((x.total / sum) * 100).toFixed(1)}%`]);
  };

  const GroupTable = ({ groups }: { groups: Group[] }) => {
    const sum = groups.reduce((s, x) => s + x.total, 0) || 1;
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">% of spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!groups.length && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No approved expenses in this period.</TableCell></TableRow>}
          {groups.map((g) => (
            <TableRow key={g.key} className="cursor-pointer hover:bg-muted/50" onClick={() => setDrill({ title: g.label, expenseIds: g.expenseIds })}>
              <TableCell>{g.label}</TableCell>
              <TableCell className="text-right font-mono">{fmtMoney(g.total, currency)}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{((g.total / sum) * 100).toFixed(1)}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const drillExpenses = useMemo(
    () => (drill ? approved.filter((e) => drill.expenseIds.includes(e.id)) : []),
    [drill, approved]
  );

  const depots = useMemo(() => {
    const m = new Map<string, string>();
    (expenses ?? []).forEach((e) => e.depot_id && m.set(e.depot_id, e.depots?.name ?? e.depot_id));
    return Array.from(m.entries());
  }, [expenses]);
  const projectsList = useMemo(() => {
    const m = new Map<string, string>();
    (expenses ?? []).forEach((e) => e.project_id && m.set(e.project_id, e.projects?.code ?? e.project_id));
    return Array.from(m.entries());
  }, [expenses]);
  const suppliersList = useMemo(() => {
    const m = new Map<string, string>();
    (expenses ?? []).forEach((e) => e.supplier_id && m.set(e.supplier_id, e.suppliers?.name ?? e.supplier_id));
    return Array.from(m.entries());
  }, [expenses]);

  const tied = Math.abs(totals.diff) < 0.01;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" />Operating Expense Report</h1>
          <p className="text-muted-foreground">Analyse OPEX by category, account, depot and project — reconciled to the ledger.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV("opex_by_category.csv", headers, rowsFor(byCategory))}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportPDF("Operating Expenses by Category", "opex_by_category.pdf", headers, rowsFor(byCategory))}>
            <FileText className="h-4 w-4 mr-1" />PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <Label className="text-xs">Depot</Label>
            <Select value={depot} onValueChange={setDepot}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All depots</SelectItem>
                {depots.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Project</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {projectsList.map(([id, code]) => <SelectItem key={id} value={id}>{code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Supplier</Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All suppliers</SelectItem>
                {suppliersList.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            {tied ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
            Ledger reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Approved OPEX (net of tax)</p><p className="font-mono font-semibold">{fmtMoney(totals.opexNet, currency)}</p></div>
          <div><p className="text-xs text-muted-foreground">Expense postings in ledger</p><p className="font-mono font-semibold">{fmtMoney(totals.ledgerNet, currency)}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">Difference</p>
            <p className={`font-mono font-semibold ${tied ? "text-success" : "text-warning"}`}>{fmtMoney(totals.diff, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Not yet approved (off-ledger)</p>
            <p className="font-mono font-semibold">{fmtMoney(totals.draft, currency)}</p>
            {!!pending.length && <Badge variant="outline" className="mt-1">{pending.length} pending</Badge>}
          </div>
          <div className="sm:col-span-4 text-xs text-muted-foreground">
            All-time P&amp;L expense total: <span className="font-mono">{fmtMoney(plExpenseTotal, currency)}</span> — includes expenses from sources other than the OPEX register (payroll, COGS journals, supplier invoices).
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <Tabs defaultValue="category">
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="category">By category</TabsTrigger>
              <TabsTrigger value="account">By GL account</TabsTrigger>
              <TabsTrigger value="depot">By depot</TabsTrigger>
              <TabsTrigger value="project">By project</TabsTrigger>
              <TabsTrigger value="month">Monthly trend</TabsTrigger>
            </TabsList>
            <TabsContent value="category">{isLoading ? <p className="py-6 text-center text-muted-foreground">Loading…</p> : <GroupTable groups={byCategory} />}</TabsContent>
            <TabsContent value="account"><GroupTable groups={byAccount} /></TabsContent>
            <TabsContent value="depot"><GroupTable groups={byDepot} /></TabsContent>
            <TabsContent value="project"><GroupTable groups={byProject} /></TabsContent>
            <TabsContent value="month"><GroupTable groups={byMonth} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={!!drill} onOpenChange={(v) => !v && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>{drill?.title}</SheetTitle></SheetHeader>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Expense #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drillExpenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.expense_number}</TableCell>
                  <TableCell className="text-xs">{format(new Date(e.expense_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-sm">{e.suppliers?.name ?? e.payee ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(e.total_amount, e.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <a href="/finance/operating-expenses">Open expense register</a>
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
