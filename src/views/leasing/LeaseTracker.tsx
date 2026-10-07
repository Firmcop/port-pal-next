import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Container, Calendar, DollarSign, Package } from "lucide-react";

function daysSince(d?: string | null) {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

export default function LeaseTracker() {
  const { data: units, isLoading } = useQuery({
    queryKey: ["lease-tracker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_units")
        .select("*, lease_agreements(lease_number, lessee_name, currency, default_per_diem, free_days_pickup), containers(container_number, size, category, status)")
        .order("on_hire_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const stats = {
    onHire: units?.filter((u: any) => u.status === "on_hire").length ?? 0,
    offHire: units?.filter((u: any) => u.status === "off_hire").length ?? 0,
    accrued: units?.reduce((sum: number, u: any) => {
      if (u.status !== "on_hire" || !u.on_hire_at) return sum;
      const days = Math.max(0, daysSince(u.on_hire_at) - (u.lease_agreements?.free_days_pickup ?? 0));
      return sum + days * (parseFloat(u.effective_per_diem) || parseFloat(u.lease_agreements?.default_per_diem) || 0);
    }, 0) ?? 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leasing Tracker</h1>
        <p className="text-muted-foreground">All leased containers across agreements</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Container className="h-4 w-4" />On-Hire Units</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.onHire}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Package className="h-4 w-4" />Off-Hire Units</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.offHire}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4" />Accrued Per-Diem</CardTitle></CardHeader><CardContent className="text-2xl font-bold font-mono">{stats.accrued.toFixed(2)}</CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container</TableHead>
                <TableHead>Lease #</TableHead>
                <TableHead>Lessee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>On-Hire</TableHead>
                <TableHead>Off-Hire</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Per Diem</TableHead>
                <TableHead className="text-right">Accrued</TableHead>
                <TableHead>DPP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={10} />
              ) : !units?.length ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No leased units yet. Assign containers from an agreement.</TableCell></TableRow>
              ) : (
                units.map((u: any) => {
                  const days = u.on_hire_at ? Math.max(0, daysSince(u.on_hire_at) - (u.lease_agreements?.free_days_pickup ?? 0)) : 0;
                  const rate = parseFloat(u.effective_per_diem) || parseFloat(u.lease_agreements?.default_per_diem) || 0;
                  const accrued = days * rate;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-xs">{u.containers?.container_number ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{u.lease_agreements?.lease_number}</TableCell>
                      <TableCell>{u.lease_agreements?.lessee_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={u.status === "on_hire" ? "bg-success/15 text-success border-success/30" : "bg-gray-500/15 text-gray-700 border-gray-300"}>
                          {u.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{u.on_hire_at ? new Date(u.on_hire_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-xs">{u.off_hire_at ? new Date(u.off_hire_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-right">{days}</TableCell>
                      <TableCell className="text-right font-mono">{rate.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{accrued.toFixed(2)}</TableCell>
                      <TableCell>{u.dpp_active ? <Badge variant="outline" className="bg-info/15 text-info border-info/30">DPP</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
