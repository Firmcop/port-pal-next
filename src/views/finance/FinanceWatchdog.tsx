import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatMoneyCode } from "@/lib/money";
import { exportCSV } from "@/lib/export-utils";
import {
  ShieldAlert, RefreshCw, FileDown, AlertTriangle, CheckCircle2, EyeOff,
  Play, Sparkles, ExternalLink,
} from "lucide-react";

type Finding = {
  id: string;
  finding_type: string;
  severity: string;
  entity_table: string | null;
  entity_id: string | null;
  entity_label: string | null;
  title: string;
  details: Record<string, any>;
  amount: number | null;
  currency: string | null;
  explanation: string | null;
  suggested_action: string | null;
  status: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  review_note: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  missing_acquisition_invoice: "Missing acquisition invoice",
  fx_rate_missing: "Missing FX rate",
  conversion_cost_drift: "Conversion cost drift",
  duplicate_supplier_invoice: "Duplicate supplier invoice",
  sale_below_cost: "Sale below cost",
  sale_not_invoiced: "Sold but not invoiced",
  transport_order_uninvoiced: "Transport order uninvoiced",
  payroll_week_unbalanced: "Payroll week unbalanced",
};

const ENTITY_LINK: Record<string, (f: Finding) => string | null> = {
  containers: () => "/inventory",
  supplier_invoices: () => "/finance/supplier-invoices",
  container_conversions: (f) => (f.entity_id ? `/conversions/${f.entity_id}` : "/conversions"),
  container_sales: () => "/sales",
  logistics_transport_orders: () => "/logistics/orders",
  attendance_weeks: () => "/hrm/wage-reconciliation",
};

function severityBadge(sev: string) {
  if (sev === "critical") return <Badge variant="destructive">Critical</Badge>;
  if (sev === "warning") return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">Warning</Badge>;
  return <Badge variant="secondary">Info</Badge>;
}

function statusBadge(status: string) {
  if (status === "open") return <Badge variant="outline">Open</Badge>;
  if (status === "acknowledged") return <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30">Acknowledged</Badge>;
  if (status === "resolved") return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Resolved</Badge>;
  return <Badge variant="secondary">Ignored</Badge>;
}

