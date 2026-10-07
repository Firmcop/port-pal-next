import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Plus, Upload, Copy, ExternalLink, Search } from "lucide-react";
import { formatDateTime } from "@/lib/format";

type Finding = {
  id: string;
  title: string;
  description: string | null;
  source: string;
  external_id: string | null;
  severity: "low" | "medium" | "high" | "critical";
  category: "rls" | "migration" | "config" | "code" | "dependency" | "other";
  status: "open" | "in_progress" | "fixed" | "ignored" | "wont_fix";
  affected_object: string | null;
  remediation_sql: string | null;
  remediation_notes: string | null;
  reference_url: string | null;
  detected_at: string;
  fixed_at: string | null;
  fixed_by: string | null;
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-black",
  low: "bg-slate-400 text-white",
};
const STATUS_COLOR: Record<string, string> = {
  open: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  fixed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  ignored: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  wont_fix: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

export default function VendorSecurityFindings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [active, setActive] = useState<Finding | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ["security-findings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("security_findings")
        .select("*")
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
  });

  const stats = useMemo(() => {
    const openBySev: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    let inProgress = 0, ignored = 0, fixedRecent = 0, totalOpen = 0;
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    for (const f of findings) {
      if (f.status === "open") { openBySev[f.severity] = (openBySev[f.severity] ?? 0) + 1; totalOpen++; }
      else if (f.status === "in_progress") inProgress++;
      else if (f.status === "ignored" || f.status === "wont_fix") ignored++;
      else if (f.status === "fixed" && f.fixed_at && new Date(f.fixed_at).getTime() >= cutoff) fixedRecent++;
    }
    return { openBySev, inProgress, ignored, fixedRecent, totalOpen };
  }, [findings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      if (sourceFilter !== "all" && f.source !== sourceFilter) return false;
      if (q) {
        const hay = `${f.title} ${f.description ?? ""} ${f.affected_object ?? ""} ${f.external_id ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [findings, search, severityFilter, statusFilter, sourceFilter]);

  const sources = useMemo(() => Array.from(new Set(findings.map((f) => f.source))), [findings]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Security Findings
          </h1>
          <p className="text-muted-foreground text-sm">
            Centralised scan results with remediation tracking. Findings persist across scans until marked fixed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Import JSON
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add finding
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {SEVERITY_ORDER.map((sev) => (
          <KpiCard key={sev} label={`Open ${sev}`} value={stats.openBySev[sev] ?? 0} accent={SEVERITY_COLOR[sev]} />
        ))}
        <KpiCard label="In progress" value={stats.inProgress} accent="bg-amber-500 text-white" />
        <KpiCard label="Fixed (30d)" value={stats.fixedRecent} accent="bg-emerald-600 text-white" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-base">All findings ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 w-56" />
            </div>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-32"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severity</SelectItem>
                {SEVERITY_ORDER.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
                <SelectItem value="wont_fix">Won't fix</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">No findings match these filters.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Affected</TableHead>
                  <TableHead>Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((f) => (
                  <TableRow key={f.id} className="cursor-pointer" onClick={() => setActive(f)}>
                    <TableCell><Badge className={SEVERITY_COLOR[f.severity]}>{f.severity}</Badge></TableCell>
                    <TableCell className="font-medium">{f.title}</TableCell>
                    <TableCell className="text-muted-foreground text-xs uppercase">{f.category}</TableCell>
                    <TableCell><Badge variant="secondary" className={STATUS_COLOR[f.status]}>{f.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{f.affected_object ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(f.detected_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <FindingDetailSheet finding={active} onClose={() => setActive(null)} />
      <AddFindingDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportFindingsDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-2xl font-bold">{value}</span>
          <span className={`h-2 w-2 rounded-full ${accent}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function FindingDetailSheet({ finding, onClose }: { finding: Finding | null; onClose: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: async (status: Finding["status"]) => {
      if (!finding) return;
      const patch: any = { status };
      if (status === "fixed") { patch.fixed_at = new Date().toISOString(); patch.fixed_by = user?.id ?? null; }
      else if (status === "open") { patch.fixed_at = null; patch.fixed_by = null; }
      const { error } = await (supabase as any).from("security_findings").update(patch).eq("id", finding.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Finding updated" });
      qc.invalidateQueries({ queryKey: ["security-findings"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  if (!finding) return null;
  return (
    <Sheet open={!!finding} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Badge className={SEVERITY_COLOR[finding.severity]}>{finding.severity}</Badge>
            <Badge variant="outline" className="uppercase text-xs">{finding.category}</Badge>
            <Badge variant="secondary" className={STATUS_COLOR[finding.status]}>{finding.status.replace("_", " ")}</Badge>
          </div>
          <SheetTitle className="text-left">{finding.title}</SheetTitle>
          <SheetDescription className="text-left">
            Source: <span className="font-mono">{finding.source}</span>
            {finding.external_id && <> · ID <span className="font-mono">{finding.external_id}</span></>}
            {finding.affected_object && <> · <span className="font-mono">{finding.affected_object}</span></>}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {finding.description && (
            <section>
              <h4 className="text-sm font-semibold mb-1">Description</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{finding.description}</p>
            </section>
          )}

          {finding.remediation_sql && (
            <section>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold">Remediation — policy / migration</h4>
                <Button size="sm" variant="outline" onClick={() => copy(finding.remediation_sql!)}>
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-96 font-mono whitespace-pre-wrap">{finding.remediation_sql}</pre>
            </section>
          )}

          {finding.remediation_notes && (
            <section>
              <h4 className="text-sm font-semibold mb-1">Notes</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{finding.remediation_notes}</p>
            </section>
          )}

          {finding.reference_url && (
            <a href={finding.reference_url} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-primary hover:underline">
              <ExternalLink className="h-3 w-3 mr-1" /> Reference documentation
            </a>
          )}

          <section className="text-xs text-muted-foreground space-y-1 border-t pt-3">
            <div>Detected: {formatDateTime(finding.detected_at)}</div>
            {finding.fixed_at && <div>Fixed: {formatDateTime(finding.fixed_at)}</div>}
          </section>

          <div className="flex flex-wrap gap-2 pt-3 border-t">
            {finding.status !== "in_progress" && <Button size="sm" variant="outline" onClick={() => updateStatus.mutate("in_progress")} disabled={updateStatus.isPending}>Mark in progress</Button>}
            {finding.status !== "fixed" && <Button size="sm" onClick={() => updateStatus.mutate("fixed")} disabled={updateStatus.isPending}>Mark fixed</Button>}
            {finding.status !== "ignored" && <Button size="sm" variant="outline" onClick={() => updateStatus.mutate("ignored")} disabled={updateStatus.isPending}>Ignore</Button>}
            {finding.status !== "wont_fix" && <Button size="sm" variant="outline" onClick={() => updateStatus.mutate("wont_fix")} disabled={updateStatus.isPending}>Won't fix</Button>}
            {finding.status !== "open" && <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate("open")} disabled={updateStatus.isPending}>Reopen</Button>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const EMPTY_FINDING = {
  title: "",
  description: "",
  source: "manual",
  external_id: "",
  severity: "medium",
  category: "other",
  status: "open",
  affected_object: "",
  remediation_sql: "",
  remediation_notes: "",
  reference_url: "",
};

function AddFindingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FINDING);
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: async () => {
      const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]));
      const { error } = await (supabase as any).from("security_findings").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Finding added" });
      qc.invalidateQueries({ queryKey: ["security-findings"] });
      setForm(EMPTY_FINDING);
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add security finding</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Title *</Label><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Severity</Label>
              <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITY_ORDER.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["rls", "migration", "config", "code", "dependency", "other"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Source</Label>
              <Input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="manual" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Affected object</Label><Input value={form.affected_object} onChange={(e) => set("affected_object", e.target.value)} placeholder="public.invoices" /></div>
            <div className="space-y-1"><Label>External ID</Label><Input value={form.external_id} onChange={(e) => set("external_id", e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="space-y-1"><Label>Remediation SQL / migration</Label><Textarea rows={6} className="font-mono text-xs" value={form.remediation_sql} onChange={(e) => set("remediation_sql", e.target.value)} placeholder={"CREATE POLICY ... ON public.table FOR SELECT USING (...);"} /></div>
          <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={form.remediation_notes} onChange={(e) => set("remediation_notes", e.target.value)} /></div>
          <div className="space-y-1"><Label>Reference URL</Label><Input value={form.reference_url} onChange={(e) => set("reference_url", e.target.value)} placeholder="https://supabase.com/docs/..." /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!form.title || create.isPending}>Add finding</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportFindingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const importMut = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const rows = arr.map((r: any) => ({
        title: String(r.title ?? r.name ?? "Untitled"),
        description: r.description ?? null,
        source: r.source ?? "import",
        external_id: r.external_id ?? r.id ?? null,
        severity: ["low", "medium", "high", "critical"].includes(r.severity) ? r.severity : "medium",
        category: ["rls", "migration", "config", "code", "dependency", "other"].includes(r.category) ? r.category : "other",
        status: ["open", "in_progress", "fixed", "ignored", "wont_fix"].includes(r.status) ? r.status : "open",
        affected_object: r.affected_object ?? r.target ?? null,
        remediation_sql: r.remediation_sql ?? r.fix ?? null,
        remediation_notes: r.remediation_notes ?? r.notes ?? null,
        reference_url: r.reference_url ?? r.url ?? null,
      }));
      const { error } = await (supabase as any).from("security_findings").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast({ title: `Imported ${n} findings` });
      qc.invalidateQueries({ queryKey: ["security-findings"] });
      setText("");
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Import findings</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Paste a JSON array of findings. Recognised fields: <span className="font-mono">title, description, source, external_id, severity, category, status, affected_object, remediation_sql, remediation_notes, reference_url</span>.
        </p>
        <Textarea rows={12} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder='[{ "title": "Missing RLS on public.notes", "severity": "high", "category": "rls", "remediation_sql": "ALTER TABLE..." }]' />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => importMut.mutate()} disabled={!text.trim() || importMut.isPending}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
