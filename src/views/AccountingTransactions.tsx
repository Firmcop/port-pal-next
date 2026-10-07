import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, FileDown, FileText } from "lucide-react";
import { format } from "date-fns";
import { exportCSV, exportPDF } from "@/lib/export-utils";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Money } from "@/components/Money";

const typeColor: Record<string, string> = {
  revenue: "bg-success/15 text-success",
  cost_of_goods: "bg-warning/15 text-warning",
  expense: "bg-destructive/15 text-destructive",
  asset: "bg-info/15 text-info",
  liability: "bg-purple-100 text-purple-800",
};

export default function AccountingTransactions() {
  useRealtimeInvalidate([{ table: "accounting_transactions", queryKeys: ["accounting-transactions"] }], "acct-tx-rt");
  const { data: txns, isLoading } = useQuery({

    queryKey: ["accounting-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_transactions")
        .select("*")
        .order("transaction_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const headers = ["Txn #", "Date", "Account", "Category", "Description", "Debit", "Credit"];
  const toRows = () =>
    (txns ?? []).map((t: any) => [
      t.transaction_number,
      format(new Date(t.transaction_date), "yyyy-MM-dd"),
      t.account_type?.replace("_", " "),
      t.category?.replace("_", " "),
      t.description,
      Number(t.debit_amount) > 0 ? String(t.debit_amount) : "",
      Number(t.credit_amount) > 0 ? String(t.credit_amount) : "",
    ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" />Accounting Transactions</h1>
          <p className="text-muted-foreground">General ledger of all financial transactions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!txns?.length} onClick={() => exportCSV("accounting_transactions.csv", headers, toRows())}>
            <FileDown className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" disabled={!txns?.length} onClick={() => exportPDF("Accounting Transactions", "accounting_transactions.pdf", headers, toRows(), { landscape: true })}>
            <FileText className="h-4 w-4 mr-1" />PDF
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Txn #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !txns?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No transactions recorded</TableCell></TableRow>
              ) : txns.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.transaction_number}</TableCell>
                  <TableCell className="text-xs">{format(new Date(t.transaction_date), "dd MMM yyyy")}</TableCell>
                  <TableCell><Badge className={typeColor[t.account_type] ?? ""} variant="secondary">{t.account_type?.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="capitalize">{t.category?.replace("_", " ")}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{t.description}</TableCell>
                  <TableCell className="text-right font-mono">{Number(t.debit_amount) > 0 ? <Money amount={t.debit_amount} currency={t.currency} /> : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(t.credit_amount) > 0 ? <Money amount={t.credit_amount} currency={t.currency} /> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
