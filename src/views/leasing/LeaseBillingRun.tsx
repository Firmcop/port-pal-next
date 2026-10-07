import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function firstOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function lastOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }

export default function LeaseBillingRun() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [periodStart, setPeriodStart] = useState(firstOfMonth());
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth());

  const { data: runs, isLoading } = useQuery({
    queryKey: ["lease-billing-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_invoices_run")
        .select("*, lease_agreements(lease_number, lessee_name, currency)")
        .order("generated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const runBilling = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("generate_lease_invoices", { _period_start: periodStart, _period_end: periodEnd });
      if (error) throw error;
      return data;
    },
    onSuccess: (count: number) => {
      qc.invalidateQueries({ queryKey: ["lease-billing-runs"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Billing run complete", description: `${count} invoice${count === 1 ? "" : "s"} generated` });
    },
    onError: (e: any) => toast({ title: "Billing failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lease Billing Run</h1>
        <p className="text-muted-foreground">Generate per-diem invoices for active leases over a period</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Billing Run</CardTitle>
          <CardDescription>One invoice per active lease covering all on-hire units in the period.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Period Start</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Period End</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <Button onClick={() => runBilling.mutate()} disabled={runBilling.isPending}>
              <Play className="mr-1 h-4 w-4" />
              {runBilling.isPending ? "Running..." : "Generate Invoices"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Runs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Generated</TableHead>
                <TableHead>Lease #</TableHead>
                <TableHead>Lessee</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={6} />
              ) : !runs?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No billing runs yet.</TableCell></TableRow>
              ) : runs.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.generated_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{r.lease_agreements?.lease_number}</TableCell>
                  <TableCell>{r.lease_agreements?.lessee_name}</TableCell>
                  <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                  <TableCell className="text-right">{r.units_count}</TableCell>
                  <TableCell className="text-right font-mono">{r.lease_agreements?.currency} {parseFloat(r.total_amount).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
