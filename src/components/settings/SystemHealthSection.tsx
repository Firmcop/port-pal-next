import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, Zap, RefreshCw, FileWarning, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";

export default function SystemHealthSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isOwnerOrAdmin } = useUserStaffRole();

  const { data: findings = [] } = useQuery({
    queryKey: ["sync-audit-findings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_audit_findings")
        .select("id, finding_code, severity, reference_type, reference_id, details, created_at, resolved_at")
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: queueStats } = useQuery({
    queryKey: ["push-queue-stats"],
    queryFn: async () => {
      const { data: pending } = await supabase
        .from("push_notification_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      const { data: sent } = await supabase
        .from("push_notification_queue")
        .select("id, sent_at", { count: "exact" })
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1);
      return {
        pending: (pending as any)?.length ?? 0,
        lastSent: (sent as any)?.[0]?.sent_at ?? null,
      };
    },
  });

  const { data: missingPostings = [] } = useQuery({
    queryKey: ["missing-postings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_missing_postings").select("reference_type, reference_id, amount, doc_date").limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const repair = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("repair_missing_postings");
      if (error) throw error;
      return data;
    },
    onSuccess: (counts: any) => {
      qc.invalidateQueries({ queryKey: ["missing-postings"] });
      toast({ title: "Repair complete", description: JSON.stringify(counts) });
    },
    onError: (e: any) => toast({ title: "Repair failed", description: e.message, variant: "destructive" }),
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sync_audit_findings")
        .update({ resolved_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync-audit-findings"] });
      toast({ title: "Finding marked resolved" });
    },
  });

  const missingByType: Record<string, number> = {};
  (missingPostings as any[]).forEach((m) => { missingByType[m.reference_type] = (missingByType[m.reference_type] ?? 0) + 1; });

  const sevColor = (s: string) =>
    s === "high" || s === "critical" ? "destructive" : s === "medium" ? "default" : "secondary";

  const grouped: Record<string, number> = {};
  findings.forEach((f: any) => { grouped[f.severity] = (grouped[f.severity] ?? 0) + 1; });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Open Sync Findings</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{findings.length}</div>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {Object.entries(grouped).map(([s, n]) => (
                <Badge key={s} variant={sevColor(s) as any} className="text-[10px]">{s}: {n}</Badge>
              ))}
              {!findings.length && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />all clear</span>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileWarning className="h-4 w-4" />Unposted to Ledger</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{(missingPostings as any[]).length}</div>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {Object.entries(missingByType).map(([t, n]) => (
                <Badge key={t} variant="secondary" className="text-[10px]">{t.replace("_"," ")}: {n}</Badge>
              ))}
              {!(missingPostings as any[]).length && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />all posted</span>}
            </div>
            {isOwnerOrAdmin && (missingPostings as any[]).length > 0 && (
              <Button size="sm" variant="outline" className="mt-2 h-7" disabled={repair.isPending} onClick={() => repair.mutate()}>
                <Wrench className="h-3 w-3 mr-1" />{repair.isPending ? "Repairing…" : "Repair now"}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4" />Push Queue</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{queueStats?.pending ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Pending · last sent {queueStats?.lastSent ? formatDistanceToNow(new Date(queueStats.lastSent), { addSuffix: true }) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Automations</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            <div className="flex items-center justify-between"><span>Invoice auto-post</span><Badge variant="default">on</Badge></div>
            <div className="flex items-center justify-between"><span>Payment auto-post</span><Badge variant="default">on</Badge></div>
            <div className="flex items-center justify-between"><span>Goods receipt auto-post</span><Badge variant="default">on</Badge></div>
            <div className="flex items-center justify-between"><span>Push cron (1 min)</span><Badge variant="default">on</Badge></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest Sync Findings</CardTitle>
          <CardDescription>Cross-module integrity warnings logged by the audit triggers.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!findings.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No open findings</TableCell></TableRow>
              ) : findings.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="text-xs">{formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}</TableCell>
                  <TableCell className="font-mono text-xs">{f.finding_code}</TableCell>
                  <TableCell><Badge variant={sevColor(f.severity) as any}>{f.severity}</Badge></TableCell>
                  <TableCell className="text-xs">{f.reference_type ?? "—"}{f.reference_id ? ` · ${String(f.reference_id).slice(0, 8)}` : ""}</TableCell>
                  <TableCell className="text-right">
                    {isOwnerOrAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => resolve.mutate(f.id)}>
                        <RefreshCw className="h-3 w-3 mr-1" />Resolve
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
