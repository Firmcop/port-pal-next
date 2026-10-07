import { useState, useMemo, useEffect } from "react";
import { getDefaultCurrency, fmtMoney } from "@/lib/finance-format";
import { useParams, useNavigate, Link } from "@/lib/router";
import { useConversionCostSync, isDrifted } from "@/hooks/use-conversion-cost-sync";
import { resyncConversionContainerCosts, type ResyncPreviewRow } from "@/lib/conversion-cost-sync";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PurchasedForJobPanel } from "@/components/conversions/PurchasedForJobPanel";
import { supabase } from "@/integrations/supabase/client";
import AcquisitionCostFields from "@/components/containers/AcquisitionCostFields";
import { useContainerAcquisition } from "@/hooks/use-container-acquisition";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, Package, Users, ClipboardList, Truck, DollarSign, FileText, AlertTriangle, XCircle, Link2, FolderKanban, Repeat, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { VarianceTab, OutputsTab, SubAssembliesTab, TimelineTab, MaterialActions } from "@/components/conversions/ConversionExtras";
import { MaterialAuditDialog, ProcurementStatusBadge, useProcurementStatusMap } from "@/components/conversions/MaterialAuditDialog";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { EditConversionRevenueDialog, ConversionRevenueHistory } from "@/components/conversions/EditConversionRevenueDialog";
import { acquireContainerFromOwner } from "@/lib/container-acquisition";
import { MaterialPicker, useMaterialCatalogWithStock, type CatalogMaterial } from "@/components/materials/MaterialPicker";
import { ContainerRateTable } from "@/components/conversions/ContainerRateTable";
import { BudgetTab, useConversionBudgetLines } from "@/components/conversions/BudgetTab";

const statusColor: Record<string, string> = {
  planning: "bg-info/15 text-info",
  in_progress: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

const taskStatusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
};

