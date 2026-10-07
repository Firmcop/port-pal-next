import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";

export default function AssetMaintenance() {
  const { data } = useQuery({
    queryKey: ["asset-maintenance-due"],
    queryFn: async () => (await supabase.from("asset_maintenance_plans" as any)
      .select("*, fixed_assets(id, code, name, asset_class, depots(name))")
      .eq("is_active", true)
      .order("next_due_at")).data ?? [],
  });

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const status = (d: string) => {
    if (d < today) return { label: "Overdue", tone: "destructive" as const };
    if (d <= soon) return { label: "Due this week", tone: "outline" as const };
    return { label: "Scheduled", tone: "secondary" as const };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6" />Maintenance schedules</h1>
        <p className="text-muted-foreground">Preventive maintenance plans across all assets.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead><TableHead>Depot</TableHead><TableHead>Plan</TableHead>
                <TableHead>Frequency</TableHead><TableHead>Next due</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No active plans.</TableCell></TableRow>
              ) : data.map((p: any) => {
                const s = status(p.next_due_at);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">
                      <Link to={`/assets/${p.fixed_assets?.id}`} className="hover:underline">
                        {p.fixed_assets?.code} — {p.fixed_assets?.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{p.fixed_assets?.depots?.name || "—"}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-xs">{p.frequency}</TableCell>
                    <TableCell className="font-mono text-xs">{p.next_due_at}</TableCell>
                    <TableCell><Badge variant={s.tone}>{s.label}</Badge></TableCell>
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
