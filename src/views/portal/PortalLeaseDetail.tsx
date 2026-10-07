import { useParams, Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import { exportPDF, exportCSV } from "@/lib/export-utils";

function daysSince(d?: string | null, end?: string | null) {
  if (!d) return 0;
  const endTs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.floor((endTs - new Date(d).getTime()) / 86400000));
}

export default function PortalLeaseDetail() {
  const { id } = useParams();

  const { data: lease } = useQuery({
    queryKey: ["portal-lease", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("lease_agreements").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: units } = useQuery({
    queryKey: ["portal-lease-units", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_units")
        .select("*, containers(container_number, size, category)")
        .eq("lease_id", id!)
        .order("on_hire_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["portal-lease-runs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_invoices_run")
        .select("*, invoices(invoice_number, total_amount, status, due_at)")
        .eq("lease_id", id!)
        .order("generated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!lease) return <div className="text-muted-foreground">Loading...</div>;

  const accruedRows = (units ?? []).map((u: any) => {
    const free = lease.free_days_pickup ?? 0;
    const days = Math.max(0, daysSince(u.on_hire_at, u.off_hire_at) - free);
    const rate = parseFloat(String(u.effective_per_diem ?? "")) || parseFloat(String(lease.default_per_diem ?? "")) || 0;
    const accrued = days * rate;
    const dppDays = Math.max(0, daysSince(u.on_hire_at, u.off_hire_at));
    const dppRaw = dppDays * (parseFloat(String(lease.dpp_rate_per_day ?? "")) || 0);
    const cap = parseFloat(String(lease.dpp_cap_per_unit ?? "")) || 0;
    const dppCharge = u.dpp_active && lease.dpp_enabled ? (cap > 0 ? Math.min(dppRaw, cap) : dppRaw) : 0;
    return {
      container: u.containers?.container_number ?? "—",
      days, rate, accrued, dpp: dppCharge, total: accrued + dppCharge,
    };
  });
  const totalAccrued = accruedRows.reduce((s, r) => s + r.total, 0);

  const downloadStatement = () => {
    const headers = ["Container", "Billable Days", "Per Diem", "Per-Diem Accrued", "DPP", "Total"];
    const rows = accruedRows.map((r) => [
      r.container, String(r.days), r.rate.toFixed(2), r.accrued.toFixed(2), r.dpp.toFixed(2), r.total.toFixed(2),
    ]);
    rows.push(["", "", "", "", "TOTAL", totalAccrued.toFixed(2)]);
    exportPDF(
      `Lease Statement — ${lease.lease_number}`,
      `statement-${lease.lease_number}.pdf`,
      headers,
      rows,
      { landscape: true }
    );
  };

  const downloadStatementCsv = () => {
    const headers = ["Container", "Billable Days", "Per Diem", "Per-Diem Accrued", "DPP", "Total"];
    const rows = accruedRows.map((r) => [r.container, String(r.days), r.rate.toFixed(2), r.accrued.toFixed(2), r.dpp.toFixed(2), r.total.toFixed(2)]);
    exportCSV(`statement-${lease.lease_number}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost"><Link to="/portal/leases"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{lease.lease_number}</h1>
          <p className="text-muted-foreground text-sm capitalize">{lease.lease_type.replace("_", " ")} · {lease.currency}</p>
        </div>
        <Badge variant="outline">{lease.status}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Per Diem</CardTitle></CardHeader><CardContent className="text-xl font-bold font-mono">{lease.currency} {Number(lease.default_per_diem).toFixed(2)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Free Days (Pick / Redel)</CardTitle></CardHeader><CardContent className="text-xl font-bold">{lease.free_days_pickup} / {lease.free_days_redelivery}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Active Units</CardTitle></CardHeader><CardContent className="text-xl font-bold">{(units ?? []).filter((u: any) => u.status === "on_hire").length}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Accrued (current)</CardTitle></CardHeader><CardContent className="text-xl font-bold font-mono">{lease.currency} {totalAccrued.toFixed(2)}</CardContent></Card>
      </div>

      <Tabs defaultValue="units">
        <TabsList>
          <TabsTrigger value="units">Units ({units?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="accrued">Accrued Charges</TabsTrigger>
          <TabsTrigger value="invoices">Statements & Invoices ({runs?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="units">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Container</TableHead><TableHead>Status</TableHead>
                <TableHead>On-Hire</TableHead><TableHead>Off-Hire</TableHead>
                <TableHead className="text-right">Per Diem</TableHead><TableHead>DPP</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {!units?.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No units yet.</TableCell></TableRow>
                ) : units.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-xs">{u.containers?.container_number ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{u.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-xs">{u.on_hire_at ? new Date(u.on_hire_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="text-xs">{u.off_hire_at ? new Date(u.off_hire_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{(parseFloat(String(u.effective_per_diem ?? "")) || 0).toFixed(2)}</TableCell>
                    <TableCell>{u.dpp_active ? "Yes" : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="accrued">
          <div className="flex justify-end gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={downloadStatementCsv} disabled={!accruedRows.length}><Download className="h-4 w-4 mr-1" />CSV</Button>
            <Button size="sm" onClick={downloadStatement} disabled={!accruedRows.length}><Download className="h-4 w-4 mr-1" />Download Statement (PDF)</Button>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Container</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Per Diem</TableHead>
                <TableHead className="text-right">Per-Diem Accrued</TableHead>
                <TableHead className="text-right">DPP</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {!accruedRows.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No charges accrued.</TableCell></TableRow>
                ) : accruedRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.container}</TableCell>
                    <TableCell className="text-right">{r.days}</TableCell>
                    <TableCell className="text-right font-mono">{r.rate.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{r.accrued.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{r.dpp.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{r.total.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {accruedRows.length > 0 && (
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={5} className="text-right font-bold">TOTAL ({lease.currency})</TableCell>
                    <TableCell className="text-right font-mono font-bold">{totalAccrued.toFixed(2)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Generated</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {!runs?.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No statements issued yet.</TableCell></TableRow>
                ) : runs.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.generated_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                    <TableCell className="text-right">{r.units_count}</TableCell>
                    <TableCell className="text-right font-mono">{lease.currency} {Number(r.total_amount).toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.invoices?.invoice_number ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.invoices?.status ?? "—"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
