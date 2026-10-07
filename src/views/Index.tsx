import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, ArrowLeftRight, MapPin, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

function KpiCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: any; color: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-5 w-5 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: containers } = useQuery({
    queryKey: ["containers-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, status, category, block_id");
      if (error) throw error;
      return data;
    },
  });

  const { data: todayMovements } = useQuery({
    queryKey: ["today-movements"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("container_movements")
        .select("id, movement_type, created_at, container_id, containers(container_number)")
        .gte("created_at", today.toISOString())
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const { data: blocks } = useQuery({
    queryKey: ["yard-blocks-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("yard_blocks").select("id, name, max_rows, max_bays, max_tiers");
      if (error) throw error;
      return data;
    },
  });

  const totalContainers = containers?.length ?? 0;
  const damagedCount = containers?.filter((c) => c.status === "damaged" || c.status === "repair_pending").length ?? 0;
  const inYardCount = containers?.filter((c) => c.block_id).length ?? 0;
  const totalCapacity = blocks?.reduce((sum, b) => sum + b.max_rows * b.max_bays * b.max_tiers, 0) ?? 1;
  const utilization = totalCapacity > 0 ? Math.round((inYardCount / totalCapacity) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Container Depot Management System overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Containers" value={totalContainers} icon={Package} color="text-primary" />
        <KpiCard title="Yard Utilization" value={`${utilization}%`} icon={MapPin} color="text-success" />
        <KpiCard title="Today's Movements" value={todayMovements?.length ?? 0} icon={ArrowLeftRight} color="text-info" />
        <KpiCard title="Damaged / Pending" value={damagedCount} icon={AlertTriangle} color="text-warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {(!todayMovements || todayMovements.length === 0) ? (
            <p className="text-sm text-muted-foreground">No movements recorded today. Add containers and record movements to see activity here.</p>
          ) : (
            <div className="space-y-3">
              {todayMovements.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                  <div>
                    <span className="font-mono font-medium">{m.containers?.container_number}</span>
                    <span className="ml-2 text-muted-foreground capitalize">{m.movement_type.replace("_", " ")}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">{format(new Date(m.created_at), "HH:mm")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
