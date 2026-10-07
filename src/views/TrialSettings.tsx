import { useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { differenceInCalendarDays, format } from "date-fns";
import { Calendar, Sparkles, RefreshCw, ArrowRight, Users, History } from "lucide-react";
import { toast } from "sonner";
import UserRolesSection from "@/components/settings/UserRolesSection";
import AccountSecurityCard from "@/components/settings/AccountSecurityCard";

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  trial: "default",
  active: "default",
  free: "secondary",
  past_due: "destructive",
  suspended: "destructive",
  cancelled: "destructive",
};

export default function TrialSettings() {
  const org = useOrganization();
  const { isOrgOwner } = useUserStaffRole();
  const qc = useQueryClient();

  const { data: orgRow } = useQuery({
    queryKey: ["org-trial", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, status, trial_ends_at, created_at")
        .eq("id", org.organizationId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: members } = useQuery({
    queryKey: ["org-members", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data: m } = await supabase
        .from("organization_members")
        .select("id, user_id, role, status, created_at")
        .eq("organization_id", org.organizationId!)
        .order("created_at", { ascending: true });
      const ids = (m ?? []).map((x: any) => x.user_id);
      const { data: p } = ids.length
        ? await supabase.from("profiles").select("user_id, display_name").in("user_id", ids)
        : { data: [] as any[] };
      const byId = new Map((p ?? []).map((x: any) => [x.user_id, x.display_name]));
      return (m ?? []).map((x: any) => ({ ...x, name: byId.get(x.user_id) ?? "Unknown" }));
    },
  });

  const { data: events } = useQuery({
    queryKey: ["org-events-recent", org.organizationId],
    enabled: !!org.organizationId,
    queryFn: async () => {
      const { data } = await supabase
        .from("org_lifecycle_events")
        .select("event_type, created_at, details")
        .eq("organization_id", org.organizationId!)
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const { trialDays, trialPct } = useMemo(() => {
    if (!orgRow?.trial_ends_at) return { trialDays: null as number | null, trialPct: 0 };
    const days = differenceInCalendarDays(new Date(orgRow.trial_ends_at), new Date());
    const pct = Math.max(0, Math.min(100, (days / 14) * 100));
    return { trialDays: days, trialPct: pct };
  }, [orgRow]);

  const extend = useMutation({
    mutationFn: async (days: number) => {
      const { error } = await supabase.rpc("extend_trial", { _org_id: org.organizationId!, _days: days });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Trial extended"); qc.invalidateQueries({ queryKey: ["org-trial"] }); qc.invalidateQueries({ queryKey: ["org-events-recent"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const restart = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("restart_trial", { _org_id: org.organizationId! });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Trial restarted"); qc.invalidateQueries({ queryKey: ["org-trial"] }); qc.invalidateQueries({ queryKey: ["org-events-recent"] }); },
    onError: (e: any) => toast.error(e.message === "already_restarted" ? "Trial can only be restarted once. Contact support for further extensions." : e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ memberId, status }: { memberId: string; status: string }) => {
      const { error } = await supabase.rpc("set_member_status", { _member_id: memberId, _status: status });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(`Member ${v.status === "removed" ? "removed" : v.status}`); qc.invalidateQueries({ queryKey: ["org-members"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (org.loading || !orgRow) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trial & access</h1>
        <p className="text-muted-foreground">Manage your trial, teammates, and recent activity for {orgRow.name}.</p>
      </div>

      {/* Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Trial status</CardTitle>
              <CardDescription>Track and manage your trial.</CardDescription>
            </div>
            <Badge variant={STATUS_TONE[orgRow.status] ?? "outline"} className="capitalize">{orgRow.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgRow.trial_ends_at && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Ends {format(new Date(orgRow.trial_ends_at), "PP")}</span>
                <span className={trialDays! < 0 ? "text-destructive font-medium" : "font-medium"}>
                  {trialDays! < 0 ? `Expired ${Math.abs(trialDays!)}d ago` : `${trialDays} day${trialDays === 1 ? "" : "s"} left`}
                </span>
              </div>
              <Progress value={trialPct} />
            </>
          )}

          {isOrgOwner && (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => extend.mutate(7)} disabled={extend.isPending}>+7 days</Button>
              <Button size="sm" variant="outline" onClick={() => extend.mutate(14)} disabled={extend.isPending}>+14 days</Button>
              <Button size="sm" variant="outline" onClick={() => extend.mutate(30)} disabled={extend.isPending}>+30 days</Button>
              <Button size="sm" variant="outline" onClick={() => restart.mutate()} disabled={restart.isPending}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Restart trial
              </Button>
              <Link to="/settings/subscription">
                <Button size="sm">
                  Activate full account <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Team access</CardTitle>
          <CardDescription>Suspend, reactivate, or remove members. Use the Users & Roles panel below to invite new teammates.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Org role</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(members ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{String(m.role).replace("_", " ")}</Badge></TableCell>
                  <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"} className="capitalize">{m.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    {m.role !== "org_owner" && isOrgOwner && (
                      <>
                        {m.status === "active" ? (
                          <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ memberId: m.id, status: "suspended" })}>Suspend</Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ memberId: m.id, status: "active" })}>Reactivate</Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-destructive" disabled={setStatus.isPending} onClick={() => { if (confirm("Remove this member from the organization?")) setStatus.mutate({ memberId: m.id, status: "removed" }); }}>Remove</Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AccountSecurityCard />
      <UserRolesSection />

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Recent activity</CardTitle>
              <CardDescription>Latest changes in this organization.</CardDescription>
            </div>
            <Link to="/settings/audit-log" className="text-sm text-primary hover:underline">View full audit log →</Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {!events?.length ? (
            <p className="text-sm text-muted-foreground">No recent events.</p>
          ) : events.map((e: any, i: number) => (
            <div key={i} className="text-sm flex justify-between border-b last:border-b-0 pb-2 last:pb-0">
              <span className="capitalize">{String(e.event_type).replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">{format(new Date(e.created_at), "PPp")}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
