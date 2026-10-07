/**
 * Extra tabs and widgets for the Conversion Detail page:
 *  - VarianceTab        per-job material planned vs actual + cost delta + stock impact
 *  - OutputsTab         split children / finished products / sub-assembly lots with allocated cost + audit
 *  - SubAssembliesTab   add / issue / return sub-assemblies for the job
 *  - TimelineTab        merged event feed for the job
 *  - MaterialActions    Issue / Return buttons used inside the Materials table
 *  - IssueReturnDialog  shared dialog with reason codes
 *  - OrgVarianceWidget  small KPI block for /conversions list header
 */
import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Box, Layers,
  Package, Plus, RotateCcw, ChevronDown, Activity, GitFork, Wrench, CheckCircle2,
  Trash2, Info, Pencil,
} from "lucide-react";
import { CONTAINER_CATEGORIES, CATEGORY_LABELS, requiresHeightClass, HEIGHT_CLASSES } from "@/lib/container-constants";
import { useToast } from "@/hooks/use-toast";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { recomputeSplitOutputCosts } from "@/lib/conversion-cost-sync";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend,
} from "recharts";

const fmt = (n: any) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
const intf = (n: any) => Number(n || 0).toLocaleString();
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/* ─────────────────────────── Issue / Return dialog ─────────────────────────── */

const REASON_CODES = [
  { value: "production_use", label: "Production use" },
  { value: "rework", label: "Rework" },
  { value: "replacement", label: "Replacement" },
  { value: "damage", label: "Damage / Scrap" },
  { value: "other", label: "Other" },
];

export function IssueReturnDialog({
  open, onOpenChange, mode, title, max, onSubmit, jobRef,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "issue" | "return";
  title: string;
  max?: number;
  onSubmit: (qty: number, reason: string, note: string) => Promise<void> | void;
  jobRef?: string | null;
}) {
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("production_use");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(parseFloat(qty) || 0, reason, note);
      setQty("1"); setReason("production_use"); setNote("");
      onOpenChange(false);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {jobRef && (
              <span className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                {jobRef}
              </span>
            )}
            <span>{mode === "issue" ? "Issue" : "Return"} — {title}</span>
          </DialogTitle>
          {jobRef && (
            <p className="text-xs text-muted-foreground">
              Conversion job <span className="font-mono font-semibold text-foreground">{jobRef}</span>
            </p>
          )}
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Quantity {max != null && <span className="text-muted-foreground">(max {max})</span>}</Label>
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min="0" step="0.01" />
          </div>
          <div>
            <Label className="text-xs">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASON_CODES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="h-16" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !(parseFloat(qty) > 0)}>
            {mode === "issue" ? <ArrowUpFromLine className="mr-1 h-4 w-4" /> : <ArrowDownToLine className="mr-1 h-4 w-4" />}
            Confirm {mode}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Material Actions (in Materials table) ─────────────────────────── */

export function MaterialActions({ conversionId, materialId, label, onDone, jobRef }: {
  conversionId: string;
  materialId: string | null;
  label: string;
  onDone: () => void;
  jobRef?: string | null;
}) {
  const { toast } = useToast();
  const [issueOpen, setIssueOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  if (!materialId) {
    return <span className="text-xs text-muted-foreground">No catalog item</span>;
  }

  const handle = async (mode: "issue" | "return", qty: number, reason: string, note: string) => {
    const fn = mode === "issue" ? "issue_material_to_job" : "return_material_from_job";
    const { error } = await supabase.rpc(fn as any, {
      _conversion_id: conversionId,
      _material_id: materialId,
      _qty: qty,
      _reason: reason || null,
      _note: note || null,
      ...(mode === "issue" ? { _allow_negative: false } : {}),
    });
    if (error) {
      const msg = error.message.includes("insufficient_stock")
        ? error.message.replace(/^.*insufficient_stock:\s*/, "Not enough stock — ")
        : error.message.includes("return_exceeds_issued")
          ? error.message.replace(/^.*return_exceeds_issued:\s*/, "Cannot return more than issued — ")
          : error.message;
      toast({ title: mode === "issue" ? "Cannot issue" : "Cannot return", description: msg, variant: "destructive" });
      return;
    }
    toast({ title: mode === "issue" ? "Material issued" : "Material returned" });
    onDone();
  };

  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" onClick={() => setIssueOpen(true)}>
        <ArrowUpFromLine className="h-3 w-3" />
      </Button>
      <Button size="sm" variant="outline" onClick={() => setReturnOpen(true)}>
        <ArrowDownToLine className="h-3 w-3" />
      </Button>
      <IssueReturnDialog open={issueOpen} onOpenChange={setIssueOpen} mode="issue" title={label} jobRef={jobRef}
        onSubmit={(q, r, n) => handle("issue", q, r, n)} />
      <IssueReturnDialog open={returnOpen} onOpenChange={setReturnOpen} mode="return" title={label} jobRef={jobRef}
        onSubmit={(q, r, n) => handle("return", q, r, n)} />
    </div>
  );
}

/* ─────────────────────────── Variance Tab ─────────────────────────── */

