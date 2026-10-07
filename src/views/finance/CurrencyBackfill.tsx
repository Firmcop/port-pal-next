import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, History, PlayCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "@/lib/router";

type BackfillResult = {
  dry_run: boolean;
  batch_id: string;
  org_base_currency: string;
  affected: number;
  missing_rates: { sale_number: string; from: string; to: string; on: string }[];
  samples: { sale_number: string; txn_id: string; old_currency: string | null; new_currency: string; fx_rate: number; base_currency: string }[];
};

export default function CurrencyBackfill() {
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data, error } = await supabase.rpc("backfill_sales_currency" as any, {
        _org: organizationId,
        _dry_run: dryRun,
      });
      if (error) throw error;
      return data as unknown as BackfillResult;
    },
    onSuccess: (r) => {
      setResult(r);
      if (!r.dry_run) {
        toast({ title: "Backfill complete", description: `${r.affected} ledger rows updated.` });
        setConfirmed(false);
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><History className="h-6 w-6" />Currency Backfill</h1>
        <p className="text-muted-foreground">
          Rewrite historical Container Sales ledger entries to match each sale's stored currency and post FX rates against the org base.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Step 1 · Dry run</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Preview which accounting transactions would be rewritten. Nothing is changed.</p>
          <Button onClick={() => { setConfirmed(false); run.mutate(true); }} disabled={run.isPending || !organizationId}>
            <PlayCircle className="mr-1 h-4 w-4" />Run dry-run
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {result.dry_run ? "Dry run results" : "Backfill applied"} · base {result.org_base_currency}
            </CardTitle>
            <Badge variant={result.affected ? "default" : "secondary"}>{result.affected} rows</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.missing_rates.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                <p className="font-medium flex items-center gap-2 text-warning"><AlertTriangle className="h-4 w-4" />Missing FX rates ({result.missing_rates.length})</p>
                <p className="text-xs text-muted-foreground mb-2">These sales will be skipped until you add the rate.</p>
                <ul className="text-xs space-y-1">
                  {result.missing_rates.slice(0, 20).map((m, i) => (
                    <li key={i} className="font-mono">{m.sale_number}: {m.from} → {m.to} on {m.on}</li>
                  ))}
                </ul>
                <Button asChild size="sm" variant="outline" className="mt-2"><Link to="/finance/fx-rates">Manage FX Rates</Link></Button>
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sale</TableHead><TableHead>Txn id</TableHead>
                  <TableHead>Old → New</TableHead><TableHead className="text-right">FX</TableHead>
                  <TableHead>Base</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!result.samples.length ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No mismatches — already balanced.</TableCell></TableRow>
                ) : result.samples.map((s) => (
                  <TableRow key={s.txn_id}>
                    <TableCell className="font-mono text-xs">{s.sale_number}</TableCell>
                    <TableCell className="font-mono text-xs">{s.txn_id.slice(0, 8)}…</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline">{s.old_currency ?? "∅"}</Badge> → <Badge>{s.new_currency}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{Number(s.fx_rate).toFixed(6)}</TableCell>
                    <TableCell className="font-mono text-xs">{s.base_currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {result.dry_run && result.affected > 0 && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-sm font-medium">Step 2 · Commit</p>
                <p className="text-xs text-muted-foreground">
                  Type <code className="font-mono">{result.affected}</code> below to confirm rewriting {result.affected} rows. This is audited.
                </p>
                <div className="flex gap-2">
                  <input
                    className="border rounded px-2 py-1 text-sm font-mono w-32 bg-background"
                    placeholder={String(result.affected)}
                    onChange={(e) => setConfirmed(e.target.value === String(result.affected))}
                  />
                  <Button
                    variant="destructive"
                    disabled={!confirmed || run.isPending}
                    onClick={() => run.mutate(false)}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />Commit Backfill
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
