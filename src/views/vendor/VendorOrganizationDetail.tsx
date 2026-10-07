import { useState } from "react";
import { Navigate, useParams, Link } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Pause, Play, CalendarPlus, Ban, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { UsageMetricsTab } from "@/components/vendor/UsageMetricsTab";
import { AuditFeedTab } from "@/components/vendor/AuditFeedTab";

export default function VendorOrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const me = useOrganization();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: org, isLoading } = useQuery({
    queryKey: ["vendor-org", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id && me.isPlatformAdmin,
  });

  const { data: members } = useQuery({
    queryKey: ["vendor-org-members", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("id, role, status, created_at, user_id, profiles:user_id(display_name)")
        .eq("organization_id", id!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id && me.isPlatformAdmin,
  });

  const { data: depots } = useQuery({
    queryKey: ["vendor-org-depots", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("depots").select("*").eq("organization_id", id!);
      if (error) throw error;
      return data;
    },
    enabled: !!id && me.isPlatformAdmin,
  });

  const { data: catalog } = useQuery({
    queryKey: ["modules-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("modules_catalog").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: me.isPlatformAdmin,
  });

  const { data: subModules } = useQuery({
    queryKey: ["vendor-org-modules", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_modules").select("*").eq("organization_id", id!);
      if (error) throw error;
      return data;
    },
    enabled: !!id && me.isPlatformAdmin,
  });

  const { data: events } = useQuery({
    queryKey: ["vendor-org-events", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_lifecycle_events")
        .select("*")
        .eq("organization_id", id!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!id && me.isPlatformAdmin,
  });

  if (me.loading) return <Loader2 className="animate-spin" />;
  if (!me.isPlatformAdmin) return <Navigate to="/" replace />;
  if (isLoading || !org) return <Loader2 className="animate-spin" />;

  const log = async (event_type: string, details: Record<string, any> = {}) => {
    await supabase.rpc("log_org_event", { _org_id: id!, _event_type: event_type, _details: details, _actor: null });
  };

  const updateStatus = async (status: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("organizations").update({ status: status as any }).eq("id", id!);
      if (error) throw error;
      await log(`status_changed_${status}`, { status });
      toast.success(`Status set to ${status}`);
      qc.invalidateQueries({ queryKey: ["vendor-org", id] });
      qc.invalidateQueries({ queryKey: ["vendor-org-events", id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const extendTrial = async (days: number) => {
    setBusy(true);
    try {
      const base = org.trial_ends_at ? new Date(org.trial_ends_at) : new Date();
      const newEnd = new Date(Math.max(base.getTime(), Date.now()) + days * 86400000).toISOString();
      const { error } = await supabase.from("organizations").update({ trial_ends_at: newEnd, status: "trial" as any }).eq("id", id!);
      if (error) throw error;
      await log("trial_extended", { days, new_trial_ends_at: newEnd });
      toast.success(`Trial extended by ${days} days`);
      qc.invalidateQueries({ queryKey: ["vendor-org", id] });
      qc.invalidateQueries({ queryKey: ["vendor-org-events", id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const toggleModule = async (code: string, enabled: boolean, price: number) => {
    setBusy(true);
    try {
      const existing = subModules?.find((m: any) => m.module_code === code);
      if (existing) {
        const { error } = await supabase.from("subscription_modules").update({ enabled }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("subscription_modules").insert({
          organization_id: id!, module_code: code, enabled, price_snapshot: price,
        });
        if (error) throw error;
      }
      await log(enabled ? "module_enabled" : "module_disabled", { module_code: code });
      toast.success(`Module ${code} ${enabled ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["vendor-org-modules", id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const updatePrice = async (code: string, price: number) => {
    const existing = subModules?.find((m: any) => m.module_code === code);
    if (!existing) return;
    const { error } = await supabase.from("subscription_modules").update({ price_snapshot: price }).eq("id", existing.id);
    if (error) toast.error(error.message);
    else { qc.invalidateQueries({ queryKey: ["vendor-org-modules", id] }); toast.success("Price updated"); }
  };

  const moduleEnabled = (code: string) => subModules?.find((m: any) => m.module_code === code)?.enabled ?? false;
  const modulePrice = (code: string, fallback: number) =>
    subModules?.find((m: any) => m.module_code === code)?.price_snapshot ?? fallback;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link to="/vendor/organizations"><ArrowLeft className="h-4 w-4 me-1" /> All organizations</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            {org.name} <StatusBadge status={org.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {org.slug} · {org.country ?? "—"} · {org.currency} · {org.timezone}
            {org.trial_ends_at && <> · Trial ends {format(new Date(org.trial_ends_at), "PP")}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {org.status === "suspended" || org.status === "past_due" ? (
            <Button variant="outline" size="sm" onClick={() => updateStatus("active")} disabled={busy}>
              <Play className="h-4 w-4 me-1" /> Reactivate
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => updateStatus("suspended")} disabled={busy}>
              <Pause className="h-4 w-4 me-1" /> Suspend
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => extendTrial(7)} disabled={busy}>
            <CalendarPlus className="h-4 w-4 me-1" /> +7d trial
          </Button>
          <Button variant="outline" size="sm" onClick={() => extendTrial(30)} disabled={busy}>
            <CalendarPlus className="h-4 w-4 me-1" /> +30d trial
          </Button>
          <Button variant="destructive" size="sm" onClick={() => updateStatus("cancelled")} disabled={busy}>
            <Ban className="h-4 w-4 me-1" /> Cancel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Members" value={members?.length ?? 0} />
        <KpiCard label="Depots" value={depots?.length ?? 0} />
        <KpiCard label="Active modules" value={subModules?.filter((m: any) => m.enabled).length ?? 0} />
        <KpiCard label="MRR estimate" value={`${org.currency} ${(subModules?.filter((m: any) => m.enabled).reduce((s: number, m: any) => s + Number(m.price_snapshot ?? 0), 0) ?? 0).toFixed(2)}`} />
      </div>

      <Tabs defaultValue="usage">
        <TabsList>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="modules">Modules & pricing</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="depots">Depots</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="events">Lifecycle</TabsTrigger>
        </TabsList>

        <TabsContent value="usage">
          <UsageMetricsTab
            organizationId={id!}
            enabledModules={(subModules ?? []).filter((m: any) => m.enabled).map((m: any) => m.module_code)}
          />
        </TabsContent>

        <TabsContent value="audit">
          <AuditFeedTab organizationId={id!} />
        </TabsContent>


        <TabsContent value="modules">
          <Card>
            <CardHeader><CardTitle>Modules catalog</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>List price</TableHead>
                    <TableHead>Org price</TableHead>
                    <TableHead>Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog?.map((m: any) => {
                    const price = modulePrice(m.code, Number(m.base_price ?? 0));
                    return (
                      <TableRow key={m.code}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{m.code}</TableCell>
                        <TableCell>{org.currency} {Number(m.base_price ?? 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Input
                            type="number" step="0.01" defaultValue={price} className="w-28"
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v) && v !== price) updatePrice(m.code, v);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={moduleEnabled(m.code)}
                            disabled={busy || m.code === "core"}
                            onCheckedChange={(checked) => toggleModule(m.code, checked, price)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members">
          <Card>
            <CardHeader><CardTitle>Members</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members?.map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.profiles?.display_name ?? m.user_id.slice(0, 8)}</TableCell>
                      <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                      <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge></TableCell>
                      <TableCell className="text-sm">{format(new Date(m.created_at), "PP")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="depots">
          <Card>
            <CardHeader><CardTitle>Depots</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Timezone</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depots?.map((d: any) => (
                    <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50"
                      onClick={() => window.location.assign(`/vendor/organizations/${id}/depots/${d.id}`)}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="font-mono text-xs">{d.code}</TableCell>
                      <TableCell>{d.currency}</TableCell>
                      <TableCell>{d.timezone}</TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardHeader><CardTitle>Lifecycle events</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events?.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm whitespace-nowrap">{format(new Date(e.created_at), "PPp")}</TableCell>
                      <TableCell><Badge variant="outline">{e.event_type}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground"><pre className="whitespace-pre-wrap">{JSON.stringify(e.details, null, 0)}</pre></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    trial: "secondary", active: "default", free: "outline",
    past_due: "destructive", suspended: "destructive", cancelled: "outline",
  };
  return <Badge variant={variant[status] ?? "outline"}>{status}</Badge>;
}
