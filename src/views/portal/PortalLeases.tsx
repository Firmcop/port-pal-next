import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

function daysSince(d?: string | null, end?: string | null) {
  if (!d) return 0;
  const endTs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.floor((endTs - new Date(d).getTime()) / 86400000));
}

export default function PortalLeases() {
  const { customerId } = usePortalAuth();

  const { data: agreements, isLoading } = useQuery({
    queryKey: ["portal-leases", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lease_agreements")
        .select("*, lease_units(id, status, on_hire_at, off_hire_at, effective_per_diem, dpp_active)")
        .eq("customer_id", customerId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Lease Agreements</h1>
        <p className="text-muted-foreground text-sm">Active and historical lease contracts.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lease #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Term</TableHead>
                <TableHead className="text-right">Per Diem</TableHead>
                <TableHead className="text-right">Active Units</TableHead>
                <TableHead className="text-right">Accrued</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : !agreements?.length ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No lease agreements yet.</TableCell></TableRow>
              ) : agreements.map((a: any) => {
                const onHire = (a.lease_units ?? []).filter((u: any) => u.status === "on_hire");
                const accrued = (a.lease_units ?? []).reduce((sum: number, u: any) => {
                  const days = Math.max(0, daysSince(u.on_hire_at, u.off_hire_at) - (a.free_days_pickup ?? 0));
                  const rate = parseFloat(String(u.effective_per_diem ?? "")) || parseFloat(String(a.default_per_diem ?? "")) || 0;
                  return sum + days * rate;
                }, 0);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.lease_number}</TableCell>
                    <TableCell className="capitalize">{a.lease_type.replace("_", " ")}</TableCell>
                    <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                    <TableCell className="text-xs">{a.start_date ?? "—"} → {a.end_date ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{a.currency} {Number(a.default_per_diem).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{onHire.length} / {a.lease_units?.length ?? 0}</TableCell>
                    <TableCell className="text-right font-mono">{a.currency} {accrued.toFixed(2)}</TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/portal/leases/${a.id}`}><ExternalLink className="h-4 w-4" /></Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