export function VarianceTab({ conversionId, materials }: { conversionId: string; materials: any[] }) {
  const { data: catalog = [] } = useQuery({
    queryKey: ["materials-catalog-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("id, name, unit, on_hand_qty, reorder_point, avg_unit_cost");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["material-movements", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("material_movements" as any)
        .select("*").eq("conversion_id", conversionId).order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  const rows = useMemo(() => materials.map((m: any) => {
    const cat = catalog.find((c: any) => c.id === m.material_id);
    const planned = Number(m.qty_planned ?? 0);
    const used = Number(m.qty_used ?? 0);
    const unit = Number(m.unit_cost ?? 0);
    const dQty = used - planned;
    const dPct = planned > 0 ? (dQty / planned) * 100 : 0;
    const plannedCost = planned * unit;
    const actualCost = used * unit;
    const dCost = actualCost - plannedCost;
    const onHand = cat ? Number(cat.on_hand_qty ?? 0) : null;
    const reorder = cat ? Number(cat.reorder_point ?? 0) : 0;
    return { id: m.id, label: m.description, uom: cat?.unit ?? "—", planned, used, dQty, dPct,
             unit, plannedCost, actualCost, dCost, onHand, reorder };
  }), [materials, catalog]);

  const totals = rows.reduce((a, r) => ({
    planned: a.planned + r.plannedCost,
    actual: a.actual + r.actualCost,
    delta: a.delta + r.dCost,
  }), { planned: 0, actual: 0, delta: 0 });
  const eff = totals.planned > 0 ? (totals.planned / Math.max(totals.actual, 0.0001)) * 100 : 100;

  const chartData = rows.map((r) => ({ name: r.label.slice(0, 16), Planned: r.planned, Actual: r.used }));

  const movementSeries = useMemo(() => {
    let cum = 0;
    return movements.map((m: any) => {
      const cost = Number(m.qty) * Number(m.unit_cost);
      cum += cost;
      return { t: format(new Date(m.created_at), "dd MMM HH:mm"), Cost: cum };
    });
  }, [movements]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Planned cost" value={fmt(totals.planned)} />
        <Kpi label="Actual cost" value={fmt(totals.actual)} />
        <Kpi label="Net variance" value={fmt(totals.delta)} tone={totals.delta > 0 ? "destructive" : "success"} />
        <Kpi label="Material efficiency" value={`${eff.toFixed(1)}%`} tone={eff >= 90 ? "success" : "warning"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Per-material variance</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Δ Qty</TableHead>
                <TableHead className="text-right">% Var</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Planned $</TableHead>
                <TableHead className="text-right">Actual $</TableHead>
                <TableHead className="text-right">Δ Cost</TableHead>
                <TableHead className="text-right">Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows.length ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">No materials in BOM</TableCell></TableRow>
              ) : rows.map((r) => {
                const sev = Math.abs(r.dPct) >= 25 ? "destructive" : Math.abs(r.dPct) >= 10 ? "warning" : null;
                return (
                  <TableRow key={r.id} className={sev === "destructive" ? "bg-destructive/5" : sev === "warning" ? "bg-warning/5" : ""}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-muted-foreground">{r.uom}</TableCell>
                    <TableCell className="text-right font-mono">{intf(r.planned)}</TableCell>
                    <TableCell className="text-right font-mono">{intf(r.used)}</TableCell>
                    <TableCell className={`text-right font-mono ${r.dQty > 0 ? "text-destructive" : r.dQty < 0 ? "text-success" : ""}`}>{r.dQty > 0 ? "+" : ""}{intf(r.dQty)}</TableCell>
                    <TableCell className={`text-right font-mono ${sev === "destructive" ? "text-destructive font-semibold" : sev === "warning" ? "text-warning" : "text-muted-foreground"}`}>{r.planned > 0 ? pct(r.dPct) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.unit)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.plannedCost)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(r.actualCost)}</TableCell>
                    <TableCell className={`text-right font-mono ${r.dCost > 0 ? "text-destructive" : r.dCost < 0 ? "text-success" : ""}`}>{fmt(r.dCost)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.onHand == null ? "—" : (
                        <span className={r.onHand <= r.reorder ? "text-destructive font-semibold" : ""}>
                          {intf(r.onHand)}{r.onHand <= r.reorder ? " ⚠️" : ""}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Planned vs Actual qty</CardTitle></CardHeader>
          <CardContent style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Planned" fill="hsl(var(--primary))" />
                <Bar dataKey="Actual" fill="hsl(var(--warning))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Cumulative material cost (movements)</CardTitle></CardHeader>
          <CardContent style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={movementSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="t" fontSize={10} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="Cost" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "destructive" }) {
  const cls = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : "";
  return (
    <Card><CardContent className="p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold font-mono ${cls}`}>{value}</p>
    </CardContent></Card>
  );
}

/* ─────────────────────────── Outputs Tab ─────────────────────────── */

export function OutputsTab({ job }: { job: any }) {
  const conversionId = job.id;
  const { data: outputs = [] } = useQuery({
    queryKey: ["conversion-outputs", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_outputs" as any).select("*").eq("conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: children = [] } = useQuery({
    queryKey: ["child-containers", job.container_id],
    enabled: !!job.container_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("containers")
        .select("id, container_number, size, category, height_class, status, acquisition_cost, notes, created_at")
        .eq("parent_container_id", job.container_id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["job-finished-products", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("finished_products" as any)
        .select("*").eq("source_conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: lots = [] } = useQuery({
    queryKey: ["job-sa-lots", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_lots" as any)
        .select("*, sub_assembly_stock:assembly_stock_id(name, uom, on_hand_qty)")
        .eq("conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["conversion-output-costs", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_output_costs" as any)
        .select("*").eq("conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });

  const costFor = (kind: string, id: string) => costs.find((c: any) => c.output_kind === kind && c.output_id === id);

  const kind = job.job_kind ?? "product";

  return (
    <div className="space-y-4">
      {kind === "split" && (
        <>
          <PlannedOutputsEditor job={job} outputs={outputs} children={children} />

          <SplitCostShareCard job={job} children={children} costs={costs} />



          <div className="grid gap-3 md:grid-cols-2">
            {children.map((c: any) => (
              <OutputCard
                key={c.id}
                title={c.container_number}
                subtitle={`${c.size}' ${c.category}${c.height_class ? " · " + c.height_class : ""} · owned by depot`}
                status={c.status}
                totalCost={Number(c.acquisition_cost ?? 0)}
                createdAt={c.created_at}
                cost={costFor("container", c.id)}
                link={`/inventory?focus=${c.container_number}`}
                actions={<ChildContainerActions container={c} job={job} />}
              />
            ))}
            {!children.length && <p className="text-sm text-muted-foreground col-span-full">No child containers created yet (run job completion).</p>}
          </div>

          <OutputChangeHistory jobId={conversionId} />
        </>
      )}

      {kind === "product" && (
        <div className="grid gap-3 md:grid-cols-2">
          {products.map((p: any) => (
            <OutputCard
              key={p.id}
              title={p.product_number}
              subtitle={String(p.product_type ?? "").replace("_"," ")}
              status={p.status}
              totalCost={Number(p.total_cost ?? 0)}
              createdAt={p.created_at}
              cost={costFor("finished_product", p.id)}
              link={`/finished-products`}
            />
          ))}
          {!products.length && <p className="text-sm text-muted-foreground col-span-full">No finished products yet (run job completion).</p>}
        </div>
      )}

      {kind === "sub_assembly" && (
        <div className="grid gap-3 md:grid-cols-2">
          {lots.map((l: any) => (
            <OutputCard
              key={l.id}
              title={`${l.sub_assembly_stock?.name ?? "Lot"} × ${intf(l.qty)}`}
              subtitle={`${l.sub_assembly_stock?.uom ?? ""} · on-hand ${intf(l.sub_assembly_stock?.on_hand_qty)}`}
              status={"in_stock"}
              totalCost={Number(l.qty) * Number(l.unit_cost)}
              createdAt={l.created_at}
              cost={costFor("sub_assembly_lot", l.id)}
              link="/sub-assembly-stock"
            />
          ))}
          {!lots.length && <p className="text-sm text-muted-foreground col-span-full">No lots produced yet (run job completion).</p>}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Planned Outputs Editor ─────────────────────────── */

const SPLIT_SIZES = ["10", "20", "30", "40", "45"] as const;

/** Shared dialog that captures a mandatory reason before a destructive action. */
function ReasonDialog({
  open, onOpenChange, title, description, confirmLabel, destructive, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 5;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setReason(""); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Label className="text-xs">Reason <span className="text-muted-foreground">(required, min 5 characters)</span></Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="h-20" placeholder="Why is this change being made?" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(reason.trim()); setReason(""); onOpenChange(false); }
              finally { setBusy(false); }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlannedOutputsEditor({ job, outputs, children: childContainers = [] }: { job: any; outputs: any[]; children?: any[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const locked = job.status === "completed" || job.status === "cancelled";
  const editable = !locked || isOwnerOrAdmin;

  const { data: org } = useQuery({
    queryKey: ["org-prefix", job.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("name, container_prefix")
        .eq("id", job.organization_id)
        .maybeSingle();
      if (error) throw error;
      return data as { name: string; container_prefix: string | null } | null;
    },
  });

  const [size, setSize] = useState<typeof SPLIT_SIZES[number]>("20");
  const [category, setCategory] = useState<string>("dry");
  const [heightClass, setHeightClass] = useState<string>("HC");
  const [count, setCount] = useState<string>("1");

  const [editRow, setEditRow] = useState<any | null>(null);
  const [form, setForm] = useState({ size: "20", category: "dry", height: "HC", count: "1", owner: "", notes: "", reason: "" });
  const [delRow, setDelRow] = useState<any | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["conversion-outputs", job.id] });
    qc.invalidateQueries({ queryKey: ["conversion-output-costs", job.id] });
    qc.invalidateQueries({ queryKey: ["child-containers", job.container_id] });
    qc.invalidateQueries({ queryKey: ["conversion-output-audit", job.id] });
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const n = parseInt(count) || 0;
      if (n < 1 || n > 50) throw new Error("Count must be between 1 and 50");
      const payload: any = {
        conversion_id: job.id,
        size,
        category,
        planned_count: n,
        organization_id: job.organization_id,
      };
      if (requiresHeightClass(category)) payload.height_class = heightClass;
      const { error } = await supabase.from("conversion_outputs" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "Planned output added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    onSettled: () => { setCount("1"); },
  });

  const updMut = useMutation({
    mutationFn: async () => {
      const n = parseInt(form.count) || 0;
      const { error } = await supabase.rpc("update_conversion_output" as any, {
        _id: editRow.id,
        _size: form.size,
        _category: form.category,
        _height_class: requiresHeightClass(form.category) ? form.height : null,
        _planned_count: n,
        _target_owner: form.owner || null,
        _notes: form.notes || null,
        _reason: form.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setEditRow(null); toast({ title: "Planned output updated" }); },
    onError: (e: any) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async (vars: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("delete_conversion_output" as any, { _id: vars.id, _reason: vars.reason });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "Planned output removed" }); },
    onError: (e: any) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const prefix = (org?.container_prefix || "DPT").toUpperCase();
  const totalPlanned = outputs.reduce((s, o) => s + Number(o.planned_count || 0), 0);

  // Group existing children by spec for status calculation
  const createdByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of childContainers) {
      const k = `${c.size}|${c.category}|${c.height_class ?? ""}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [childContainers]);

  const noOutputs = outputs.length === 0;
  const dryMissingHc = outputs.some((o) => o.category === "dry" && !o.height_class);

  const openEdit = (o: any) => {
    setForm({
      size: String(o.size),
      category: String(o.category),
      height: o.height_class ?? "HC",
      count: String(o.planned_count ?? 1),
      owner: o.target_owner ?? "",
      notes: o.notes ?? "",
      reason: "",
    });
    setEditRow(o);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><GitFork className="h-4 w-4" />Planned outputs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-3 text-xs flex gap-2">
          <Info className="h-4 w-4 mt-0.5 text-info shrink-0" />
          <div>
            On completion, each child container is auto-numbered like <span className="font-mono font-semibold">{prefix}U000123</span> and registered to <strong>{org?.name ?? "your depot"}</strong>. Children become <strong>available</strong> stock — usable in another conversion, or sold / leased.
          </div>
        </div>

        {locked && isOwnerOrAdmin && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
            <div>This job is <strong>{job.status}</strong>. As an admin you can still edit outputs — every change needs a reason and is recorded in the change history.</div>
          </div>
        )}
        {!locked && noOutputs && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div><strong>Required:</strong> add at least one planned output below before this split job can be completed.</div>
          </div>
        )}
        {!locked && dryMissingHc && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
            <div>One or more dry rows are missing a height class (HC/LC). Fix them before completion.</div>
          </div>
        )}

        {!locked && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Size</Label>
              <Select value={size} onValueChange={(v) => setSize(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SPLIT_SIZES.map((s) => <SelectItem key={s} value={s}>{s}'</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v); if (!requiresHeightClass(v)) setHeightClass("HC"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONTAINER_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Height</Label>
              <Select value={heightClass} onValueChange={setHeightClass} disabled={!requiresHeightClass(category)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Count <span className="text-muted-foreground">(1–50)</span></Label>
              <Input type="number" min="1" max="50" value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}><Plus className="h-4 w-4 mr-1" />Add</Button>
          </div>
        )}

        <Table>
          <TableHeader><TableRow>
            <TableHead>Size</TableHead><TableHead>Category</TableHead><TableHead>Height</TableHead>
            <TableHead className="text-right">Planned</TableHead>
            <TableHead className="text-right">Created</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!outputs.length ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-4">No planned outputs yet — add one above.</TableCell></TableRow>
              : outputs.map((o) => {
                const k = `${o.size}|${o.category}|${o.height_class ?? ""}`;
                const created = createdByKey.get(k) ?? 0;
                const planned = Number(o.planned_count || 0);
                const missingHc = o.category === "dry" && !o.height_class;
                let statusBadge: { label: string; cls: string };
                if (created >= planned && planned > 0) statusBadge = { label: "fulfilled", cls: "bg-success/15 text-success" };
                else if (created > 0) statusBadge = { label: `partial ${created}/${planned}`, cls: "bg-warning/15 text-warning" };
                else statusBadge = { label: "pending", cls: "bg-muted text-muted-foreground" };
                return (
                  <TableRow key={o.id} className={missingHc ? "bg-destructive/5" : ""}>
                    <TableCell>{o.size}'</TableCell>
                    <TableCell className="capitalize">{o.category}</TableCell>
                    <TableCell>
                      {o.height_class ?? "—"}
                      {missingHc && <Badge variant="destructive" className="ml-2 text-[10px]">Required</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{planned}</TableCell>
                    <TableCell className="text-right font-mono">{created}</TableCell>
                    <TableCell><Badge variant="secondary" className={statusBadge.cls}>{statusBadge.label}</Badge></TableCell>
                    <TableCell className="text-xs">{o.target_owner ?? org?.name ?? "Depot"}</TableCell>
                    <TableCell className="flex gap-1">
                      {editable && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(o)}>
                          <Pencil className="h-3 w-3 mr-1" />Edit
                        </Button>
                      )}
                      {editable && created === 0 && (
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setDelRow(o)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
        {!!totalPlanned && <p className="text-xs text-muted-foreground">Total children to be created on completion: <strong>{totalPlanned}</strong></p>}

        <Dialog open={!!editRow} onOpenChange={(v) => { if (!v) setEditRow(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Edit planned output</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-1">
              <div className="space-y-1">
                <Label className="text-xs">Size</Label>
                <Select value={form.size} onValueChange={(v) => setForm((f) => ({ ...f, size: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SPLIT_SIZES.map((s) => <SelectItem key={s} value={s}>{s}'</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTAINER_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Height</Label>
                <Select value={form.height} onValueChange={(v) => setForm((f) => ({ ...f, height: v }))} disabled={!requiresHeightClass(form.category)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Planned count</Label>
                <Input type="number" min="1" max="50" value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Target owner (optional)</Label>
                <Input value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} placeholder={org?.name ?? "Depot"} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="h-16" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Reason for change <span className="text-muted-foreground">(required)</span></Label>
                <Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="h-16" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
              <Button onClick={() => updMut.mutate()} disabled={updMut.isPending || form.reason.trim().length < 5}>Save changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ReasonDialog
          open={!!delRow}
          onOpenChange={(v) => { if (!v) setDelRow(null); }}
          title="Remove planned output"
          description={delRow ? `${delRow.size}' ${delRow.category} × ${delRow.planned_count}` : undefined}
          confirmLabel="Remove"
          destructive
          onConfirm={async (reason) => { await delMut.mutateAsync({ id: delRow.id, reason }); setDelRow(null); }}
        />
      </CardContent>
    </Card>
  );
}

/* ───────────────────── Child container actions (admin) ───────────────────── */

function ChildContainerActions({ container, job }: { container: any; job: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [form, setForm] = useState({
    size: String(container.size),
    category: String(container.category),
    height: container.height_class ?? "HC",
    notes: container.notes ?? "",
    reason: "",
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["child-containers", job.container_id] });
    qc.invalidateQueries({ queryKey: ["conversion-output-audit", job.id] });
  };

  const updMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_conversion_child_container" as any, {
        _container_id: container.id,
        _size: form.size,
        _category: form.category,
        _height_class: requiresHeightClass(form.category) ? form.height : null,
        _notes: form.notes || null,
        _reason: form.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setEditOpen(false); toast({ title: "Container updated" }); },
    onError: (e: any) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const removeMut = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("remove_conversion_child_container" as any, {
        _container_id: container.id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "Container removed" }); },
    onError: (e: any) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  if (!isOwnerOrAdmin) return null;

  return (
    <>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3 w-3 mr-1" />Edit
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setRemoveOpen(true)}>
          <Trash2 className="h-3 w-3 mr-1" />Remove
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit {container.container_number}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Size</Label>
              <Select value={form.size} onValueChange={(v) => setForm((f) => ({ ...f, size: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SPLIT_SIZES.map((s) => <SelectItem key={s} value={s}>{s}'</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONTAINER_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Height</Label>
              <Select value={form.height} onValueChange={(v) => setForm((f) => ({ ...f, height: v }))} disabled={!requiresHeightClass(form.category)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="h-16" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Reason for change <span className="text-muted-foreground">(required)</span></Label>
              <Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="h-16" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => updMut.mutate()} disabled={updMut.isPending || form.reason.trim().length < 5}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${container.container_number}`}
        description="Only possible while the unit is still available and has no sale, lease, gate or job history."
        confirmLabel="Remove container"
        destructive
        onConfirm={async (reason) => { await removeMut.mutateAsync(reason); }}
      />
    </>
  );
}

/* ───────────────────── Split cost sharing ───────────────────── */

/**
 * Split children have no acquisition costs of their own — they take an equal
 * share of the mother unit's purchase price plus transport & crane, together
 * with the job's materials, labour and services.
 */
function SplitCostShareCard({ job, children, costs }: { job: any; children: any[]; costs: any[] }) {
  const { isOwnerOrAdmin } = useUserStaffRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const acquisition = Number(job.container_cost ?? 0) + Number(job.transport_offloading_cost ?? 0);
  const allocated = costs
    .filter((c: any) => c.output_kind === "container")
    .reduce((s: number, c: any) => s + Number(c.total_cost ?? 0), 0);
  const jobTotal = Number(job.actual_cost ?? 0);
  const drift = Math.abs(jobTotal - allocated) > 0.01 && children.length > 0;

  const mut = useMutation({
    mutationFn: (r: string) => recomputeSplitOutputCosts(job.id, r),
    onSuccess: (res) => {
      toast({
        title: "Cost shares restated",
        description: `${res.children} unit(s) now carry ${fmt(res.per_child)} each.`,
      });
      setOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["conversion-output-costs", job.id] });
      qc.invalidateQueries({ queryKey: ["child-containers", job.container_id] });
      qc.invalidateQueries({ queryKey: ["conversion", job.id] });
    },
    onError: (e: any) => toast({ title: "Could not restate", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GitFork className="h-4 w-4" /> Cost sharing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Child units inherit the mother container's cost — purchase {fmt(job.container_cost)} plus transport &amp; crane{" "}
          {fmt(job.transport_offloading_cost)} = {fmt(acquisition)} — shared in proportion to each unit's size. They carry
          no gate-in cost of their own.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>Job total: <strong>{fmt(jobTotal)}</strong></span>
          <span>Allocated to {children.length} unit(s): <strong>{fmt(allocated)}</strong></span>
          {children.length > 0 && <span>Per unit (average): <strong>{fmt(allocated / children.length)}</strong></span>}
        </div>
        {drift ? (
          <p className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-4 w-4" /> The allocated shares no longer match the job total — difference{" "}
            {fmt(Math.abs(jobTotal - allocated))}. Restate the shares to bring them back in line.
          </p>
        ) : children.length > 0 ? (
          <p className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Shares reconcile to the job total.
          </p>
        ) : null}

        <SplitCalculationExplainer job={job} children={children} costs={costs} />

        {isOwnerOrAdmin && children.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <RotateCcw className="h-4 w-4 mr-1" /> Restate cost shares
          </Button>
        )}
      </CardContent>


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Restate cost shares</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the allocation being restated?" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!reason.trim() || mut.isPending} onClick={() => mut.mutate(reason.trim())}>
              Restate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Shows exactly how each child's cost was derived: the mother unit's components,
 * the allocation weights, any currency conversion applied, and the reconciliation
 * of the shares back to the job total.
 */
function SplitCalculationExplainer({ job, children, costs }: { job: any; children: any[]; costs: any[] }) {
  const [open, setOpen] = useState(false);

  const containerCosts = costs.filter((c: any) => c.output_kind === "container");
  const snap = containerCosts[0]?.snapshot ?? null;
  const totals = snap?.totals ?? {};
  const basis = String(containerCosts[0]?.allocation_basis ?? snap?.basis ?? "size_weighted").replace(/_/g, " ");
  const currency = snap?.currency ?? job.currency ?? null;
  const weightTotal = Number(snap?.weight_total ?? children.reduce((s, c: any) => s + Number(c.size ?? 0), 0)) || 0;

  const rows = children.map((c: any) => {
    const cost = containerCosts.find((x: any) => x.output_id === c.id);
    const weight = Number(c.size ?? 0);
    return {
      id: c.id,
      number: c.container_number,
      weight,
      pct: weightTotal ? (weight * 100) / weightTotal : 0,
      share: Number(cost?.total_cost ?? c.acquisition_cost ?? 0),
    };
  });

  const jobTotal = Number(job.actual_cost ?? 0);
  const allocated = rows.reduce((s, r) => s + r.share, 0);
  const ok = Math.abs(jobTotal - allocated) < 0.01;

  const lines: { k: string; v: number }[] = [
    { k: "Mother purchase price", v: Number(totals.container ?? job.container_cost ?? 0) },
    { k: "Mother transport & crane", v: Number(totals.transport_offloading ?? job.transport_offloading_cost ?? 0) },
    { k: "Job materials", v: Number(totals.materials ?? 0) },
    { k: "Job labour", v: Number(totals.labour ?? 0) },
    { k: "Job services", v: Number(totals.services ?? 0) },
    { k: "Job sub-assemblies", v: Number(totals.sub_assemblies ?? 0) },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 -ml-2 text-xs">
          <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />
          How this was calculated
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="rounded-md border p-3 space-y-3 mt-1">
          <div>
            <p className="text-xs font-semibold mb-1">
              Mother unit {snap?.mother_container_number ? `· ${snap.mother_container_number}` : ""}
            </p>
            <div className="space-y-1">
              {lines.filter((l) => l.v > 0).map((l) => <Row key={l.k} k={l.k} v={fmt(l.v)} />)}
              <Separator />
              <Row k="Total to apportion" v={fmt(jobTotal)} bold />
            </div>
            {currency && (
              <p className="text-xs text-muted-foreground mt-1">
                Amounts are stated in {currency}. Invoices raised in another currency were converted at the rate recorded
                on the invoice before the mother unit's cost was set.
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold mb-1">
              Allocation method: {basis} — {rows.length} unit(s), weights {rows.map((r) => r.weight).join(" / ")} ft
            </p>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Unit</TableHead><TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Share %</TableHead><TableHead className="text-right">Cost</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-mono">{r.number}</TableCell>
                    <TableCell className="text-xs text-right">{r.weight}ft</TableCell>
                    <TableCell className="text-xs text-right">{r.pct.toFixed(2)}%</TableCell>
                    <TableCell className="text-xs text-right font-mono">{fmt(r.share)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className={`flex items-center gap-2 text-xs ${ok ? "text-emerald-600" : "text-amber-600"}`}>
            {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            Sum of shares {fmt(allocated)} vs job total {fmt(jobTotal)}
            {ok ? " — reconciled." : ` — off by ${fmt(Math.abs(jobTotal - allocated))}.`}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ───────────────────── Output change history ───────────────────── */


function OutputChangeHistory({ jobId }: { jobId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["conversion-output-audit", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversion_output_audit" as any)
        .select("*")
        .eq("conversion_id", jobId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  if (!rows.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Output change history</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>When</TableHead><TableHead>What</TableHead><TableHead>Action</TableHead><TableHead>Reason</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.changed_at), "dd MMM yyyy HH:mm")}</TableCell>
                <TableCell className="text-xs">
                  <span className="font-mono">{r.target_label ?? "—"}</span>
                  <span className="text-muted-foreground"> · {String(r.target_kind).replace("_", " ")}</span>
                </TableCell>
                <TableCell><Badge variant="secondary" className="capitalize">{r.action}</Badge></TableCell>
                <TableCell className="text-xs">{r.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OutputCard({ title, subtitle, status, totalCost, createdAt, cost, link, actions }: {
  title: string; subtitle: string; status?: string; totalCost: number; createdAt?: string; cost?: any; link?: string;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {link ? <Link to={link} className="hover:underline">{title}</Link> : title}
            </CardTitle>
            <p className="text-xs text-muted-foreground capitalize">{subtitle}</p>
          </div>
          {status && <Badge variant="secondary" className="capitalize">{status.replace("_"," ")}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {cost ? (
          <div className="space-y-1 text-sm">
            <Row k="Container" v={fmt(cost.container_cost)} />
            <Row k="Materials" v={fmt(cost.materials_cost)} />
            <Row k="Labour" v={fmt(cost.labour_cost)} />
            <Row k="Services" v={fmt(cost.services_cost)} />
            <Row k="Sub-assemblies" v={fmt(cost.sub_assemblies_cost)} />
            <Separator />
            <Row k="Total cost" v={fmt(cost.total_cost)} bold />
            <p className="text-xs text-muted-foreground">Allocation: {cost.allocation_basis?.replace("_"," ")}</p>
          </div>
        ) : (
          <Row k="Total cost" v={fmt(totalCost)} bold />
        )}
        {actions}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 -ml-2 text-xs">
              <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`} />Audit trail
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="text-xs text-muted-foreground space-y-1 pt-1">
              <p>Created {createdAt ? format(new Date(createdAt), "dd MMM yyyy HH:mm") : "—"}</p>
              {cost && (
                <pre className="bg-muted p-2 rounded text-[10px] overflow-x-auto">
                  {JSON.stringify(cost.snapshot, null, 2)}
                </pre>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}


function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={`text-xs ${bold ? "font-semibold" : "text-muted-foreground"}`}>{k}</span>
      <span className={`font-mono text-xs ${bold ? "font-bold" : ""}`}>{v}</span>
    </div>
  );
}

/* ─────────────────────────── Sub-assemblies Tab ─────────────────────────── */

export function SubAssembliesTab({ conversionId, onChanged, jobRef }: { conversionId: string; onChanged?: () => void; jobRef?: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: rows = [] } = useQuery({
    queryKey: ["conversion-sub-assemblies", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_sub_assemblies" as any)
        .select("*, sub_assembly_stock:assembly_stock_id(id, name, uom, on_hand_qty, avg_unit_cost, assembly_type)")
        .eq("conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: stock = [] } = useQuery({
    queryKey: ["sub-assembly-stock-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_stock" as any).select("*").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["conversion-sub-assemblies", conversionId] });
    qc.invalidateQueries({ queryKey: ["sub-assembly-stock-min"] });
    qc.invalidateQueries({ queryKey: ["sub-assembly-stock"] });
    qc.invalidateQueries({ queryKey: ["sub-assembly-movements", conversionId] });
    qc.invalidateQueries({ queryKey: ["job-sa-lots", conversionId] });
    onChanged?.();
  };

  const [stockId, setStockId] = useState("");
  const [planned, setPlanned] = useState("1");

  const addRow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("conversion_sub_assemblies" as any).insert({
        conversion_id: conversionId,
        assembly_stock_id: stockId,
        qty_planned: parseFloat(planned) || 1,
        qty_used: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); setStockId(""); setPlanned("1"); toast({ title: "Sub-assembly added to BOM" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [issueRow, setIssueRow] = useState<any | null>(null);
  const [returnRow, setReturnRow] = useState<any | null>(null);

  const handle = async (mode: "consume" | "return", row: any, qty: number, reason: string, note: string) => {
    const fn = mode === "consume" ? "consume_sub_assembly" : "return_sub_assembly";
    const { error } = await supabase.rpc(fn as any, {
      _conversion_id: conversionId,
      _csa_id: row.id,
      _qty: qty,
      _reason: `${reason}${note ? ` — ${note}` : ""}`,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: mode === "consume" ? "Issued from stock" : "Returned to stock" });
    refresh();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" />Sub-assemblies</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); addRow.mutate(); }} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 flex-1 min-w-[260px]">
            <Label className="text-xs">SKU</Label>
            <Select value={stockId} onValueChange={setStockId}>
              <SelectTrigger><SelectValue placeholder="Select sub-assembly" /></SelectTrigger>
              <SelectContent>
                {stock.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — on hand {intf(s.on_hand_qty)} {s.uom} @ {fmt(s.avg_unit_cost)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Qty planned</Label>
            <Input type="number" value={planned} onChange={(e) => setPlanned(e.target.value)} className="w-24" />
          </div>
          <Button type="submit" size="sm" disabled={!stockId || addRow.isPending}><Plus className="h-3 w-3 mr-1" />Add</Button>
        </form>

        <Separator />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Unit $</TableHead>
              <TableHead className="text-right">Total $</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No sub-assemblies added</TableCell></TableRow>
            ) : rows.map((r: any) => {
              const onHand = Number(r.sub_assembly_stock?.on_hand_qty ?? 0);
              const low = onHand <= 0;
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.sub_assembly_stock?.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground capitalize">{r.sub_assembly_stock?.assembly_type?.replace("_"," ")}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{intf(r.qty_planned)}</TableCell>
                  <TableCell className="text-right font-mono">{intf(r.qty_used)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.unit_cost_snapshot ?? r.sub_assembly_stock?.avg_unit_cost)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.total_cost)}</TableCell>
                  <TableCell className={`text-right font-mono ${low ? "text-destructive" : ""}`}>
                    {intf(onHand)} {low && <AlertTriangle className="inline h-3 w-3 ml-1" />}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setIssueRow(r)}><ArrowUpFromLine className="h-3 w-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => setReturnRow(r)} disabled={!Number(r.qty_used)}><RotateCcw className="h-3 w-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {issueRow && (
          <IssueReturnDialog open={!!issueRow} onOpenChange={(v) => !v && setIssueRow(null)} mode="issue" jobRef={jobRef}
            title={issueRow.sub_assembly_stock?.name ?? "Sub-assembly"} max={Number(issueRow.sub_assembly_stock?.on_hand_qty ?? 0)}
            onSubmit={(q, r, n) => handle("consume", issueRow, q, r, n)} />
        )}
        {returnRow && (
          <IssueReturnDialog open={!!returnRow} onOpenChange={(v) => !v && setReturnRow(null)} mode="return" jobRef={jobRef}
            title={returnRow.sub_assembly_stock?.name ?? "Sub-assembly"} max={Number(returnRow.qty_used ?? 0)}
            onSubmit={(q, r, n) => handle("return", returnRow, q, r, n)} />
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Timeline Tab ─────────────────────────── */

type TLEvent = { id: string; ts: string; kind: string; title: string; detail?: string; tone?: string; icon?: any };

export function TimelineTab({ conversionId, job }: { conversionId: string; job: any }) {
  const { data: matMov = [] } = useQuery({
    queryKey: ["material-movements", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("material_movements" as any)
        .select("*, material:material_id(name, unit)")
        .eq("conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: saMov = [] } = useQuery({
    queryKey: ["sub-assembly-movements", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_movements" as any)
        .select("*, sub_assembly_stock:assembly_stock_id(name, uom)")
        .eq("conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: children = [] } = useQuery({
    queryKey: ["child-containers", job.container_id],
    enabled: !!job.container_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("containers")
        .select("id, container_number, created_at, acquisition_cost")
        .eq("parent_container_id", job.container_id);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["job-finished-products", conversionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("finished_products" as any)
        .select("id, product_number, total_cost, created_at").eq("source_conversion_id", conversionId);
      if (error) throw error;
      return data as any[];
    },
  });

  const events: TLEvent[] = useMemo(() => {
    const e: TLEvent[] = [];
    e.push({ id: "created", ts: job.created_at, kind: "status", title: "Job created", tone: "info", icon: Package });
    if (job.started_at) e.push({ id: "started", ts: job.started_at, kind: "status", title: "Job started", tone: "warning", icon: Wrench });
    if (job.completed_at) e.push({ id: "completed", ts: job.completed_at, kind: "status", title: "Job completed", tone: "success", icon: CheckCircle2 });
    matMov.forEach((m: any) => e.push({
      id: `m-${m.id}`, ts: m.created_at, kind: "material",
      title: `${m.movement_type === "issue" ? "Issued" : m.movement_type === "return" ? "Returned" : m.movement_type} ${Math.abs(Number(m.qty))} ${m.material?.unit ?? ""} — ${m.material?.name ?? ""}`,
      detail: `${fmt(Math.abs(Number(m.qty) * Number(m.unit_cost)))} · ${m.reason ?? ""}`,
      tone: m.qty < 0 ? "warning" : "success", icon: m.qty < 0 ? ArrowUpFromLine : ArrowDownToLine,
    }));
    saMov.forEach((m: any) => e.push({
      id: `s-${m.id}`, ts: m.created_at, kind: "sub_assembly",
      title: `${m.movement_type === "consume" ? "Consumed" : m.movement_type === "return" ? "Returned" : m.movement_type === "produce" ? "Produced" : m.movement_type} ${Math.abs(Number(m.qty))} ${m.sub_assembly_stock?.uom ?? ""} — ${m.sub_assembly_stock?.name ?? ""}`,
      detail: `${fmt(Math.abs(Number(m.qty) * Number(m.unit_cost)))} · ${m.reason ?? ""}`,
      tone: m.movement_type === "produce" ? "success" : m.qty < 0 ? "warning" : "info", icon: Layers,
    }));
    children.forEach((c: any) => e.push({
      id: `c-${c.id}`, ts: c.created_at, kind: "output",
      title: `Child container created — ${c.container_number}`,
      detail: `Allocated cost ${fmt(c.acquisition_cost)}`, tone: "success", icon: GitFork,
    }));
    products.forEach((p: any) => e.push({
      id: `p-${p.id}`, ts: p.created_at, kind: "output",
      title: `Finished product created — ${p.product_number}`,
      detail: `Total cost ${fmt(p.total_cost)}`, tone: "success", icon: Boxes,
    }));
    return e.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [matMov, saMov, children, products, job]);

  const [filter, setFilter] = useState<string>("all");
  const filtered = filter === "all" ? events : events.filter((e) => e.kind === filter);

  const filters = [
    { v: "all", label: "All" },
    { v: "status", label: "Status" },
    { v: "material", label: "Materials" },
    { v: "sub_assembly", label: "Sub-assemblies" },
    { v: "output", label: "Outputs" },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Job timeline</CardTitle>
          <div className="flex flex-wrap gap-1">
            {filters.map((f) => (
              <Button key={f.v} size="sm" variant={filter === f.v ? "default" : "outline"} onClick={() => setFilter(f.v)}>{f.label}</Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!filtered.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">No events</p>
        ) : (
          <ol className="relative border-l border-border ml-3 space-y-4">
            {filtered.map((e) => {
              const Icon = e.icon ?? Activity;
              const tone = e.tone === "success" ? "bg-success/15 text-success"
                : e.tone === "warning" ? "bg-warning/15 text-warning"
                : e.tone === "destructive" ? "bg-destructive/15 text-destructive"
                : "bg-info/15 text-info";
              return (
                <li key={e.id} className="ml-4">
                  <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ${tone}`}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">{e.title}</p>
                    <time className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(e.ts), "dd MMM HH:mm")}</time>
                  </div>
                  {e.detail && <p className="text-xs text-muted-foreground">{e.detail}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Org-level variance widget ─────────────────────────── */

export function OrgVarianceWidget() {
  const { data = [] } = useQuery({
    queryKey: ["org-variance-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_variance_summary" as any)
        .select("*").order("variance_cost", { ascending: false }).limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const top = useMemo(() => [...data]
    .map((d: any) => ({ ...d, abs: Math.abs(Number(d.variance_cost)) }))
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 5), [data]);

  const overThreshold = data.filter((d: any) => Number(d.planned_cost) > 0 &&
    Math.abs(Number(d.variance_cost)) / Number(d.planned_cost) >= 0.1).length;

  if (!data.length) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4" />Material variance — top jobs</p>
          <Badge variant={overThreshold ? "destructive" : "secondary"}>{overThreshold} job{overThreshold === 1 ? "" : "s"} over ±10%</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          {top.map((d: any) => (
            <Link key={d.conversion_id} to={`/conversions/${d.conversion_id}`}
              className="block p-2 rounded border hover:bg-muted text-xs">
              <div className="font-mono font-medium">{d.conversion_number}</div>
              <div className={`font-mono ${Number(d.variance_cost) > 0 ? "text-destructive" : "text-success"}`}>{fmt(d.variance_cost)}</div>
              <div className="text-muted-foreground">planned {fmt(d.planned_cost)}</div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