export default function FinanceWatchdog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: findings, isFetching } = useQuery({
    queryKey: ["ai-findings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_findings")
        .select("*")
        .eq("job", "finance_watchdog")
        .order("severity", { ascending: true })
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
  });

  const { data: jobState } = useQuery({
    queryKey: ["ai-job-state", "finance_watchdog"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ai_job_state")
        .select("*")
        .eq("job", "finance_watchdog")
        .maybeSingle();
      return data as any;
    },
  });

  const scan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("finance-watchdog-scan", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const r = data?.results?.[0] ?? {};
      qc.invalidateQueries({ queryKey: ["ai-findings"] });
      qc.invalidateQueries({ queryKey: ["ai-job-state", "finance_watchdog"] });
      if (r.paused) {
        toast({ title: "Watchdog paused", description: "AI is blocked — see the banner for details.", variant: "destructive" });
      } else {
        toast({ title: "Scan complete", description: `${r.detected ?? 0} issues detected, ${r.new ?? 0} new, ${r.cleared ?? 0} auto-cleared.` });
      }
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  const review = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note?: string }) => {
      const { error } = await (supabase as any).rpc("review_ai_finding", { _finding_id: id, _status: status, _note: note ?? null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-findings"] });
      toast({ title: "Finding updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resume = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("ai_job_resume", { _job: "finance_watchdog" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-job-state", "finance_watchdog"] });
      toast({ title: "Watchdog resumed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const all = findings ?? [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((f) => {
      if (statusFilter === "active" && !["open", "acknowledged"].includes(f.status)) return false;
      if (statusFilter !== "active" && statusFilter !== "all" && f.status !== statusFilter) return false;
      if (typeFilter !== "all" && f.finding_type !== typeFilter) return false;
      if (!q) return true;
      return `${f.title} ${f.entity_label ?? ""} ${f.explanation ?? ""}`.toLowerCase().includes(q);
    });
  }, [all, search, statusFilter, typeFilter]);

  const openRows = all.filter((f) => ["open", "acknowledged"].includes(f.status));
  const criticalCount = openRows.filter((f) => f.severity === "critical").length;
  const warningCount = openRows.filter((f) => f.severity === "warning").length;
  const types = Array.from(new Set(all.map((f) => f.finding_type)));

  const handleExport = () => {
    exportCSV(
      "finance-watchdog-findings.csv",
      ["Type", "Severity", "Record", "Title", "Amount", "Currency", "Explanation", "Suggested action", "Status", "First seen", "Last seen"],
      rows.map((f) => [
        TYPE_LABELS[f.finding_type] ?? f.finding_type,
        f.severity,
        f.entity_label ?? "",
        f.title,
        f.amount != null ? String(f.amount) : "",
        f.currency ?? "",
        f.explanation ?? "",
        f.suggested_action ?? "",
        f.status,
        f.first_seen_at,
        f.last_seen_at,
      ]),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" />Finance Watchdog
          </h1>
          <p className="text-muted-foreground">
            AI-reviewed finance anomalies. Nothing is posted automatically — every finding is a proposal for you to act on.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!rows.length}>
            <FileDown className="h-4 w-4 mr-2" />Export CSV
          </Button>
          <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
            {scan.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run scan now
          </Button>
        </div>
      </div>

      {jobState?.paused && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Watchdog paused</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{jobState.pause_reason ?? "The scheduled scan is paused."}</span>
            <Button size="sm" variant="outline" onClick={() => resume.mutate()} disabled={resume.isPending}>Resume</Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Open critical</CardDescription></CardHeader>
          <CardContent><div className="text-3xl font-bold text-destructive">{criticalCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Open warnings</CardDescription></CardHeader>
          <CardContent><div className="text-3xl font-bold text-amber-600">{warningCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Last scan</CardDescription></CardHeader>
          <CardContent>
            <div className="text-sm">
              {jobState?.last_run_at ? new Date(jobState.last_run_at).toLocaleString() : "Never run"}
            </div>
            {jobState?.last_error && <div className="text-xs text-destructive mt-1">{jobState.last_error}</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle>Findings ({rows.length})</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Search findings…" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Open & acknowledged</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-56">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((f) => {
                const link = f.entity_table ? ENTITY_LINK[f.entity_table]?.(f) : null;
                return (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-md">
                      <div className="font-medium flex items-center gap-2">
                        {f.entity_label ?? f.title}
                        {link && (
                          <Link to={link} className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{f.title}</div>
                      {f.explanation && (
                        <div className="text-xs mt-1 flex gap-1.5">
                          <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                          <span>
                            {f.explanation}
                            {f.suggested_action && <em className="block text-muted-foreground mt-0.5">{f.suggested_action}</em>}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">{TYPE_LABELS[f.finding_type] ?? f.finding_type}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {f.amount != null ? formatMoneyCode(Number(f.amount), f.currency ?? undefined) : "—"}
                    </TableCell>
                    <TableCell>{severityBadge(f.severity)}</TableCell>
                    <TableCell>{statusBadge(f.status)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {f.status !== "acknowledged" && f.status !== "resolved" && (
                          <Button size="sm" variant="outline" onClick={() => review.mutate({ id: f.id, status: "acknowledged" })}>
                            Ack
                          </Button>
                        )}
                        {f.status !== "resolved" && (
                          <Button size="sm" variant="outline" onClick={() => review.mutate({ id: f.id, status: "resolved", note: "Marked resolved by user" })}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />Resolve
                          </Button>
                        )}
                        {f.status !== "ignored" && (
                          <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: f.id, status: "ignored", note: "Ignored by user" })}>
                            <EyeOff className="h-3 w-3 mr-1" />Ignore
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    {isFetching ? "Loading…" : "No findings for this filter. Run a scan to check now."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
