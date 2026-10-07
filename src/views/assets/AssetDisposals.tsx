import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PackageMinus } from "lucide-react";
import { fmtMoney } from "@/lib/finance-format";

export default function AssetDisposals() {
  const { data } = useQuery({
    queryKey: ["asset-disposals-all"],
    queryFn: async () => (await supabase.from("asset_disposals" as any)
      .select("*, fixed_assets(id, code, name), customers:buyer_customer_id(name)")
      .order("disposed_on", { ascending: false })).data ?? [],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><PackageMinus className="h-6 w-6" />Asset disposals</h1>
        <p className="text-muted-foreground">Sales, scraps, donations and write-offs.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Asset</TableHead><TableHead>Method</TableHead>
                <TableHead>Buyer</TableHead><TableHead className="text-right">Proceeds</TableHead>
                <TableHead className="text-right">NBV</TableHead><TableHead className="text-right">Gain / Loss</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No disposals recorded.</TableCell></TableRow>
              ) : data.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs">{d.disposed_on}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/assets/${d.fixed_assets?.id}`} className="hover:underline">
                      {d.fixed_assets?.code} — {d.fixed_assets?.name}
                    </Link>
                  </TableCell>
                  <TableCell>{d.method}</TableCell>
                  <TableCell className="text-xs">{d.customers?.name || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(d.proceeds)}</TableCell>
                  <TableCell className="text-right font-mono">{d.nbv_at_disposal != null ? fmtMoney(d.nbv_at_disposal) : "—"}</TableCell>
                  <TableCell className={`text-right font-mono ${Number(d.gain_loss) < 0 ? "text-destructive" : ""}`}>{d.gain_loss != null ? fmtMoney(d.gain_loss) : "—"}</TableCell>
                  <TableCell><Badge>{d.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
