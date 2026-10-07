import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Database, PlayCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LEGACY = "00000000-0000-0000-0000-000000000001";

export default function AdoptLegacyData() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [report, setReport] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { data: legacyCounts } = useQuery({
    queryKey: ["legacy-counts"],
    queryFn: async () => {
      const tables = [
        "invoices","payments","accounting_transactions","gl_accounts","employees",
        "containers","customers","suppliers","eir_records","gate_appointments",
        "purchase_orders","vendor_payments","tariffs","quotes","repatriations",
      ];
      const out: Record<string, number> = {};
      await Promise.all(
        tables.map(async (t) => {
          const { count } = await (supabase as any).from(t).select("*", { count: "exact", head: true }).eq("organization_id", LEGACY);
          out[t] = count ?? 0;
        })
      );
      return out;
    },
  });

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      if (!org.organizationId) throw new Error("No active organization");
      const { data, error } = await supabase.rpc("adopt_legacy_org_data" as any, {
        _target_org: org.organizationId,
        _dry_run: dry,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data, dry) => {
      setReport(data);
      toast({
        title: dry ? "Dry run complete" : "Adoption complete",
        description: `${data?.total_rows ?? 0} rows ${dry ? "would be moved" : "moved"}.`,
      });
      if (!dry) qc.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const isLegacyActive = org.organizationId === LEGACY;
  const totalLegacy = Object.values(legacyCounts ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="h-6 w-6" />Adopt Legacy Data</h1>
        <p className="text-muted-foreground">
          Move records that live under the legacy Default Organization into your active tenant so dashboards, payroll and the ledger reflect them.
        </p>
      </div>

      {isLegacyActive ? (
        <Card className="border-warning/50">
          <CardContent className="p-4 flex gap-3 items-start">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <div className="text-sm">You are already viewing the legacy organization. Switch to your tenant org before running adoption.</div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Target</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Active org:</span> <span className="font-medium">{org.organizationName}</span></div>
              <div className="text-xs text-muted-foreground font-mono">{org.organizationId}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Legacy rows available</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Table</TableHead><TableHead className="text-right">Rows</TableHead></TableRow></TableHeader>
                <TableBody>
                  {Object.entries(legacyCounts ?? {}).map(([t, c]) => (
                    <TableRow key={t}><TableCell className="font-mono text-xs">{t}</TableCell><TableCell className="text-right font-mono">{c}</TableCell></TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-mono">{totalLegacy}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending}>
              <PlayCircle className="h-4 w-4 mr-2" /> Dry run
            </Button>
            <Button
              variant={confirmed ? "default" : "secondary"}
              onClick={() => {
                if (!confirmed) { setConfirmed(true); return; }
                run.mutate(false);
              }}
              disabled={run.isPending || totalLegacy === 0}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {confirmed ? "Confirm: move data now" : "Adopt all legacy data"}
            </Button>
            {confirmed && <Button variant="ghost" onClick={() => setConfirmed(false)}>Cancel</Button>}
          </div>

          {report && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Result <Badge variant={report.dry_run ? "secondary" : "default"}>{report.dry_run ? "DRY RUN" : "APPLIED"}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm mb-2">{report.total_rows ?? 0} rows {report.dry_run ? "would move" : "moved"}.</div>
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-80">{JSON.stringify(report.by_table, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
