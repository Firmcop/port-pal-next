import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Receipt, FileDown, FileText, Undo2, Banknote, Eye, Tags, BarChart3, Target } from "lucide-react";
import { format } from "date-fns";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { Money, MoneyTotals } from "@/components/Money";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useToast } from "@/hooks/use-toast";
import { ExpenseDialog } from "@/components/finance/ExpenseDialog";
import { ExpensePaymentDialog } from "@/components/finance/ExpensePaymentDialog";
import { ExpenseDetailSheet, approvalBadge } from "@/components/finance/ExpenseDetailSheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecurringExpensesTab } from "@/components/finance/RecurringExpensesTab";
import { PayablesSettlementTab } from "@/components/finance/PayablesSettlementTab";
import { useOpexAccess } from "@/hooks/use-opex-access";
import { useRowSelection } from "@/hooks/use-row-selection";
import { BulkActionBar } from "@/components/bulk/BulkActionBar";
import { HeaderCheckbox, RowCheckbox } from "@/components/bulk/SelectionCheckbox";
import { AssignExpensesToJobDialog } from "@/components/finance/AssignExpensesToJobDialog";

const statusColor: Record<string, string> = {
  paid: "bg-success/15 text-success",
  unpaid: "bg-warning/15 text-warning",
  partly_paid: "bg-info/15 text-info",
  reversed: "bg-destructive/15 text-destructive",
};