const reqStatusColor: Record<string, string> = {
  requested: "bg-info/15 text-info",
  approved: "bg-warning/15 text-warning",
  ordered: "bg-primary/15 text-primary",
  rejected: "bg-destructive/15 text-destructive",
  fulfilled: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

/* ── Shared hooks for catalog data ── */
function useMaterialCatalog() {
  return useQuery({
    queryKey: ["materials-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useMaterialStock() {
  return useQuery({
    queryKey: ["material-stock-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("material_stock").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useEmployees() {
  return useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function ConversionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { role } = useUserStaffRole();

  const { data: job, isLoading } = useQuery({
    queryKey: ["conversion", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("container_conversions")
        .select("*, containers(container_number, size, category), customers:customer_id(company_name), sales_orders:sales_order_id(order_number), quotes:quote_id(id, quote_number), project:project_id(id, code, name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["conversion-materials", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_materials").select("*").eq("conversion_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: labour = [] } = useQuery({
    queryKey: ["conversion-labour", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_labour").select("*").eq("conversion_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["conversion-tasks", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_tasks").select("*").eq("conversion_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["conversion-services", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_services").select("*").eq("conversion_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: requests = [] } = useQuery({
    queryKey: ["material-requests", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("material_requests").select("*").eq("conversion_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchases").select("*").eq("conversion_id", id!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: splitOutputs = [] } = useQuery({
    queryKey: ["conversion-outputs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("conversion_outputs" as any).select("*").eq("conversion_id", id!);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: linkedContainers = [] } = useQuery({
    queryKey: ["conversion-containers", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversion_containers" as any)
        .select("id, container_id, container_cost, transport_offloading_cost, role, created_at, containers:container_id(container_number, size, category, owner, status)")
        .eq("conversion_id", id!)
        .order("role")
        .order("created_at");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  // Auto-costing (join table is source of truth; falls back to legacy fields when
  // the legacy container isn't already represented in the join table).
  const costs = useMemo(() => {
    const legacyContainerId = (job as any)?.container_id || null;
    const legacyPurchase = Number((job as any)?.container_cost || 0);
    const legacyTransport = Number((job as any)?.transport_offloading_cost || 0);
    const legacyInJoin = !!legacyContainerId && linkedContainers.some((r: any) => r.container_id === legacyContainerId);
    const joinPurchase = linkedContainers.reduce((s: number, r: any) => s + Number(r.container_cost || 0), 0);
    const joinTransport = linkedContainers.reduce((s: number, r: any) => s + Number(r.transport_offloading_cost || 0), 0);
    const purchasePrice = joinPurchase + (legacyInJoin ? 0 : legacyPurchase);
    const transportCost = joinTransport + (legacyInJoin ? 0 : legacyTransport);
    const containerCost = purchasePrice + transportCost;
    const materialsCost = materials.reduce((s, m: any) => s + Number(m.total_cost), 0);
    const labourCost = labour.reduce((s, l: any) => s + Number(l.total_cost), 0);
    const labourPayroll = labour.filter((l: any) => l.source === "payroll").reduce((s: number, l: any) => s + Number(l.total_cost), 0);
    const labourManual = labourCost - labourPayroll;
    const servicesCost = services.reduce((s, sv: any) => s + Number(sv.cost), 0);
    const totalCost = containerCost + materialsCost + labourCost + servicesCost;
    const quotedPrice = Number((job as any)?.quoted_price || 0);
    const profit = quotedPrice - totalCost;
    return { purchasePrice, transportCost, containerCost, materialsCost, labourCost, labourPayroll, labourManual, servicesCost, totalCost, quotedPrice, profit };
  }, [job, materials, labour, services, linkedContainers]);




  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["conversion", id] });
    qc.invalidateQueries({ queryKey: ["conversion-containers", id] });
    qc.invalidateQueries({ queryKey: ["conversion-container-audit", id] });
    qc.invalidateQueries({ queryKey: ["containers"] });

    qc.invalidateQueries({ queryKey: ["conversion-materials", id] });
    qc.invalidateQueries({ queryKey: ["conversion-labour", id] });

    qc.invalidateQueries({ queryKey: ["conversion-tasks", id] });
    qc.invalidateQueries({ queryKey: ["conversion-services", id] });
    qc.invalidateQueries({ queryKey: ["material-requests", id] });
    qc.invalidateQueries({ queryKey: ["purchases", id] });
    qc.invalidateQueries({ queryKey: ["conversions"] });
    qc.invalidateQueries({ queryKey: ["conversion-cost-summaries"] });
    qc.invalidateQueries({ queryKey: ["material-stock-all"] });
  };

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      if (status === "completed") {
        const { error } = await supabase.rpc("complete_conversion" as any, { _id: id! });
        if (error) throw error;
        // Post an acquisition PO payable to EACH linked container's owner (no-op if owner == depot).
        // Prefer the join table; fall back to legacy single container_id when the join is empty.
        const rows: Array<{ container_id: string; amount: number }> = linkedContainers.length
          ? linkedContainers.map((r: any) => ({ container_id: r.container_id, amount: Number(r.container_cost || 0) }))
          : (j?.container_id ? [{ container_id: j.container_id, amount: Number(j?.container_cost || 0) }] : []);
        const owners: string[] = [];
        for (const row of rows) {
          if (!row.container_id || !(row.amount > 0)) continue;
          const poId = await acquireContainerFromOwner({
            containerId: row.container_id,
            amount: row.amount,
            currency: (j as any)?.currency || getDefaultCurrency(),
            reason: "conversion",
            reference: (j as any)?.job_number || id!,
          });
          if (poId) {
            const { data: c } = await supabase.from("containers").select("container_number, owner").eq("id", row.container_id).maybeSingle();
            if ((c as any)?.owner) owners.push(`${(c as any).container_number}→${(c as any).owner}`);
          }
        }
        return { acquiredOwner: owners.length ? owners.join(", ") : null };
      }

      const updates: Record<string, unknown> = { status };
      if (status === "in_progress") updates.started_at = new Date().toISOString();
      const { error } = await supabase.from("container_conversions").update(updates as any).eq("id", id!);
      if (error) throw error;
      return { acquiredOwner: null };
    },
    onSuccess: (res: any) => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["accounting-transactions"] });
      toast({ title: res?.acquiredOwner ? `Status updated — purchase invoice issued to ${res.acquiredOwner}` : "Status updated" });
    },
    onError: (e: any) => {
      const msg = String(e?.message || "");
      const map: Record<string, string> = {
        split_requires_outputs: "Add at least one planned output before completing the split job.",
        split_requires_source_container: "Split jobs require a source container.",
        split_invalid_size: "Planned output sizes must be 10, 20, 30, 40, or 45.",
        split_invalid_count: "Planned counts must be between 1 and 50 (and total ≤ 50).",
        split_dry_requires_height_class: "Dry rows must have a height class (HC or LC).",
        split_height_class_not_allowed: "Only dry rows can have a height class.",
        split_size_compat: "Total planned child footprint exceeds the parent container's size.",
        "DELETE requires a WHERE clause": "Split cost allocation could not clear its temporary workspace. No job data was changed; please retry.",
        no_child_containers: "No child containers were generated for this split job. Review the planned outputs and retry.",
        invalid_child_size: "Every split output needs a valid container size before costs can be allocated.",
        allocation_mismatch: "The child cost shares do not equal the job total. No completion changes were saved.",
        already_completed: "This job has already been completed and cannot be completed again.",
      };
      const friendly = Object.entries(map).find(([k]) => msg.includes(k))?.[1] ?? msg;
      toast({ title: "Cannot complete job", description: friendly, variant: "destructive" });
    },
  });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const cancelMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("cancel_conversion" as any, { _id: id!, _reason: cancelReason });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["containers"] });
      setCancelOpen(false);
      setCancelReason("");
      toast({
        title: "Job cancelled",
        description: `Returned ${res?.materials_returned ?? 0} material(s) and ${res?.sub_assemblies_returned ?? 0} sub-assembly line(s) to stock.`,
      });
    },
    onError: (e: any) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>;
  if (!job) return <div className="flex items-center justify-center h-64 text-muted-foreground">Job not found</div>;

  const j = job as any;
  const isOperationalRole = role === "admin" || role === "yard_operator" || role === "gate_clerk";
  const isCreatorDraft = j.created_by === user?.id && j.status === "planning";
  const canCancel = (j.status === "planning" || j.status === "in_progress") && (isOperationalRole || isCreatorDraft);

  // Split-job completion gating
  const isSplit = j.job_kind === "split";
  const splitBlocker: string | null = (() => {
    if (!isSplit) return null;
    if (!j.container_id) return "Split jobs require a source container.";
    if (!splitOutputs.length) return "Add at least one planned output before completing.";
    if (splitOutputs.some((o: any) => o.category === "dry" && !o.height_class)) return "Some dry rows are missing a height class.";
    const total = splitOutputs.reduce((s: number, o: any) => s + Number(o.planned_count || 0), 0);
    if (total > 50) return "Total planned children exceeds 50.";
    const parentSize = parseInt(j.containers?.size as any, 10);
    const footprint = splitOutputs.reduce((s: number, o: any) => s + parseInt(o.size, 10) * Number(o.planned_count || 0), 0);
    if (parentSize && footprint > parentSize) return `Planned footprint (${footprint}') exceeds parent size (${parentSize}').`;
    return null;
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/conversions")}><ArrowLeft className="h-5 w-5" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">{j.conversion_number}</h1>
          <p className="text-muted-foreground capitalize">{j.product_type?.replace("_", " ")}{j.containers?.container_number ? ` — ${j.containers.container_number}` : ""}</p>
          {j.quotes?.quote_number && (
            <p className="text-xs mt-1">
              <span className="text-muted-foreground">From quote </span>
              <a href={`/quotes/${j.quotes.id}`} className="underline hover:text-primary">{j.quotes.quote_number}</a>
            </p>
          )}
          {j.status === "cancelled" && j.cancellation_reason && (
            <p className="text-xs text-destructive mt-1">Cancelled{j.cancelled_at ? ` on ${format(new Date(j.cancelled_at), "dd MMM yyyy HH:mm")}` : ""}: {j.cancellation_reason}</p>
          )}
        </div>
        <Badge className={statusColor[j.status] ?? ""} variant="secondary">{j.status?.replace("_", " ")}</Badge>
        {j.job_kind !== "sub_assembly" && (j.status === "planning" || j.status === "in_progress") && (
          <AttachContainerDialog job={j} linkedIds={linkedContainers.map((r: any) => r.container_id)} onAttached={invalidateAll} />
        )}

        {j.status === "planning" && <Button size="sm" onClick={() => updateStatus.mutate("in_progress")}>Start Job</Button>}
        {j.status === "in_progress" && (
          <Button size="sm" onClick={() => updateStatus.mutate("completed")} disabled={!!splitBlocker} title={splitBlocker ?? undefined}>
            Complete Job
          </Button>
        )}
        {canCancel && (
          <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
            <XCircle className="h-4 w-4 mr-1" />Cancel Job
          </Button>
        )}
      </div>

      <Dialog open={cancelOpen} onOpenChange={(v) => { if (!cancelMut.isPending) setCancelOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel conversion job?</DialogTitle>
            <DialogDescription>
              This will return the source container to <strong>available</strong>, and revert any issued materials and consumed sub-assemblies back to stock. Labour and service entries are kept as history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why is this job being cancelled?" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelMut.isPending}>Keep Job</Button>
            <Button variant="destructive" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending || !cancelReason.trim()}>
              {cancelMut.isPending ? "Cancelling…" : "Cancel Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Linked containers */}
      {j.job_kind !== "sub_assembly" && (
        <>
          <LinkedContainersCard
            job={j}
            rows={linkedContainers}
            onChanged={invalidateAll}
            canEdit={j.status === "planning" || j.status === "in_progress"}
          />
          <ContainerChangeHistory jobId={j.id} />
          <ContainerRateTable job={j} linkedContainers={linkedContainers} />
        </>
      )}


      <ProjectLinkCard job={j} onChanged={invalidateAll} canManage={role !== "viewer"} />



      {/* Cost summary cards */}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Container", value: costs.containerCost, hint: null as string | null },
          { label: "Materials", value: costs.materialsCost, hint: null },
          {
            label: "Labour",
            value: costs.labourCost,
            hint: costs.labourPayroll > 0
              ? `payroll ${costs.labourPayroll.toLocaleString(undefined, { maximumFractionDigits: 0 })} · manual ${costs.labourManual.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : null,
          },
          { label: "Services", value: costs.servicesCost, hint: null },
          { label: "Total Cost", value: costs.totalCost, hint: null },
          { label: "Revenue", value: costs.quotedPrice, hint: null },
          { label: "Profit", value: costs.profit, hint: null },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-lg font-bold font-mono ${c.label === "Profit" ? (c.value >= 0 ? "text-success" : "text-destructive") : ""}`}>
                {c.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              {c.hint ? <p className="text-[10px] text-muted-foreground">{c.hint}</p> : null}
            </CardContent>
          </Card>
        ))}

      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="sub_assemblies">Sub-assemblies</TabsTrigger>
          <TabsTrigger value="outputs">Outputs</TabsTrigger>
          <TabsTrigger value="variance">Variance</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="labour">Labour</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="procurement">Procurement</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="invoice">Invoice</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab job={j} onChanged={invalidateAll} /></TabsContent>
        <TabsContent value="budget"><BudgetTab job={j} onChanged={invalidateAll} /></TabsContent>
        <TabsContent value="materials"><MaterialsTab conversionId={id!} materials={materials} onSuccess={invalidateAll} jobRef={j.conversion_number} projectId={j.project_id} /></TabsContent>
        <TabsContent value="sub_assemblies"><SubAssembliesTab conversionId={id!} onChanged={invalidateAll} jobRef={j.conversion_number} /></TabsContent>
        <TabsContent value="outputs"><OutputsTab job={j} /></TabsContent>
        <TabsContent value="variance"><VarianceTab conversionId={id!} materials={materials} /></TabsContent>
        <TabsContent value="timeline"><TimelineTab conversionId={id!} job={j} /></TabsContent>
        <TabsContent value="labour"><LabourTab conversionId={id!} labour={labour} onSuccess={invalidateAll} /></TabsContent>
        <TabsContent value="tasks"><TasksTab conversionId={id!} tasks={tasks} onSuccess={invalidateAll} /></TabsContent>
        <TabsContent value="procurement"><ProcurementTab conversionId={id!} requests={requests} purchases={purchases} onSuccess={invalidateAll} user={user} /></TabsContent>
        <TabsContent value="costs"><CostsTab costs={costs} conversionId={id!} services={services} onSuccess={invalidateAll} currency={(j as any)?.currency || getDefaultCurrency()} /></TabsContent>
        <TabsContent value="invoice"><InvoiceTab job={j} costs={costs} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Overview Tab ── */
function OverviewTab({ job, onChanged }: { job: any; onChanged: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [revOpen, setRevOpen] = useState(false);
  const { isOwnerOrAdmin } = useUserStaffRole();
  const qc = useQueryClient();
  const purchase = Number(job.container_cost || 0);
  const transport = Number(job.transport_offloading_cost || 0);
  return (
    <Card>
      <CardContent className="p-6 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div><span className="text-muted-foreground">Customer</span><p className="font-medium">{job.customers?.company_name ?? "—"}</p></div>
        <div><span className="text-muted-foreground">Container</span><p className="font-medium">{job.containers?.container_number} ({job.containers?.size}' {job.containers?.category})</p></div>
        <div><span className="text-muted-foreground">Product Type</span><p className="font-medium capitalize">{job.product_type?.replace("_", " ")}</p></div>
        <div><span className="text-muted-foreground">Status</span><p className="font-medium capitalize">{job.status?.replace("_", " ")}</p></div>
        <div><span className="text-muted-foreground">Start Date</span><p className="font-medium">{job.start_date ? format(new Date(job.start_date), "dd MMM yyyy") : "—"}</p></div>
        <div><span className="text-muted-foreground">End Date</span><p className="font-medium">{job.end_date ? format(new Date(job.end_date), "dd MMM yyyy") : "—"}</p></div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Quoted Price</span>
            {isOwnerOrAdmin && job.status !== "cancelled" && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setRevOpen(true)}>Edit</Button>
            )}
          </div>
          <p className="font-medium">{Number(job.quoted_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Container Cost</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditOpen(true)}>Edit</Button>
          </div>
          <p className="font-medium">{(purchase + transport).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground">Purchase {purchase.toLocaleString(undefined,{minimumFractionDigits:2})} + Transport {transport.toLocaleString(undefined,{minimumFractionDigits:2})}</p>
        </div>
        <div><span className="text-muted-foreground">Sales Order</span><p className="font-medium font-mono">{job.sales_orders?.order_number ?? "—"}</p></div>
        <div className="col-span-full"><span className="text-muted-foreground">Description</span><p className="font-medium">{job.description || "—"}</p></div>
        <ConversionRevenueHistory conversionId={job.id} enabled={!!isOwnerOrAdmin} />
      </CardContent>
      <EditConversionCostsDialog open={editOpen} onOpenChange={setEditOpen} job={job} onSaved={onChanged} />
      <EditConversionRevenueDialog
        open={revOpen}
        onOpenChange={setRevOpen}
        job={job}
        onSaved={() => {
          onChanged();
          qc.invalidateQueries({ queryKey: ["conversion-revenue-audit", job.id] });
          qc.invalidateQueries({ queryKey: ["project-pnl"] });
          qc.invalidateQueries({ queryKey: ["project-pnl", job.project_id] });
          qc.invalidateQueries({ queryKey: ["project-job-costs-all"] });
          qc.invalidateQueries({ queryKey: ["project-job-costs", job.project_id] });
        }}
      />
    </Card>
  );
}

function EditConversionCostsDialog({ open, onOpenChange, job, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; job: any; onSaved: () => void }) {
  const { toast } = useToast();
  const [purchase, setPurchase] = useState(String(job.container_cost ?? ""));
  const [transport, setTransport] = useState(String(job.transport_offloading_cost ?? ""));
  const mut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("adjust_conversion_costs" as any, {
        _id: job.id,
        _new_purchase: parseFloat(purchase) || 0,
        _new_transport: parseFloat(transport) || 0,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      const parts: string[] = [];
      if (res?.adjustment_po) parts.push("acquisition PO adjusted");
      if (res?.ledger_posted) parts.push("COGS adjustment posted");
      toast({ title: "Costs updated", description: parts.join(" · ") || "Saved" });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Container Costs</DialogTitle>
          <DialogDescription>
            Purchase price is invoiced to the owner. Transport & offloading is an internal cost. {job.status === "completed" ? "Differences will post adjusting entries automatically." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2"><Label>Purchase Price (to owner)</Label><Input type="number" value={purchase} onChange={(e) => setPurchase(e.target.value)} /></div>
          <div className="space-y-2"><Label>Transport & Offloading</Label><Input type="number" value={transport} onChange={(e) => setTransport(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Total: <strong>{((parseFloat(purchase)||0)+(parseFloat(transport)||0)).toLocaleString(undefined,{minimumFractionDigits:2})}</strong></p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/* ── Materials Tab (catalog picker, category filter, stock guard, planned qty from budget) ── */
function MaterialsTab({ conversionId, materials, onSuccess, jobRef, projectId }: { conversionId: string; materials: any[]; onSuccess: () => void; jobRef?: string | null; projectId?: string | null }) {
  const { toast } = useToast();
  const { data: catalog = [] } = useMaterialCatalogWithStock();
  const { data: budgetLines = [] } = useConversionBudgetLines(conversionId);
  const procurement = useProcurementStatusMap(conversionId);
  const [f, setF] = useState<{ material_id: string | null; description: string; qty_planned: string; qty_used: string; unit_cost: string; supplier: string; source: string }>(
    { material_id: null, description: "", qty_planned: "1", qty_used: "0", unit_cost: "", supplier: "", source: "purchase" },
  );
  const [rowFilter, setRowFilter] = useState("");
  const [rowCategory, setRowCategory] = useState("__all");
  const s = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const catById = useMemo(() => new Map<string, CatalogMaterial>((catalog as CatalogMaterial[]).map((m) => [m.id, m])), [catalog]);
  const available = f.material_id ? Number(catById.get(f.material_id)?.on_hand_qty ?? 0) : null;
  const wanted = parseFloat(f.qty_used) || 0;
  const shortfall = f.material_id && wanted > (available ?? 0) ? wanted - (available ?? 0) : 0;

  const pickMaterial = (id: string | null, m: any) => {
    if (!id) { setF((p) => ({ ...p, material_id: null, description: "", unit_cost: "" })); return; }
    const planned = budgetLines.find((b: any) => b.material_id === id);
    setF((p) => ({
      ...p,
      material_id: id,
      description: m?.name ?? "",
      unit_cost: String(m?.avg_unit_cost ?? m?.unit_cost ?? 0),
      qty_planned: planned ? String(Number(planned.planned_qty)) : p.qty_planned,
    }));
  };

  const rows = useMemo(() => {
    return materials.filter((m: any) => {
      const cat = m.material_id ? (catById.get(m.material_id)?.category ?? "Other") : "Custom";
      if (rowCategory !== "__all" && cat !== rowCategory) return false;
      if (rowFilter && !String(m.description ?? "").toLowerCase().includes(rowFilter.toLowerCase())) return false;
      return true;
    });
  }, [materials, catById, rowCategory, rowFilter]);

  const rowCategories = useMemo(() => {
    const set = new Set<string>();
    materials.forEach((m: any) => set.add(m.material_id ? (catById.get(m.material_id)?.category ?? "Other") : "Custom"));
    return Array.from(set).sort();
  }, [materials, catById]);

  const addMut = useMutation({
    mutationFn: async () => {
      const qty = parseFloat(f.qty_planned) || 1;
      const unit = parseFloat(f.unit_cost) || 0;
      if (shortfall > 0) throw new Error(`Only ${available} in stock — raise a requisition for the shortfall of ${shortfall}.`);
      const { error } = await supabase.from("conversion_materials").insert({
        conversion_id: conversionId,
        material_id: f.material_id || null,
        description: f.description,
        quantity: qty,
        qty_planned: qty,
        qty_used: parseFloat(f.qty_used) || 0,
        unit_cost: unit,
        total_cost: qty * unit,
        supplier: f.supplier || null,
        source: f.source,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Material added", description: f.material_id ? "Quantity used has been deducted from stock." : "Custom line — no stock movement." }); setF({ material_id: null, description: "", qty_planned: "1", qty_used: "0", unit_cost: "", supplier: "", source: "purchase" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const requisition = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("raise_material_requisition", {
        _conversion_id: conversionId,
        _material_id: f.material_id,
        _description: f.description,
        _qty: shortfall || wanted || 1,
        _needed_by: null,
        _urgency: "normal",
        _note: `Raised from job ${jobRef ?? ""} — shortfall on issue`,
      });
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Requisition raised", description: "Procurement can now approve and order it." }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Package className="h-4 w-4" />Materials (BOM)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <PurchasedForJobPanel conversionId={conversionId} projectId={projectId} onAllocated={onSuccess} />
        <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Material (filter by category, search by name)</Label>
            <MaterialPicker value={f.material_id} onChange={pickMaterial} materials={catalog as any} allowCustom />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={f.description} onChange={(e) => s("description", e.target.value)} required /></div>
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Select value={f.source} onValueChange={(v) => s("source", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Purchase</SelectItem>
                  <SelectItem value="stock">Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Unit Cost</Label><Input type="number" value={f.unit_cost} onChange={(e) => s("unit_cost", e.target.value)} required /></div>
            <div className="space-y-1"><Label className="text-xs">Supplier</Label><Input value={f.supplier} onChange={(e) => s("supplier", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Qty Planned {budgetLines.some((b: any) => b.material_id === f.material_id) && <span className="text-muted-foreground">(from budget)</span>}</Label>
              <Input type="number" value={f.qty_planned} onChange={(e) => s("qty_planned", e.target.value)} />
            </div>
            <div className="space-y-1"><Label className="text-xs">Qty Used</Label><Input type="number" value={f.qty_used} onChange={(e) => s("qty_used", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Line Total</Label><Input value={((parseFloat(f.qty_planned) || 0) * (parseFloat(f.unit_cost) || 0)).toFixed(2)} readOnly className="bg-muted" /></div>
          </div>
          {shortfall > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <p className="text-xs text-destructive flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                Only {available} in stock — short by {shortfall}. Stock cannot go negative; raise a requisition instead.
              </p>
              <Button type="button" size="sm" variant="outline" disabled={requisition.isPending} onClick={() => requisition.mutate()}>
                <ClipboardList className="mr-1 h-3 w-3" />Raise requisition for {shortfall}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {f.material_id
                ? `Stock-linked — "Qty Used" is deducted from stock (${available} available).`
                : "Custom item — this line will NOT move stock. Pick a catalog material to track inventory."}
            </p>
          )}
          <Button type="submit" size="sm" disabled={addMut.isPending || !f.description || shortfall > 0}><Plus className="mr-1 h-3 w-3" />Add Material</Button>
        </form>
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Select value={rowCategory} onValueChange={setRowCategory}>
            <SelectTrigger className="w-[11rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All categories</SelectItem>
              {rowCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="w-56" placeholder="Search lines…" value={rowFilter} onChange={(e) => setRowFilter(e.target.value)} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Procurement</TableHead>
              <TableHead className="text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow><TableCell colSpan={9} className="text-center py-4 text-muted-foreground">No materials match</TableCell></TableRow>
            ) : rows.map((m: any) => (
              <TableRow key={m.id}>
                <TableCell className="text-sm">{m.description}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{m.material_id ? (catById.get(m.material_id)?.category ?? "Other") : "Custom"}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{m.source ?? "purchase"}</Badge></TableCell>
                <TableCell className="text-right font-mono text-sm">{Number(m.qty_planned)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{Number(m.qty_used)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{Number(m.unit_cost).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-sm font-medium">{Number(m.total_cost).toLocaleString()}</TableCell>
                <TableCell>{m.material_id ? <ProcurementStatusBadge row={procurement.get(m.material_id)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <MaterialActions conversionId={conversionId} materialId={m.material_id} label={m.description} onDone={onSuccess} jobRef={jobRef} />
                    <MaterialAuditDialog conversionId={conversionId} materialId={m.material_id} conversionMaterialId={m.id} label={m.description} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ── Labour Tab (with employee register) ── */
function LabourTab({ conversionId, labour, onSuccess }: { conversionId: string; labour: any[]; onSuccess: () => void }) {
  const { toast } = useToast();
  const { data: employees = [] } = useEmployees();
  const [f, setF] = useState({ employee_id: "", worker_name: "", role: "", hours: "", rate: "" });
  const s = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);

  const handleEmployeeSelect = (empId: string) => {
    if (empId === "__manual") {
      setF(p => ({ ...p, employee_id: "", worker_name: "", role: "", rate: "" }));
      return;
    }
    const emp = employees.find((e: any) => e.id === empId);
    if (emp) {
      setF(p => ({ ...p, employee_id: empId, worker_name: emp.name, role: emp.role, rate: String(emp.daily_rate) }));
    }
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const hrs = parseFloat(f.hours) || 0;
      const rt = parseFloat(f.rate) || 0;
      const { error } = await supabase.from("conversion_labour").insert({
        conversion_id: conversionId,
        worker_name: f.worker_name,
        role: f.role || null,
        hours: hrs,
        rate: rt,
        total_cost: hrs * rt,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Labour entry added" }); setF({ employee_id: "", worker_name: "", role: "", hours: "", rate: "" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Labour Tracking</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setAddEmployeeOpen(true)}><Plus className="mr-1 h-3 w-3" />Add Employee</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Employee</Label>
              <Select value={f.employee_id || "__manual"} onValueChange={handleEmployeeSelect}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__manual">✏️ Manual entry</SelectItem>
                  {employees.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{e.name} — {e.role} ({e.daily_rate}/day)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Worker</Label><Input value={f.worker_name} onChange={(e) => s("worker_name", e.target.value)} required /></div>
            <div className="space-y-1"><Label className="text-xs">Role</Label><Input value={f.role} onChange={(e) => s("role", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Hours</Label><Input type="number" value={f.hours} onChange={(e) => s("hours", e.target.value)} required /></div>
            <div className="space-y-1"><Label className="text-xs">Rate</Label><Input type="number" value={f.rate} onChange={(e) => s("rate", e.target.value)} required /></div>
          </div>
          <Button type="submit" size="sm" disabled={addMut.isPending || !f.worker_name}><Plus className="mr-1 h-3 w-3" />Add</Button>
        </form>
        <Separator />
        <Table>
          <TableHeader><TableRow><TableHead>Worker</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {!labour.length ? (
              <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No labour entries</TableCell></TableRow>
            ) : labour.map((l: any) => (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{l.worker_name}</span>
                    {l.source === "payroll" && (
                      <Badge variant="secondary" className="text-[10px]">From payroll</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{l.role ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(l.hours)}</TableCell>
                <TableCell className="text-right font-mono">{Number(l.rate).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono font-medium">{Number(l.total_cost).toLocaleString()}</TableCell>
              </TableRow>

            ))}
          </TableBody>
        </Table>
      </CardContent>

      {/* Inline Add Employee Dialog */}
      <AddEmployeeDialog open={addEmployeeOpen} onOpenChange={setAddEmployeeOpen} />
    </Card>
  );
}

/* ── Add Employee Dialog ── */
function AddEmployeeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", role: "", phone: "", daily_rate: "" });

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("employees").insert({
        name: f.name,
        role: f.role,
        phone: f.phone || null,
        daily_rate: parseFloat(f.daily_rate) || 0,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees-active"] });
      toast({ title: "Employee registered" });
      setF({ name: "", role: "", phone: "", daily_rate: "" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Register New Employee</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div><Label>Name *</Label><Input value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></div>
          <div>
            <Label>Role *</Label>
            <Select value={f.role} onValueChange={v => setF(p => ({ ...p, role: v }))}>
              <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
              <SelectContent>
                {["welder", "electrician", "painter", "plumber", "carpenter", "driver", "supervisor", "general_worker", "mechanic"].map(r => (
                  <SelectItem key={r} value={r} className="capitalize">{r.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Phone</Label><Input value={f.phone} onChange={e => setF(p => ({ ...p, phone: e.target.value }))} /></div>
          <div><Label>Daily Rate</Label><Input type="number" value={f.daily_rate} onChange={e => setF(p => ({ ...p, daily_rate: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => addMut.mutate()} disabled={addMut.isPending || !f.name || !f.role}>Save Employee</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Tasks Tab (with employee assignment) ── */
function TasksTab({ conversionId, tasks, onSuccess }: { conversionId: string; tasks: any[]; onSuccess: () => void }) {
  const { toast } = useToast();
  const { data: employees = [] } = useEmployees();
  const [f, setF] = useState({ task_name: "", assigned_to: "" });

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("conversion_tasks").insert({
        conversion_id: conversionId,
        task_name: f.task_name,
        assigned_to: f.assigned_to || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Task added" }); setF({ task_name: "", assigned_to: "" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateTask = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const updates: Record<string, unknown> = { status };
      if (status === "in_progress") updates.start_time = new Date().toISOString();
      if (status === "completed") updates.end_time = new Date().toISOString();
      const { error } = await supabase.from("conversion_tasks").update(updates as any).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Task updated" }); },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" />Work Tasks</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label className="text-xs">Task Name</Label><Input value={f.task_name} onChange={(e) => setF((p) => ({ ...p, task_name: e.target.value }))} required /></div>
          <div className="space-y-1">
            <Label className="text-xs">Assign To</Label>
            <Select value={f.assigned_to || "__none"} onValueChange={(v) => setF(p => ({ ...p, assigned_to: v === "__none" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Unassigned —</SelectItem>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={`${e.name} (${e.role})`}>{e.name} — {e.role}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end"><Button type="submit" size="sm" disabled={addMut.isPending || !f.task_name}><Plus className="mr-1 h-3 w-3" />Add Task</Button></div>
        </form>
        <Separator />
        <Table>
          <TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Assigned</TableHead><TableHead>Status</TableHead><TableHead>Started</TableHead><TableHead>Ended</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {!tasks.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No tasks</TableCell></TableRow>
            ) : tasks.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell>{t.task_name}</TableCell>
                <TableCell className="text-muted-foreground">{t.assigned_to ?? "—"}</TableCell>
                <TableCell><Badge className={taskStatusColor[t.status] ?? ""} variant="secondary">{t.status?.replace("_", " ")}</Badge></TableCell>
                <TableCell className="text-xs">{t.start_time ? format(new Date(t.start_time), "dd MMM HH:mm") : "—"}</TableCell>
                <TableCell className="text-xs">{t.end_time ? format(new Date(t.end_time), "dd MMM HH:mm") : "—"}</TableCell>
                <TableCell className="space-x-1">
                  {t.status === "pending" && <Button size="sm" variant="outline" onClick={() => updateTask.mutate({ taskId: t.id, status: "in_progress" })}>Start</Button>}
                  {t.status === "in_progress" && <Button size="sm" variant="outline" onClick={() => updateTask.mutate({ taskId: t.id, status: "completed" })}>Done</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ── Procurement Tab (with catalog + suppliers) ── */
function ProcurementTab({ conversionId, requests, purchases, onSuccess, user }: { conversionId: string; requests: any[]; purchases: any[]; onSuccess: () => void; user: any }) {
  const { toast } = useToast();
  const { data: catalog = [] } = useMaterialCatalog();
  const { data: stockData = [] } = useMaterialStock();
  const { data: suppliers = [] } = useSuppliers();
  const { data: pickerCatalog = [] } = useMaterialCatalogWithStock();
  const [reqForm, setReqForm] = useState<{ material_id: string | null; description: string; quantity: string; needed_by: string; urgency: string }>(
    { material_id: null, description: "", quantity: "1", needed_by: "", urgency: "normal" },
  );
  const [poSupplier, setPoSupplier] = useState<Record<string, string>>({});
  const [purForm, setPurForm] = useState({ supplier_id: "", supplier: "", description: "", quantity: "1", unit_price: "" });

  const getStock = (materialId: string) => {
    const st = stockData.find((s: any) => s.material_id === materialId);
    return st ? Number(st.qty_available) : 0;
  };

  const handleReqMaterialSelect = (matId: string | null, mat: CatalogMaterial | null) => {
    setReqForm((p) => ({ ...p, material_id: matId, description: mat ? mat.name : "" }));
  };

  const handlePurMaterialSelect = (matId: string) => {
    if (matId === "__custom") {
      setPurForm(p => ({ ...p, description: "", unit_price: "" }));
      return;
    }
    const mat = catalog.find((m: any) => m.id === matId);
    if (mat) setPurForm(p => ({ ...p, description: mat.name, unit_price: String(mat.unit_cost) }));
  };

  const handleSupplierSelect = (supId: string) => {
    if (supId === "__manual") {
      setPurForm(p => ({ ...p, supplier_id: "", supplier: "" }));
      return;
    }
    const sup = suppliers.find((s: any) => s.id === supId);
    if (sup) setPurForm(p => ({ ...p, supplier_id: supId, supplier: sup.name }));
  };

  const addReq = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("raise_material_requisition", {
        _conversion_id: conversionId,
        _material_id: reqForm.material_id,
        _description: reqForm.description,
        _qty: parseFloat(reqForm.quantity) || 1,
        _needed_by: reqForm.needed_by || null,
        _urgency: reqForm.urgency,
        _note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Requisition raised" }); setReqForm({ material_id: null, description: "", quantity: "1", needed_by: "", urgency: "normal" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const decideReq = useMutation({
    mutationFn: async ({ reqId, approve }: { reqId: string; approve: boolean }) => {
      const { error } = await (supabase as any).rpc("decide_material_requisition", { _request_id: reqId, _approve: approve, _reason: null });
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Requisition updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toPo = useMutation({
    mutationFn: async (reqId: string) => {
      const supplierId = poSupplier[reqId];
      if (!supplierId) throw new Error("Pick a supplier first");
      const { error } = await (supabase as any).rpc("convert_requisition_to_po", { _request_id: reqId, _supplier_id: supplierId, _unit_price: 0 });
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Draft purchase order created", description: "Open Procurement to price and send it." }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addPurchase = useMutation({
    mutationFn: async () => {
      const qty = parseFloat(purForm.quantity) || 1;
      const price = parseFloat(purForm.unit_price) || 0;
      const { error } = await supabase.from("purchases").insert({
        conversion_id: conversionId,
        supplier: purForm.supplier,
        description: purForm.description,
        quantity: qty,
        unit_price: price,
        total_cost: qty * price,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Purchase recorded" }); setPurForm({ supplier_id: "", supplier: "", description: "", quantity: "1", unit_price: "" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      {/* Material Requests */}
      <Card>
        <CardHeader><CardTitle className="text-base">Material Requisitions</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); addReq.mutate(); }} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Material</Label>
              <MaterialPicker value={reqForm.material_id} onChange={handleReqMaterialSelect} materials={pickerCatalog as any} allowCustom />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={reqForm.description} onChange={(e) => setReqForm((p) => ({ ...p, description: e.target.value }))} required /></div>
              <div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" value={reqForm.quantity} onChange={(e) => setReqForm((p) => ({ ...p, quantity: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Needed by</Label><Input type="date" value={reqForm.needed_by} onChange={(e) => setReqForm((p) => ({ ...p, needed_by: e.target.value }))} /></div>
              <div className="space-y-1">
                <Label className="text-xs">Urgency</Label>
                <Select value={reqForm.urgency} onValueChange={(v) => setReqForm((p) => ({ ...p, urgency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end"><Button type="submit" size="sm" disabled={addReq.isPending || !reqForm.description}><Plus className="mr-1 h-3 w-3" />Raise requisition</Button></div>
            </div>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avail. then</TableHead>
                <TableHead>Needed by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!requests.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No requisitions</TableCell></TableRow>
              ) : requests.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.description}
                    {r.urgency === "urgent" && <Badge variant="destructive" className="ml-2 text-[10px]">urgent</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{Number(r.quantity)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{Number(r.qty_available_at_request ?? 0)}</TableCell>
                  <TableCell className="text-xs">{r.needed_by ? format(new Date(r.needed_by), "yyyy-MM-dd") : "—"}</TableCell>
                  <TableCell><Badge className={reqStatusColor[r.status] ?? ""} variant="secondary">{r.status}</Badge></TableCell>
                  <TableCell>
                    {r.status === "requested" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => decideReq.mutate({ reqId: r.id, approve: true })}>Approve</Button>
                        <Button size="sm" variant="ghost" onClick={() => decideReq.mutate({ reqId: r.id, approve: false })}>Reject</Button>
                      </div>
                    )}
                    {r.status === "approved" && (
                      <div className="flex flex-wrap items-center gap-1">
                        <Select value={poSupplier[r.id] ?? ""} onValueChange={(v) => setPoSupplier((p) => ({ ...p, [r.id]: v }))}>
                          <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Supplier" /></SelectTrigger>
                          <SelectContent>
                            {suppliers.map((sp: any) => <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" disabled={toPo.isPending} onClick={() => toPo.mutate(r.id)}>Create PO</Button>
                      </div>
                    )}
                    {r.status === "ordered" && r.purchase_order_id && (
                      <Button size="sm" variant="ghost" asChild><Link to="/procurement/purchase-orders">View PO</Link></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Purchases */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" />Purchases</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); addPurchase.mutate(); }} className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Supplier</Label>
                <Select value={purForm.supplier_id || "__manual"} onValueChange={handleSupplierSelect}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual">✏️ Manual</SelectItem>
                    {suppliers.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Material</Label>
                <Select onValueChange={handlePurMaterialSelect}>
                  <SelectTrigger><SelectValue placeholder="From catalog" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom">✏️ Custom</SelectItem>
                    {catalog.map((m: any) => (
                      <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit_cost}/{m.unit})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Qty</Label><Input type="number" value={purForm.quantity} onChange={(e) => setPurForm((p) => ({ ...p, quantity: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Unit Price</Label><Input type="number" value={purForm.unit_price} onChange={(e) => setPurForm((p) => ({ ...p, unit_price: e.target.value }))} required /></div>
              <div className="flex items-end"><Button type="submit" size="sm" disabled={addPurchase.isPending || !purForm.supplier}><Plus className="mr-1 h-3 w-3" />Add</Button></div>
            </div>
          </form>
          <Table>
            <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {!purchases.length ? (
                <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No purchases</TableCell></TableRow>
              ) : purchases.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{p.supplier}</TableCell>
                  <TableCell>{p.description}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.quantity)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.unit_price).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono font-medium">{Number(p.total_cost).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Services (embedded in Costs) ── */
function ServicesForm({ conversionId, onSuccess }: { conversionId: string; onSuccess: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ service_type: "transport", description: "", cost: "" });

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("conversion_services").insert({
        conversion_id: conversionId,
        service_type: f.service_type,
        description: f.description || null,
        cost: parseFloat(f.cost) || 0,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { onSuccess(); toast({ title: "Service added" }); setF({ service_type: "transport", description: "", cost: "" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }} className="grid grid-cols-4 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Type</Label>
        <Select value={f.service_type} onValueChange={(v) => setF((p) => ({ ...p, service_type: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="transport">Transport</SelectItem>
            <SelectItem value="crane">Crane</SelectItem>
            <SelectItem value="outsourced">Outsourced</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></div>
      <div className="space-y-1"><Label className="text-xs">Cost</Label><Input type="number" value={f.cost} onChange={(e) => setF((p) => ({ ...p, cost: e.target.value }))} required /></div>
      <div className="flex items-end"><Button type="submit" size="sm" disabled={addMut.isPending}><Plus className="mr-1 h-3 w-3" />Add</Button></div>
    </form>
  );
}

/* ── Costs Tab ── */
function CostsTab({ costs, conversionId, services, onSuccess, currency }: { costs: any; conversionId: string; services: any[]; onSuccess: () => void; currency?: string }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" />Services / External Costs</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ServicesForm conversionId={conversionId} onSuccess={onSuccess} />
          <Separator />
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-xs text-muted-foreground">Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {!services.length ? (
                <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No services yet</TableCell></TableRow>
              ) : services.map((sv: any) => (
                <TableRow key={sv.id}>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{sv.service_type}</Badge></TableCell>
                  <TableCell className="text-sm">{sv.description ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono font-medium">{Number(sv.cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(sv.created_at), "dd MMM yyyy")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><DollarSign className="h-4 w-4" />Auto-Computed Cost Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { label: "Container — purchase price", value: Number(costs.purchasePrice || 0), hint: "From seller acquisition invoices" },
              { label: "Container — transport & crane", value: Number(costs.transportCost || 0), hint: "From transport / offloading invoices" },
              { label: "Materials Cost", value: costs.materialsCost },
              { label: "Labour Cost", value: costs.labourCost },
              { label: "Services / External", value: costs.servicesCost },
            ].map((item) => {
              const share = costs.totalCost > 0 ? (item.value / costs.totalCost) * 100 : 0;
              return (
                <div key={item.label} className="py-2 border-b">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{item.label}</span>
                    <span className="font-mono font-medium">{fmtMoney(item.value, currency)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 mt-1">
                    <div className="h-1.5 flex-1 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(share, 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-24 text-right">{share.toFixed(1)}% of cost</span>
                  </div>
                  {item.hint && <p className="text-[10px] text-muted-foreground mt-0.5">{item.hint}</p>}
                </div>
              );
            })}
            <Separator className="my-2" />
            <div className="flex justify-between items-center py-2">
              <span className="font-semibold">Total Cost</span>
              <span className="font-mono font-bold text-lg">{fmtMoney(costs.totalCost, currency)}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm">Quoted Price (Revenue)</span>
              <span className="font-mono font-medium">{fmtMoney(costs.quotedPrice, currency)}</span>
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between items-center py-2">
              <div>
                <span className="font-semibold">Profit</span>
                <p className="text-[10px] text-muted-foreground">
                  Margin {costs.quotedPrice > 0 ? ((costs.profit / costs.quotedPrice) * 100).toFixed(1) : "0.0"}%
                </p>
              </div>
              <span className={`font-mono font-bold text-xl ${costs.profit >= 0 ? "text-success" : "text-destructive"}`}>
                {fmtMoney(costs.profit, currency)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

/* ── Invoice Tab ── */
function InvoiceTab({ job, costs }: { job: any; costs: any }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const createInvoice = useMutation({
    mutationFn: async () => {
      const num = `INV-${Date.now().toString(36).toUpperCase()}`;
      const { data, error } = await supabase.from("invoices").insert({
        invoice_number: num,
        customer_name: job.customers?.company_name ?? "Walk-in",
        container_id: job.container_id,
        invoice_type: "other" as any,
        subtotal: costs.quotedPrice,
        total_amount: costs.quotedPrice,
        created_by: user?.id,
        notes: `Conversion job ${job.conversion_number}`,
      }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Invoice created" });
      navigate("/billing/invoices");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" />Invoicing</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Customer</span><p className="font-medium">{job.customers?.company_name ?? "—"}</p></div>
          <div><span className="text-muted-foreground">Quoted Price</span><p className="font-medium">{costs.quotedPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
          <div><span className="text-muted-foreground">Total Cost</span><p className="font-medium">{costs.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
          <div><span className="text-muted-foreground">Profit</span><p className={`font-medium ${costs.profit >= 0 ? "text-success" : "text-destructive"}`}>{costs.profit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
        </div>
        <Button onClick={() => createInvoice.mutate()} disabled={createInvoice.isPending}>
          <FileText className="mr-1 h-4 w-4" />Create Invoice
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Linked Containers Card ── */
function LinkedContainersCard({ job, rows, onChanged, canEdit }: { job: any; rows: any[]; onChanged: () => void; canEdit: boolean }) {
  const { toast } = useToast();
  const { role } = useUserStaffRole();
  const isAdmin = role === "admin";
  const [changeRow, setChangeRow] = useState<any | null>(null);
  const [detachRow, setDetachRow] = useState<any | null>(null);
  const [detachReason, setDetachReason] = useState("");
  const [syncTarget, setSyncTarget] = useState<{ containerId: string | null; label: string } | null>(null);
  const [syncReason, setSyncReason] = useState("");

  const jobCurrency = job?.currency || getDefaultCurrency();
  const { data: syncRows = [] } = useConversionCostSync(job?.id);
  const syncByContainer = useMemo(() => {
    const m: Record<string, ResyncPreviewRow> = {};
    for (const r of syncRows) m[r.container_id] = r;
    return m;
  }, [syncRows]);
  const driftedRows = syncRows.filter(isDrifted);

  const detachMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("detach_container_from_conversion" as any, {
        _link_id: detachRow.id,
        _reason: detachReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Container detached" });
      setDetachRow(null); setDetachReason("");
      onChanged();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncMut = useMutation({
    mutationFn: async () =>
      resyncConversionContainerCosts({
        conversionId: job.id,
        reason: syncReason.trim(),
        containerId: syncTarget?.containerId ?? null,
      }),
    onSuccess: (res: any) => {
      toast({
        title: res?.updated ? `${res.updated} container cost${res.updated === 1 ? "" : "s"} refreshed` : "Already up to date",
        description: res?.delta_total ? `Job cost moved by ${fmtMoney(res.delta_total, jobCurrency)}${res.ledger_posted ? " — ledger adjusted" : ""}` : undefined,
      });
      setSyncTarget(null); setSyncReason("");
      onChanged();
    },
    onError: (e: any) => toast({ title: "Re-sync failed", description: e.message, variant: "destructive" }),
  });

  // Admins may correct containers on completed jobs too
  const canChange = canEdit || (isAdmin && job.status === "completed");
  const canSync = isAdmin && job.status !== "cancelled";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div>
            <p className="font-medium">Containers on this job</p>
            <p className="text-xs text-muted-foreground">{rows.length} attached · Purchase price is invoiced to each owner on completion.</p>
          </div>
          {canSync && driftedRows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => { setSyncTarget({ containerId: null, label: `all ${driftedRows.length} container(s)` }); setSyncReason(""); }}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh all from invoices
            </Button>
          )}
        </div>

        {driftedRows.length > 0 && (
          <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            <span className="font-medium">Costs out of date.</span>{" "}
            {driftedRows.length} container{driftedRows.length === 1 ? "" : "s"} no longer match their acquisition invoices, so the job cost and margin below are understated or overstated
            {canSync ? " — refresh to restate them." : " — ask an admin to refresh them."}
          </div>
        )}

        {!rows.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No containers attached yet.</p>
        ) : (
          <div className="border rounded-md divide-y">
            {rows.map((r: any) => {
              const sync = syncByContainer[r.container_id];
              const drifted = sync ? isDrifted(sync) : false;
              return (
              <div key={r.id} className="p-2 flex items-center gap-3 text-sm flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <p className="font-mono flex items-center gap-2">
                    {r.containers?.container_number ?? "—"} <span className="text-xs text-muted-foreground">({r.containers?.size}' {r.containers?.category})</span>
                    {drifted && <Badge variant="outline" className="text-[10px] border-warning text-warning">cost out of date</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Owner: {r.containers?.owner ?? "—"} · {r.containers?.status ?? "—"} · Role: {r.role ?? "member"} ·{" "}
                    <Link to={`/containers/${r.container_id}`} className="underline">acquisition invoices</Link>
                  </p>
                </div>
                <div className="text-right text-xs">
                  <div>Purchase <span className="font-mono">{fmtMoney(r.container_cost || 0, jobCurrency)}</span></div>
                  <div>Transport &amp; crane <span className="font-mono">{fmtMoney(r.transport_offloading_cost || 0, jobCurrency)}</span></div>
                  {sync?.error && <div className="text-destructive">{sync.error}</div>}
                  {drifted && (
                    <div className="text-warning">
                      Invoices: <span className="font-mono">{fmtMoney(sync!.live_purchase ?? 0, jobCurrency)}</span> +{" "}
                      <span className="font-mono">{fmtMoney(sync!.live_transport ?? 0, jobCurrency)}</span>
                      {" "}({(sync!.delta ?? 0) >= 0 ? "+" : ""}{fmtMoney(sync!.delta ?? 0, jobCurrency)})
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  {canSync && drifted && (
                    <Button size="sm" variant="outline" onClick={() => { setSyncTarget({ containerId: r.container_id, label: r.containers?.container_number ?? "container" }); setSyncReason(""); }}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
                    </Button>
                  )}
                  {canChange && (
                    <Button size="sm" variant="outline" onClick={() => setChangeRow(r)}>
                      <Repeat className="h-3.5 w-3.5 mr-1" />Change
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => { setDetachRow(r); setDetachReason(""); }}>
                      Detach
                    </Button>
                  )}
                </div>
              </div>
            );})}
          </div>
        )}
      </CardContent>

      <Dialog open={!!syncTarget} onOpenChange={(v) => { if (!v && !syncMut.isPending) { setSyncTarget(null); setSyncReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refresh container cost from acquisition invoices</DialogTitle>
            <DialogDescription>
              Restates {syncTarget?.label} using the live seller, transport and crane invoices. On a completed job the difference is posted to the ledger and the project P&amp;L.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={syncReason} onChange={(e) => setSyncReason(e.target.value)} placeholder="e.g. transport invoice raised after the job was created" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncTarget(null)} disabled={syncMut.isPending}>Cancel</Button>
            <Button onClick={() => syncMut.mutate()} disabled={!syncReason.trim() || syncMut.isPending}>
              {syncMut.isPending ? "Refreshing…" : "Refresh costs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <ChangeContainerDialog
        job={job}
        row={changeRow}
        linkedIds={rows.map((r: any) => r.container_id)}
        onClose={() => setChangeRow(null)}
        onChanged={onChanged}
      />

      <Dialog open={!!detachRow} onOpenChange={(v) => { if (!v && !detachMut.isPending) { setDetachRow(null); setDetachReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detach container</DialogTitle>
            <DialogDescription>
              Remove <span className="font-mono">{detachRow?.containers?.container_number}</span> from this job. It returns to Available stock. A reason is recorded on the job's change history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason * <span className="text-xs text-muted-foreground">(min. 10 characters)</span></Label>
            <Textarea rows={3} value={detachReason} onChange={(e) => setDetachReason(e.target.value)} placeholder="Why is this container being removed from the job?" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDetachRow(null)} disabled={detachMut.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => detachMut.mutate()} disabled={detachMut.isPending || detachReason.trim().length < 10}>
              {detachMut.isPending ? "Detaching…" : "Detach"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ── Change (swap) Container Dialog ── */
function ChangeContainerDialog({ job, row, linkedIds = [], onClose, onChanged }: { job: any; row: any | null; linkedIds?: string[]; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [containerId, setContainerId] = useState("");
  const [reason, setReason] = useState("");
  const { data: acq } = useContainerAcquisition(containerId || null);

  useEffect(() => {
    if (row) {
      setContainerId("");
      setReason("");
    }
  }, [row]);

  const { data: containers = [] } = useQuery({
    queryKey: ["swap-candidate-containers", job.organization_id, linkedIds.join(",")],
    enabled: !!row,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, category, status")
        .in("status", ["available", "allocated", "in_conversion", "hold"])
        .order("container_number");
      if (error) throw error;
      return (data ?? []).filter((c: any) => !linkedIds.includes(c.id));
    },
  });

  const swapMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("swap_conversion_container" as any, {
        _link_id: row.id,
        _new_container_id: containerId,
        _reason: reason.trim(),
        _container_cost: Number(acq?.purchase ?? 0),
        _transport_offloading_cost: Number(acq?.services ?? 0),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Container changed" });
      onClose();
      onChanged();
    },
    onError: (e: any) => toast({ title: "Change failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v && !swapMut.isPending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change container</DialogTitle>
          <DialogDescription>
            Replace <span className="font-mono">{row?.containers?.container_number ?? "—"}</span> on this job. The old container returns to Available, the new one moves to In Conversion, and the change is recorded with your reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Replacement container *</Label>
            <Select value={containerId} onValueChange={setContainerId}>
              <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
              <SelectContent>
                {containers.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.container_number} ({c.size}' {c.category})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AcquisitionCostFields containerId={containerId || null} />
          <div className="space-y-2">
            <Label>Reason * <span className="text-xs text-muted-foreground">(min. 10 characters)</span></Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the container being changed? e.g. wrong unit attached at intake" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={swapMut.isPending}>Cancel</Button>
          <Button onClick={() => swapMut.mutate()} disabled={swapMut.isPending || !containerId || reason.trim().length < 10}>
            {swapMut.isPending ? "Changing…" : "Change container"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Container change history ── */
function ContainerChangeHistory({ jobId }: { jobId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["conversion-container-audit", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversion_container_audit" as any)
        .select("id, action, reason, changed_at, new_container_cost, new_transport_offloading_cost, old:old_container_id(container_number), neu:new_container_id(container_number)")
        .eq("conversion_id", jobId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  if (!rows.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Repeat className="h-4 w-4" />Container change history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r: any) => (
          <div key={r.id} className="text-sm border rounded-md p-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="capitalize">{r.action}</Badge>
              <span className="font-mono">{r.old?.container_number ?? "—"}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-mono">{r.neu?.container_number ?? "removed"}</span>
              <span className="text-xs text-muted-foreground ml-auto">{format(new Date(r.changed_at), "dd MMM yyyy HH:mm")}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{r.reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}


/* ── Attach Container Dialog ── */
function AttachContainerDialog({ job, linkedIds = [], onAttached }: { job: any; linkedIds?: string[]; onAttached: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [containerId, setContainerId] = useState("");



  const { data: containers } = useQuery({
    queryKey: ["available-containers", linkedIds.join(",")],
    queryFn: async () => {
      const q = supabase
        .from("containers")
        .select("id, container_number, size, category")
        .in("status", ["available", "allocated", "in_conversion"])
        .order("container_number");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).filter((c: any) => !linkedIds.includes(c.id));
    },
    enabled: open,
  });

  const attachMut = useMutation({
    mutationFn: async () => {
      if (!containerId) throw new Error("Select a container");
      // Costs are derived server-side from the container's live acquisition
      // invoices, converted into the job currency — never from raw client sums.
      const { error } = await supabase.rpc("attach_container_to_conversion" as any, {
        _conversion_id: job.id,
        _container_id: containerId,
        _container_cost: null,
        _transport_offloading_cost: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Container attached to job" });
      setOpen(false);
      setContainerId("");
      onAttached();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4 mr-1" />Attach Container
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach Container</DialogTitle>
          <DialogDescription>
            Link an available container to this {job.job_kind === "split" ? "split" : "conversion"} job.
            On completion, a purchase invoice is issued to each container's owner using the purchase price below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Container *</Label>
            <Select value={containerId} onValueChange={setContainerId}>
              <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
              <SelectContent>
                {containers?.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.container_number} ({c.size}' {c.category})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AcquisitionCostFields containerId={containerId || null} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={attachMut.isPending}>Cancel</Button>
          <Button onClick={() => attachMut.mutate()} disabled={attachMut.isPending || !containerId}>
            {attachMut.isPending ? "Attaching…" : "Attach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Project link card ── */
function ProjectLinkCard({ job, onChanged, canManage }: { job: any; onChanged: () => void; canManage: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const linked = job.project_id ? { id: job.project_id, ...(job.project ?? {}) } : null;

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-link", job.organization_id],
    enabled: pickerOpen,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, code, name")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_project_from_conversion" as any, { _conversion_id: job.id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => { toast({ title: "Project created and linked" }); qc.invalidateQueries({ queryKey: ["conversion", job.id] }); onChanged(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const linkMut = useMutation({
    mutationFn: async (projectId: string | null) => {
      const { error } = await supabase.from("container_conversions").update({ project_id: projectId } as any).eq("id", job.id);
      if (error) throw error;
      if (projectId) {
        await supabase.rpc("resync_conversion_project_txns" as any, { _conversion_id: job.id });
      }
    },
    onSuccess: (_d, v) => {
      toast({ title: v ? "Project linked" : "Project unlinked" });
      setPickerOpen(false);
      setSelectedProjectId("");
      qc.invalidateQueries({ queryKey: ["conversion", job.id] });
      onChanged();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3 flex-wrap">
        <FolderKanban className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs text-muted-foreground">Finance Project</p>
          {linked?.code ? (
            <a href={`/finance/projects/${linked.id}`} className="font-medium underline hover:text-primary">
              {linked.code} — {linked.name}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">Not linked. Costs & revenue for this job will not roll up into a project P&amp;L.</p>
          )}
        </div>
        {canManage && !linked && (
          <>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Link to existing…</Button>
            <Button size="sm" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? "Creating…" : "Create project from job"}
            </Button>
          </>
        )}
        {canManage && linked && (
          <Button size="sm" variant="ghost" onClick={() => linkMut.mutate(null)} disabled={linkMut.isPending}>Unlink</Button>
        )}

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Link to existing project</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger><SelectValue placeholder="Pick a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPickerOpen(false)}>Cancel</Button>
              <Button disabled={!selectedProjectId || linkMut.isPending} onClick={() => linkMut.mutate(selectedProjectId)}>
                {linkMut.isPending ? "Linking…" : "Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

