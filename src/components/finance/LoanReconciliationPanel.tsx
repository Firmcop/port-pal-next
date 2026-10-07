import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatMoneyCode } from "@/lib/money";
import { exportCSV } from "@/lib/export-utils";
import { format, parseISO } from "date-fns";
import { FileDown, RefreshCw, Scale } from "lucide-react";

type Row = {
  txn_id: string;
  txn_date: string;
  txn_type: string;
  description: string | null;
  source: string;
  amount: number;
  posts_to_ledger: boolean;
  posted_amount: number;
  posting_count: number;
  difference: number;
  match_status: "matched" | "missing_in_ledger" | "amount_mismatch" | "unbalanced" | "not_applicable";
};

const statusTone: Record<string, string> = {
  matched: "bg-success/15 text-success",
  missing_in_ledger: "bg-destructive/15 text-destructive",
  amount_mismatch: "bg-destructive/15 text-destructive",
  unbalanced: "bg-warning/15 text-warning",
  not_applicable: "bg-muted text-muted-foreground",
};

const statusLabel: Record<string, string> = {
  matched: "Matched",
  missing_in_ledger: "Missing in ledger",
  amount_mismatch: "Amount mismatch",
  unbalanced: "Unbalanced journal",
  not_applicable: "Pre-cutover (not posted)",
};

export default function LoanReconciliationPanel({
  loanId,
  currency,
  stmtBalance,
  systemBalance,
}: {
  loanId: string;
  currency?: string;
  stmtBalance?: number | null;
  systemBalance?: number | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("exceptions");

  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ["loan-reconciliation", loanId],
    enabled: !!loanId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("loan_statement_reconciliation", { _loan_id: loanId });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: orphans } = useQuery<any[]>({
    queryKey: ["loan-orphan-postings", loanId],
    enabled: !!loanId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("loan_orphan_postings", { _loan_id: loanId });
      if (error) throw error;
      return data ?? [];
    },
  });

  const repost = useMutation({
    mutationFn: async (txnId: string) => {
      const { error } = await (supabase as any).rpc("repost_loan_transaction", { _txn_id: txnId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Posted to the ledger" });
      qc.invalidateQueries({ queryKey: ["loan-reconciliation", loanId] });
      qc.invalidateQueries({ queryKey: ["loan-postings", loanId] });
      qc.invalidateQueries({ queryKey: ["loan-balance-row", loanId] });
    },
    onError: (e: any) => toast({ title: "Could not post", description: e.message, variant: "destructive" }),
  });

  const rows = data ?? [];
  const stats = useMemo(() => {
    const matched = rows.filter((r) => r.match_status === "matched").length;
    const exceptions = rows.filter((r) => ["missing_in_ledger", "amount_mismatch", "unbalanced"].includes(r.match_status));
    return {
      matched,
      exceptions: exceptions.length,
      exceptionValue: exceptions.reduce((s, r) => s + Math.abs(r.match_status === "missing_in_ledger" ? Number(r.amount) : Number(r.difference)), 0),
      skipped: rows.filter((r) => r.match_status === "not_applicable").length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "exceptions") return rows.filter((r) => ["missing_in_ledger", "amount_mismatch", "unbalanced"].includes(r.match_status));
    return rows.filter((r) => r.match_status === filter);
  }, [rows, filter]);

  const variance =
    stmtBalance != null && systemBalance != null ? Number(systemBalance) - Number(stmtBalance) : null;

  const exportRows = () =>
    rows.map((r) => [
      r.txn_date, r.txn_type, r.description ?? "", r.source,
      String(r.amount), String(r.posted_amount), String(r.difference), statusLabel[r.match_status],
    ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Matched movements</p>
          <p className="text-xl font-bold text-success">{stats.matched}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Exceptions</p>
          <p className={`text-xl font-bold ${stats.exceptions ? "text-destructive" : ""}`}>{stats.exceptions}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Value of differences</p>
          <p className="text-xl font-bold font-mono">{formatMoneyCode(stats.exceptionValue, currency)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Statement vs system balance</p>
          <p className={`text-xl font-bold font-mono ${variance != null && Math.abs(variance) > 0.01 ? "text-destructive" : ""}`}>
            {variance != null ? formatMoneyCode(variance, currency) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {stmtBalance != null ? `Bank ${formatMoneyCode(stmtBalance, currency)}` : "No statement balance"}
            {systemBalance != null ? ` · System ${formatMoneyCode(systemBalance, currency)}` : ""}
          </p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4" />Statement vs ledger</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exceptions">Exceptions only</SelectItem>
                <SelectItem value="all">All movements</SelectItem>
                <SelectItem value="matched">Matched</SelectItem>
                <SelectItem value="missing_in_ledger">Missing in ledger</SelectItem>
                <SelectItem value="amount_mismatch">Amount mismatch</SelectItem>
                <SelectItem value="not_applicable">Pre-cutover</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={!rows.length}
              onClick={() => exportCSV("loan-reconciliation.csv",
                ["Date", "Type", "Description", "Source", "Movement", "Posted", "Difference", "Status"], exportRows())}>
              <FileDown className="h-4 w-4 mr-1" />CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Movement</TableHead>
                <TableHead className="text-right">Posted</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !visible.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {filter === "exceptions" ? "No exceptions — statement and ledger agree" : "Nothing to show"}
                </TableCell></TableRow>
              ) : visible.map((r) => (
                <TableRow key={r.txn_id}>
                  <TableCell className="text-sm">{format(parseISO(r.txn_date), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-sm capitalize">{r.txn_type.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-sm max-w-[220px] truncate">{r.description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.source}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoneyCode(r.amount, currency)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.posting_count ? formatMoneyCode(r.posted_amount, currency) : "—"}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-xs ${Math.abs(Number(r.difference)) > 0.01 ? "text-destructive" : ""}`}>
                    {r.posting_count ? formatMoneyCode(r.difference, currency) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={statusTone[r.match_status]}>{statusLabel[r.match_status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {["missing_in_ledger", "amount_mismatch", "unbalanced"].includes(r.match_status) && (
                      <Button size="sm" variant="outline" disabled={repost.isPending} onClick={() => repost.mutate(r.txn_id)}>
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />Post
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!!orphans?.length && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Ledger-only postings</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orphans.map((o: any) => (
                  <TableRow key={o.posting_id}>
                    <TableCell className="text-sm">{format(parseISO(o.transaction_date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="text-sm">{o.description}</TableCell>
                    <TableCell className="text-sm capitalize">{o.category?.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatMoneyCode(o.debit_amount, currency)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatMoneyCode(o.credit_amount, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