export default function OperatingExpenses() {
  useRealtimeInvalidate(
    [{ table: "operating_expenses", queryKeys: ["operating-expenses"] }],
    "opex-rt"
  );
  const qc = useQueryClient();
  const { toast } = useToast();
  const access = useOpexAccess();
  const clerk = access.clerk;
  const [open, setOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [approval, setApproval] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [tagging, setTagging] = useState("all");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["operating-expenses"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operating_expenses")
        .select("*, suppliers(name), depots(name), projects(code), operating_expense_lines(amount, conversion_id, project_id, gl_accounts(code,name))")
        .order("expense_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (from && r.expense_date < from) return false;
      if (to && r.expense_date > to) return false;
      if (status !== "all" && r.status !== status) return false;
      if (approval !== "all" && r.approval_status !== approval) return false;
      if (tagging !== "all") {
        const lines = (r.operating_expense_lines ?? []) as any[];
        const hasJob = !!r.conversion_id || lines.some((l) => !!l.conversion_id);
        const hasProject = !!r.project_id || lines.some((l) => !!l.project_id);
        if (tagging === "job" && !hasJob) return false;
        if (tagging === "project_only" && (hasJob || !hasProject)) return false;
        if (tagging === "untagged" && (hasJob || hasProject)) return false;
      }
      if (q) {
        const hay = [r.expense_number, r.payee, r.reference, r.suppliers?.name, r.notes]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, from, to, status, approval, search, tagging]);

  const sel = useRowSelection(filtered);
  const canBulkAssign = !clerk;

  const kpis = useMemo(() => {
    const live = filtered.filter((r) => r.status !== "reversed" && r.approval_status === "approved");
    const totals = live.map((r) => ({ amount: r.total_amount, currency: r.currency }));
    const unpaid = live
      .map((r) => ({ amount: Number(r.total_amount) - Number(r.amount_paid), currency: r.currency }))
      .filter((r) => Number(r.amount) > 0.005);
    const byCat = new Map<string, number>();
    live.forEach((r) =>
      (r.operating_expense_lines ?? []).forEach((l: any) => {
        const key = l.gl_accounts ? `${l.gl_accounts.code} — ${l.gl_accounts.name}` : "Uncategorised";
        byCat.set(key, (byCat.get(key) ?? 0) + Number(l.amount || 0));
      })
    );
    const top = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1])[0];
    return { totals, unpaid, topCategory: top?.[0] ?? "—", count: live.length };
  }, [filtered]);

  const categoryOf = (r: any) =>
    (r.operating_expense_lines ?? []).map((l: any) => l.gl_accounts?.name).filter(Boolean).join(", ") || "—";

  const headers = ["Expense #", "Date", "Category", "Payee", "Depot", "Project", "Mode", "Approval", "Status", "Total", "Outstanding", "Currency"];
  const toRows = () =>
    filtered.map((r) => [
      r.expense_number,
      r.expense_date,
      categoryOf(r),
      r.suppliers?.name ?? r.payee ?? "",
      r.depots?.name ?? "",
      r.projects?.code ?? "",
      r.payment_mode,
      r.approval_status ?? "draft",
      r.status,
      String(r.total_amount),
      String(Number(r.total_amount) - Number(r.amount_paid)),
      r.currency ?? "",
    ]);

  const reverse = useMutation({
    mutationFn: async (r: any) => {
      const reason = window.prompt(`Reason for reversing ${r.expense_number}?`);
      if (!reason) throw new Error("cancelled");
      const { error } = await (supabase as any).rpc("reverse_operating_expense", { _expense_id: r.id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      ["operating-expenses", "accounting-transactions", "account-balances"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      toast({ title: "Expense reversed" });
    },
    onError: (e: any) => {
      if (e.message === "cancelled") return;
      toast({ title: "Could not reverse", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6" />Operating Expenses</h1>
          <p className="text-muted-foreground">Post running costs straight to the ledger — P&amp;L, cash and project reports update instantly.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!filtered.length} onClick={() => exportCSV("operating_expenses.csv", headers, toRows())}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" disabled={!filtered.length} onClick={() => exportPDF("Operating Expenses", "operating_expenses.pdf", headers, toRows(), { landscape: true })}>
            <FileText className="h-4 w-4 mr-1" />PDF
          </Button>
          {!clerk && (
            <>
              <Button variant="outline" size="sm" asChild><a href="/finance/expense-categories"><Tags className="h-4 w-4 mr-1" />Categories</a></Button>
              <Button variant="outline" size="sm" asChild><a href="/finance/budgets-vs-actual"><Target className="h-4 w-4 mr-1" />Budgets</a></Button>
              <Button variant="outline" size="sm" asChild><a href="/finance/opex-report"><BarChart3 className="h-4 w-4 mr-1" />Report</a></Button>
            </>
          )}
          {access.canRecord && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New expense</Button>}
        </div>
      </div>

      {!clerk && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total OPEX</p>
          <p className="text-lg font-bold font-mono"><MoneyTotals rows={kpis.totals} /></p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Outstanding payables</p>
          <p className="text-lg font-bold font-mono"><MoneyTotals rows={kpis.unpaid} /></p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Top category</p>
          <p className="text-sm font-semibold truncate">{kpis.topCategory}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Expenses</p>
          <p className="text-lg font-bold">{kpis.count}</p>
        </CardContent></Card>
      </div>
      )}

      <Tabs defaultValue="expenses" className="space-y-4">
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          {!clerk && <TabsTrigger value="recurring">Recurring</TabsTrigger>}
          {!clerk && <TabsTrigger value="payables">Payables &amp; settlement</TabsTrigger>}
        </TabsList>

        <TabsContent value="expenses" className="space-y-6">
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="partly_paid">Partly paid</SelectItem>
                    <SelectItem value="reversed">Reversed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Approval</Label>
                <Select value={approval} onValueChange={setApproval}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Awaiting approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Job tagging</Label>
                <Select value={tagging} onValueChange={setTagging}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="job">Tagged to a job</SelectItem>
                    <SelectItem value="project_only">Project only</SelectItem>
                    <SelectItem value="untagged">Untagged — needs review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Search</Label><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, payee, reference…" /></div>
            </CardContent>
          </Card>

          {canBulkAssign && (
            <BulkActionBar count={sel.count} onClear={sel.clear}>
              <Button size="sm" onClick={() => setAssignOpen(true)}>
                <Tags className="h-4 w-4 mr-1" />Assign to job
              </Button>
            </BulkActionBar>
          )}

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {canBulkAssign && (
                      <TableHead className="w-8">
                        <HeaderCheckbox allSelected={sel.allSelected} someSelected={sel.someSelected} onToggle={sel.toggleAll} />
                      </TableHead>
                    )}
                    <TableHead>Expense #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Depot</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={canBulkAssign ? 12 : 11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : !filtered.length ? (
                    <TableRow><TableCell colSpan={canBulkAssign ? 12 : 11} className="text-center py-8 text-muted-foreground">No operating expenses recorded yet.</TableCell></TableRow>
                  ) : filtered.map((r) => {
                    const outstanding = Number(r.total_amount) - Number(r.amount_paid);
                    return (
                      <TableRow key={r.id}>
                        {canBulkAssign && (
                          <TableCell className="w-8">
                            <RowCheckbox checked={sel.isSelected(r.id)} onToggle={() => sel.toggle(r.id)} />
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-xs">{r.expense_number}</TableCell>
                        <TableCell className="text-xs">{format(new Date(r.expense_date), "dd MMM yyyy")}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{categoryOf(r)}</TableCell>
                        <TableCell className="text-sm">{r.suppliers?.name ?? r.payee ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.depots?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.projects?.code ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={approvalBadge(r.approval_status)}>
                            {(r.approval_status ?? "draft") === "submitted" ? "awaiting approval" : (r.approval_status ?? "draft")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColor[r.status] ?? ""}>{r.status.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono"><Money amount={r.total_amount} currency={r.currency} /></TableCell>
                        <TableCell className="text-right font-mono">
                          {outstanding > 0.005 && r.status !== "reversed" ? <Money amount={outstanding} currency={r.currency} /> : "—"}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
                            <Eye className="h-4 w-4 mr-1" />Open
                          </Button>
                          {!clerk && r.approval_status === "approved" && r.status !== "reversed" && outstanding > 0.005 && (
                            <Button variant="ghost" size="sm" onClick={() => setPayTarget(r)}>
                              <Banknote className="h-4 w-4 mr-1" />Pay
                            </Button>
                          )}
                          {!clerk && r.approval_status === "approved" && r.status !== "reversed" && (
                            <Button variant="ghost" size="sm" onClick={() => reverse.mutate(r)}>
                              <Undo2 className="h-4 w-4 mr-1" />Reverse
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {!clerk && <TabsContent value="recurring"><RecurringExpensesTab /></TabsContent>}
        {!clerk && <TabsContent value="payables"><PayablesSettlementTab /></TabsContent>}
      </Tabs>

      <ExpenseDialog open={open} onOpenChange={setOpen} requireProject={clerk} submitOnly={clerk} />
      <ExpensePaymentDialog expense={payTarget} onOpenChange={(v) => !v && setPayTarget(null)} />
      <ExpenseDetailSheet expense={detail} onOpenChange={(v) => !v && setDetail(null)} />
      <AssignExpensesToJobDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        expenseIds={sel.selectedIds}
        onDone={sel.clear}
      />
    </div>
  );
}
