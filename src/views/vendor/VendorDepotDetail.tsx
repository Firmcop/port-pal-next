import { Navigate, useParams, Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Loader2, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export default function VendorDepotDetail() {
  const { id: orgId, depotId } = useParams<{ id: string; depotId: string }>();
  const me = useOrganization();
  const [search, setSearch] = useState("");

  const { data: depot, isLoading: loadingDepot } = useQuery({
    queryKey: ["vendor-depot", depotId],
    queryFn: async () => {
      const { data, error } = await supabase.from("depots").select("*").eq("id", depotId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!depotId && me.isPlatformAdmin,
  });

  const { data: org } = useQuery({
    queryKey: ["vendor-org-name", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId!).maybeSingle();
      return data;
    },
    enabled: !!orgId && me.isPlatformAdmin,
  });

  const { data: kpis } = useQuery({
    queryKey: ["depot-kpis", depotId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("depot_kpis", { _depot_id: depotId! });
      if (error) throw error;
      return data as any;
    },
    enabled: !!depotId && me.isPlatformAdmin,
  });

  const { data: blocks } = useQuery({
    queryKey: ["depot-blocks", depotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yard_blocks").select("*").eq("depot_id", depotId!).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!depotId && me.isPlatformAdmin,
  });

  const { data: containers, isLoading: loadingContainers } = useQuery({
    queryKey: ["depot-containers", depotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, category, status, owner, gate_in_at, gate_out_at, block_id")
        .eq("depot_id", depotId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
    enabled: !!depotId && me.isPlatformAdmin,
  });

  const containerIds = (containers ?? []).map((c) => c.id);

  const { data: movements } = useQuery({
    queryKey: ["depot-movements", depotId, containerIds.length],
    queryFn: async () => {
      if (!containerIds.length) return [];
      const { data, error } = await supabase
        .from("container_movements")
        .select("id, container_id, movement_type, created_at, notes")
        .in("container_id", containerIds)
        .in("movement_type", ["gate_in", "gate_out"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: containerIds.length > 0,
  });

  const { data: appointments } = useQuery({
    queryKey: ["depot-appointments", depotId, containerIds.length],
    queryFn: async () => {
      if (!containerIds.length) return [];
      const { data, error } = await supabase
        .from("gate_appointments")
        .select("id, appointment_number, status, scheduled_at, container_id")
        .in("container_id", containerIds)
        .order("scheduled_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: containerIds.length > 0,
  });

  const { data: workOrders } = useQuery({
    queryKey: ["depot-work-orders", depotId, containerIds.length],
    queryFn: async () => {
      if (!containerIds.length) return [];
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, wo_number, status, priority, container_id, created_at")
        .in("container_id", containerIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: containerIds.length > 0,
  });

  const { data: inspections } = useQuery({
    queryKey: ["depot-inspections", depotId, containerIds.length],
    queryFn: async () => {
      if (!containerIds.length) return [];
      const { data, error } = await supabase
        .from("inspections")
        .select("id, container_id, condition_grade, created_at")
        .in("container_id", containerIds)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: containerIds.length > 0,
  });

  if (me.loading) return <Loader2 className="animate-spin" />;
  if (!me.isPlatformAdmin) return <Navigate to="/" replace />;
  if (loadingDepot || !depot) return <Loader2 className="animate-spin" />;

  const containerLabel = (id: string) =>
    containers?.find((c) => c.id === id)?.container_number ?? id.slice(0, 8);

  const filtered = (containers ?? []).filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.container_number?.toLowerCase().includes(s) ||
      c.owner?.toLowerCase().includes(s) ||
      c.status?.toLowerCase().includes(s)
    );
  });

  const dwellDays = (c: any) => {
    if (!c.gate_in_at) return "—";
    const end = c.gate_out_at ? new Date(c.gate_out_at) : new Date();
    return Math.round((end.getTime() - new Date(c.gate_in_at).getTime()) / 86400000);
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to={`/vendor/organizations/${orgId}`}>
            <ArrowLeft className="h-4 w-4 me-1" /> {org?.name ?? "Organization"}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{depot.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{depot.code}</span> · {depot.currency} · {depot.timezone}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Containers" value={kpis?.containers_total ?? 0} />
        <Kpi label="In yard" value={kpis?.in_yard ?? 0} />
        <Kpi label="Open WOs" value={kpis?.open_work_orders ?? 0} />
        <Kpi label="Gate moves today" value={kpis?.gate_moves_today ?? 0} />
        <Kpi label="Avg dwell (days)" value={kpis?.avg_dwell_days ?? 0} />
      </div>

      <Tabs defaultValue="yard">
        <TabsList>
          <TabsTrigger value="yard">Yard map</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="gate">Gate activity</TabsTrigger>
          <TabsTrigger value="mr">Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="yard">
          <Card>
            <CardContent className="pt-6">
              {!blocks?.length ? (
                <p className="text-muted-foreground text-sm">No yard blocks configured for this depot.</p>
              ) : (
                <div className="space-y-6">
                  {blocks.map((b: any) => {
                    const capacity = (b.max_bays ?? 0) * (b.max_rows ?? 0) * (b.max_tiers ?? 0);
                    const used = (containers ?? []).filter((c) => c.block_id === b.id).length;
                    const pct = capacity > 0 ? Math.round((used / capacity) * 100) : 0;
                    return (
                      <div key={b.id} className="space-y-2">
                        <div className="flex items-baseline justify-between">
                          <h3 className="font-medium">{b.name} <span className="text-xs text-muted-foreground">{b.block_type}</span></h3>
                          <span className="text-sm text-muted-foreground">{used} / {capacity} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-muted rounded overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <div
                          className="grid gap-1"
                          style={{ gridTemplateColumns: `repeat(${b.max_bays ?? 1}, minmax(0, 1fr))` }}
                        >
                          {Array.from({ length: (b.max_bays ?? 0) * (b.max_rows ?? 0) }).map((_, i) => {
                            const filled = i < used;
                            return (
                              <div key={i}
                                className={`h-4 rounded-sm ${filled ? "bg-primary/70" : "bg-muted"}`}
                                title={filled ? "Occupied" : "Empty"} />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <Input
                placeholder="Search by number, owner or status"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Dwell (d)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingContainers ? (
                    <TableSkeleton columns={6} />
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No containers.</TableCell></TableRow>
                  ) : filtered.slice(0, 200).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.container_number}</TableCell>
                      <TableCell>{c.size}</TableCell>
                      <TableCell>{c.category}</TableCell>
                      <TableCell><Badge variant="outline">{String(c.status).replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell>{c.owner ?? "—"}</TableCell>
                      <TableCell className="text-right">{dwellDays(c)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 200 && (
                <p className="text-xs text-muted-foreground">Showing first 200 of {filtered.length}.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gate">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-medium mb-3">Recent appointments</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Container</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Scheduled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!appointments?.length ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">None.</TableCell></TableRow>
                    ) : appointments.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.appointment_number}</TableCell>
                        <TableCell className="font-mono text-xs">{a.container_id ? containerLabel(a.container_id) : "—"}</TableCell>
                        <TableCell><Badge variant="outline">{String(a.status).replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{a.scheduled_at ? format(new Date(a.scheduled_at), "PP p") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-medium mb-3">Latest gate moves</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!movements?.length ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">None.</TableCell></TableRow>
                    ) : movements.map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{containerLabel(m.container_id)}</TableCell>
                        <TableCell><Badge variant="outline">{String(m.movement_type).replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(m.created_at), "PP p")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="mr">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-medium mb-3">Work orders</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>WO</TableHead>
                      <TableHead>Container</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!workOrders?.length ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">None.</TableCell></TableRow>
                    ) : workOrders.map((w: any) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.wo_number}</TableCell>
                        <TableCell className="font-mono text-xs">{containerLabel(w.container_id)}</TableCell>
                        <TableCell><Badge variant="outline">{String(w.status).replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell>{w.priority}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-medium mb-3">Recent inspections</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!inspections?.length ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">None.</TableCell></TableRow>
                    ) : inspections.map((i: any) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{containerLabel(i.container_id)}</TableCell>
                        <TableCell><Badge variant="outline">Grade {i.condition_grade}</Badge></TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(i.created_at), "PP")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
