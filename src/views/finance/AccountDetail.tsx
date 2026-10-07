import { useParams, Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Wallet } from "lucide-react";
import { format } from "date-fns";

export default function AccountDetail() {
  const { id } = useParams();

  const { data: account } = useQuery({
    queryKey: ["financial-account", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financial_account_balances").select("*").eq("account_id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: txns } = useQuery({
    queryKey: ["account-statement", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_transactions")
        .select("*")
        .eq("financial_account_id", id!)
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (!account) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild><Link to="/finance/accounts"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" />{account.name}</h1>
          <p className="text-sm text-muted-foreground">{account.account_type.replace("_"," ")} · {account.currency}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Opening</p><p className="text-xl font-mono">{Number(account.opening_balance).toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Net Movement</p><p className="text-xl font-mono">{Number(account.net_movement).toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Current Balance</p><p className="text-xl font-mono font-bold">{Number(account.current_balance).toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cleared</p><p className="text-xl font-mono">{Number(account.cleared_balance).toFixed(2)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Statement</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Txn #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Cleared</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!txns?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No transactions on this account.</TableCell></TableRow>
              ) : txns.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{format(new Date(t.transaction_date), "yyyy-MM-dd")}</TableCell>
                  <TableCell className="font-mono text-xs">{t.transaction_number}</TableCell>
                  <TableCell>{t.description}</TableCell>
                  <TableCell className="text-xs">{t.category?.replace("_"," ")}</TableCell>
                  <TableCell className="text-right font-mono">{Number(t.debit_amount) > 0 ? Number(t.debit_amount).toFixed(2) : ""}</TableCell>
                  <TableCell className="text-right font-mono">{Number(t.credit_amount) > 0 ? Number(t.credit_amount).toFixed(2) : ""}</TableCell>
                  <TableCell>{t.cleared_at ? <Badge variant="secondary" className="bg-success/15 text-success">cleared</Badge> : <Badge variant="outline">open</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
