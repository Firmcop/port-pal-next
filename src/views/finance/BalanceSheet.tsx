import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { FinanceDataStatus } from "@/components/finance/FinanceDataStatus";

export default function BalanceSheet() {
  useRealtimeInvalidate([{ table: "accounting_transactions", queryKeys: ["account-balances"] }], "bs-rt");
  const { data: rows } = useQuery({

    queryKey: ["account-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_account_balances" as any).select("*").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const data = useMemo(() => {
    const r = rows ?? [];
    const filter = (type: string) => r.filter((x) => x.account_type === type && Number(x.balance) !== 0);
    const assets = filter("asset");
    const liabilities = filter("liability");
    const equity = filter("equity");
    const sum = (arr: any[]) => arr.reduce((s, x) => s + Number(x.balance || 0), 0);
    const totRev = sum(r.filter((x) => x.account_type === "revenue"));
    const totCogs = sum(r.filter((x) => x.account_type === "cost_of_goods"));
    const totExp = sum(r.filter((x) => x.account_type === "expense"));
    const netIncome = totRev - totCogs - totExp;
    const totAssets = sum(assets);
    const totLiab = sum(liabilities);
    const totEquity = sum(equity) + netIncome;
    return { assets, liabilities, equity, totAssets, totLiab, totEquity, netIncome };
  }, [rows]);

  const Row = ({ r }: { r: any }) => (
    <div className="flex justify-between py-1 text-sm">
      <span><span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>{r.name}</span>
      <span className="font-mono">{fmtMoney(r.balance)}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" />Balance Sheet</h1>
        <p className="text-muted-foreground">Assets = Liabilities + Equity (incl. current year earnings).</p>
      </div>
      <FinanceDataStatus queryKeys={["account-balances"]} />

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Assets</CardTitle></CardHeader>
          <CardContent>
            {data.assets.map((r) => <Row key={r.gl_account_id} r={r} />)}
            <div className="flex justify-between py-2 border-t mt-2 font-bold"><span>Total Assets</span><span className="font-mono">{fmtMoney(data.totAssets)}</span></div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-base">Liabilities</CardTitle></CardHeader>
            <CardContent>
              {data.liabilities.map((r) => <Row key={r.gl_account_id} r={r} />)}
              <div className="flex justify-between py-2 border-t mt-2 font-semibold"><span>Total Liabilities</span><span className="font-mono">{fmtMoney(data.totLiab)}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3"><CardTitle className="text-base">Equity</CardTitle></CardHeader>
            <CardContent>
              {data.equity.map((r) => <Row key={r.gl_account_id} r={r} />)}
              <div className="flex justify-between py-1 text-sm italic"><span>Current Year Net Income</span><span className="font-mono">{fmtMoney(data.netIncome)}</span></div>
              <div className="flex justify-between py-2 border-t mt-2 font-semibold"><span>Total Equity</span><span className="font-mono">{fmtMoney(data.totEquity)}</span></div>
            </CardContent>
          </Card>

          <Card className={Math.abs(data.totAssets - (data.totLiab + data.totEquity)) < 0.01 ? "bg-success/10" : "bg-destructive/10"}>
            <CardContent className="py-3 flex justify-between font-bold">
              <span>Liabilities + Equity</span>
              <span className="font-mono">{fmtMoney(data.totLiab + data.totEquity)}</span>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
