import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Scale } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

export default function TrialBalance() {
  useRealtimeInvalidate([{ table: "accounting_transactions", queryKeys: ["account-balances"] }], "tb-rt");
  const { data: rows } = useQuery({

    queryKey: ["account-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_account_balances" as any).select("*").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const totals = (rows ?? []).reduce(
    (acc, r) => {
      acc.debit += Number(r.total_debit || 0);
      acc.credit += Number(r.total_credit || 0);
      return acc;
    },
    { debit: 0, credit: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" />Trial Balance</h1>
        <p className="text-muted-foreground">All accounts with debit and credit totals.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No data — seed your chart of accounts first.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.gl_account_id}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="capitalize text-muted-foreground text-xs">{r.account_type?.replace("_", " ")}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.total_debit) > 0 ? fmtMoney(r.total_debit) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.total_credit) > 0 ? fmtMoney(r.total_credit) : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{fmtMoney(r.balance)}</TableCell>
                </TableRow>
              ))}
              {rows?.length ? (
                <TableRow className="font-bold border-t-2">
                  <TableCell colSpan={3}>Totals</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(totals.debit)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(totals.credit)}</TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={Math.abs(totals.debit - totals.credit) < 0.01 ? "text-success" : "text-destructive"}>
                      {Math.abs(totals.debit - totals.credit) < 0.01 ? "Balanced" : fmtMoney(totals.debit - totals.credit)}
                    </span>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
