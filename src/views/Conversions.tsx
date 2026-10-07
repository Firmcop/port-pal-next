import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { supabase } from "@/integrations/supabase/client";
import AcquisitionCostFields from "@/components/containers/AcquisitionCostFields";
import { useContainerAcquisition } from "@/hooks/use-container-acquisition";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Hammer, MoreHorizontal, FolderKanban, FolderPlus, Link2Off, Pencil, RefreshCw } from "lucide-react";
import { OrgVarianceWidget } from "@/components/conversions/ConversionExtras";
import { EditConversionRevenueDialog } from "@/components/conversions/EditConversionRevenueDialog";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { useAllConversionCostSync, isDrifted } from "@/hooks/use-conversion-cost-sync";

import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const PRODUCT_TYPES = ["office", "home", "coldroom", "workshop", "ablution", "guard_house", "steel_structure", "fabrication", "other"] as const;
const JOB_KINDS = [
  { value: "product", label: "Finished Product (office, cold room, bitutainer…)" },
  { value: "split", label: "Container Split (e.g. 40' HC → 2× 20')" },
  { value: "sub_assembly", label: "Sub-assembly (door, frame, panel…)" },
] as const;
const ASSEMBLY_TYPES = ["door","window_frame","panel","electrical_kit","plumbing_kit","insulation_pack","other"] as const;

const kindColor: Record<string, string> = {
  product: "bg-info/15 text-info",
  split: "bg-warning/15 text-warning",
  sub_assembly: "bg-primary/15 text-primary",
};

const statusColor: Record<string, string> = {
  planning: "bg-info/15 text-info",
  in_progress: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

export default function Conversions() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Fetch conversions with sub-table cost totals
  const { data: conversions, isLoading } = useQuery({
    queryKey: ["conversions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("container_conversions")
        .select("*, containers(container_number), customers:customer_id(company_name), sales_orders:sales_order_id(order_number), project:project_id(id, code)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch cost summaries for each conversion
  const { data: costMap } = useQuery({
    queryKey: ["conversion-cost-summaries"],
    queryFn: async () => {
      const [materials, labour, services, linked] = await Promise.all([
        supabase.from("conversion_materials").select("conversion_id, total_cost"),
        supabase.from("conversion_labour").select("conversion_id, total_cost"),
        supabase.from("conversion_services").select("conversion_id, cost"),
        supabase.from("conversion_containers" as any).select("conversion_id, container_id, container_cost, transport_offloading_cost"),
      ]);
      const map: Record<string, { materials: number; labour: number; services: number; containers: number; containerIds: Set<string> }> = {};
      const add = (id: string) => { if (!map[id]) map[id] = { materials: 0, labour: 0, services: 0, containers: 0, containerIds: new Set() }; };
      materials.data?.forEach((m: any) => { add(m.conversion_id); map[m.conversion_id].materials += Number(m.total_cost); });
      labour.data?.forEach((l: any) => { add(l.conversion_id); map[l.conversion_id].labour += Number(l.total_cost); });
      services.data?.forEach((s: any) => { add(s.conversion_id); map[s.conversion_id].services += Number(s.cost); });
      (linked.data as any[])?.forEach((r: any) => {
        add(r.conversion_id);
        map[r.conversion_id].containers += Number(r.container_cost || 0) + Number(r.transport_offloading_cost || 0);
        if (r.container_id) map[r.conversion_id].containerIds.add(r.container_id);
      });
      return map;
    },
  });


  const { data: containers } = useQuery({
    queryKey: ["available-containers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, category")
        .in("status", ["available", "allocated"])
        .order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name");
      if (error) throw error;
      return data;
    },
  });

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [slugFilter, setSlugFilter] = useState<string>("__all");

  const slugOptions = useMemo(() => {
    const counts = new Map<string, number>();
    (conversions ?? []).forEach((c: any) => {
      const parts = String(c.conversion_number ?? "").split("-");
      if (parts.length >= 3 && parts[0] === "CNV" && parts[1]) {
        counts.set(parts[1], (counts.get(parts[1]) ?? 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([slug, count]) => ({ slug, count }));
  }, [conversions]);

  const topChips = slugOptions.slice(0, 8);
  const filtersActive = search.trim() !== "" || slugFilter !== "__all";
  const clearFilters = () => { setSearch(""); setSlugFilter("__all"); };



  const filteredConversions = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (conversions ?? []).filter((c: any) => {
      const num = String(c.conversion_number ?? "").toUpperCase();
      const slug = num.split("-")[1] ?? "";
      const custName = String((c.customers as any)?.company_name ?? "").toUpperCase();
      if (slugFilter !== "__all" && slug !== slugFilter) return false;
      if (!q) return true;
      return num.includes(q) || slug.includes(q) || custName.includes(q);
    });
  }, [conversions, search, slugFilter]);

  const [form, setForm] = useState({
    job_kind: "product" as "product" | "split" | "sub_assembly",
    container_id: "",
    customer_id: "",
    product_type: "office" as typeof PRODUCT_TYPES[number],
    assembly_type: "door" as typeof ASSEMBLY_TYPES[number],
    description: "",
    quoted_price: "",
    budget_amount: "",
    container_cost: "",
    transport_offloading_cost: "",
    qty_produced: "1",
    unit_of_measure: "pcs",
    start_date: "",
    end_date: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const { data: acq } = useContainerAcquisition(form.container_id || null);
  const resetForm = () => setForm({ job_kind: "product", container_id: "", customer_id: "", product_type: "office", assembly_type: "door", description: "", quoted_price: "", budget_amount: "", container_cost: "", transport_offloading_cost: "", qty_produced: "1", unit_of_measure: "pcs", start_date: "", end_date: "" });


  const createMut = useMutation({
    mutationFn: async () => {
      const payload: any = {

        job_kind: form.job_kind,
        container_id: form.container_id || null,
        customer_id: form.customer_id || null,
        product_type: form.product_type,
        description: form.description,
        quoted_price: parseFloat(form.quoted_price) || 0,
        budget_amount: parseFloat(form.budget_amount) || 0,
        container_cost: Number(acq?.purchase ?? 0),
        transport_offloading_cost: Number(acq?.services ?? 0),
        qty_produced: parseFloat(form.qty_produced) || 1,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        created_by: user?.id,
      };
      if (form.job_kind === "sub_assembly") {
        payload.assembly_type = form.assembly_type;
        payload.unit_of_measure = form.unit_of_measure || "pcs";
        payload.container_id = null;
      }
      const { error } = await supabase.from("container_conversions").insert(payload);
      if (error) throw error;
      if (form.container_id && form.job_kind !== "sub_assembly") {
        await supabase.from("containers").update({ status: "in_conversion" as any }).eq("id", form.container_id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversions"] });
      qc.invalidateQueries({ queryKey: ["available-containers"] });
      toast({ title: "Conversion job created" });
      setOpen(false);
      resetForm();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });


  const getTotalCost = (c: any) => {
    const costs = costMap?.[c.id] ?? { materials: 0, labour: 0, services: 0, containers: 0, containerIds: new Set<string>() };
    const legacyInJoin = c.container_id && costs.containerIds?.has?.(c.container_id);
    const legacyContainers = legacyInJoin ? 0 : Number(c.container_cost || 0) + Number(c.transport_offloading_cost || 0);
    return costs.containers + legacyContainers + costs.materials + costs.labour + costs.services;
  };

  // Link-to-project state
  const [linkJob, setLinkJob] = useState<any | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [revenueJob, setRevenueJob] = useState<any | null>(null);
  const { isOwnerOrAdmin } = useUserStaffRole();
  const { data: driftRows = [] } = useAllConversionCostSync(isOwnerOrAdmin);
  const driftCount = driftRows.filter(isDrifted).length;


  const { data: projectsList = [] } = useQuery({
    queryKey: ["projects-for-link-conversions"],
    enabled: !!linkJob,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, code, name")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const linkMut = useMutation({
    mutationFn: async ({ jobId, projectId }: { jobId: string; projectId: string | null }) => {
      const { error } = await supabase.from("container_conversions").update({ project_id: projectId } as any).eq("id", jobId);
      if (error) throw error;
      if (projectId) {
        await supabase.rpc("resync_conversion_project_txns" as any, { _conversion_id: jobId });
      }
    },
    onSuccess: (_d, v) => {
      toast({ title: v.projectId ? "Project linked" : "Project unlinked" });
      setLinkJob(null);
      setSelectedProjectId("");
      qc.invalidateQueries({ queryKey: ["conversions"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const createProjectMut = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.rpc("create_project_from_conversion" as any, { _conversion_id: jobId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({ title: "Project created and linked" });
      qc.invalidateQueries({ queryKey: ["conversions"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });



  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Hammer className="h-6 w-6" />{t("nav.conversion_jobs")}</h1>
          <p className="text-muted-foreground">Manufacturing, procurement & costing for container conversions</p>
        </div>
        <div className="flex items-center gap-2">
        {isOwnerOrAdmin && (
          <Button variant="outline" onClick={() => navigate("/conversions/cost-sync")}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Cost alignment{driftCount ? ` (${driftCount})` : ""}
          </Button>
        )}
        <Dialog open={open} onOpenChange={setOpen}>

          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />New Job</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Conversion Job</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Job Kind</Label>
                <Select value={form.job_kind} onValueChange={(v) => set("job_kind", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{JOB_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {form.job_kind !== "sub_assembly" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{form.job_kind === "split" ? "Source Container" : "Container (optional)"}</Label>
                    <Select value={form.container_id} onValueChange={(v) => set("container_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                      <SelectContent>{containers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.container_number} ({c.size}' {c.category})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Customer (optional)</Label>
                    <Select value={form.customer_id} onValueChange={(v) => set("customer_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {form.job_kind === "product" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Product Type</Label>
                    <Select value={form.product_type} onValueChange={(v) => set("product_type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PRODUCT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Qty Produced</Label><Input type="number" min="1" value={form.qty_produced} onChange={(e) => set("qty_produced", e.target.value)} /></div>
                </div>
              )}

              {form.job_kind === "sub_assembly" && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Assembly Type</Label>
                    <Select value={form.assembly_type} onValueChange={(v) => set("assembly_type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ASSEMBLY_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>UoM</Label><Input value={form.unit_of_measure} onChange={(e) => set("unit_of_measure", e.target.value)} /></div>
                  <div className="space-y-2"><Label>Qty Produced</Label><Input type="number" min="1" value={form.qty_produced} onChange={(e) => set("qty_produced", e.target.value)} /></div>
                </div>
              )}

              {form.job_kind !== "sub_assembly" && (
                <AcquisitionCostFields containerId={form.container_id || null} />
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Quoted Price</Label><Input type="number" value={form.quoted_price} onChange={(e) => set("quoted_price", e.target.value)} placeholder="0" /></div>
                <div className="space-y-2">
                  <Label>Budget (intended cost)</Label>
                  <Input type="number" required value={form.budget_amount} onChange={(e) => set("budget_amount", e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-2 flex flex-col justify-end"><p className="text-xs text-muted-foreground">Container total: <strong>{(Number(acq?.purchase ?? 0) + Number(acq?.services ?? 0)).toLocaleString(undefined,{minimumFractionDigits:2})}</strong></p></div>
              </div>

              <p className="text-xs text-muted-foreground -mt-2">Planned material lines (BOM) are added on the job's <strong>Budget</strong> tab; planned quantities then auto-fill when you add materials.</p>
              <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="h-16" placeholder={form.job_kind === "sub_assembly" ? "Used as the SKU name in stock" : ""} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
                <div className="space-y-2"><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
              </div>
              {form.job_kind === "split" && (
                <p className="text-xs text-muted-foreground rounded-md bg-muted/40 p-2">
                  After creating, open the job's <strong>Outputs</strong> tab to define the planned child containers (10/20/30/40/45'). On completion they are auto-numbered with your depot prefix and registered to your organization — ready for further conversion, sale or lease.
                </p>
              )}
              <Button type="submit" className="w-full" disabled={createMut.isPending || (form.job_kind === "split" && !form.container_id) || (form.job_kind === "sub_assembly" && !form.description)}>Create Job</Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>


      <OrgVarianceWidget />

      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <Input
              placeholder="Search by CNV number or customer (e.g. CNV-ACME or ACME)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="md:max-w-sm"
            />
            <Select value={slugFilter} onValueChange={setSlugFilter}>
              <SelectTrigger className="md:w-56"><SelectValue placeholder="Customer prefix" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All customers</SelectItem>
                {slugOptions.map(({ slug, count }) => (
                  <SelectItem key={slug} value={slug}>CNV-{slug}-…  ({count})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{filteredConversions.length} of {conversions?.length ?? 0}</span>
                <Button variant="outline" size="sm" className="h-7" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          {topChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSlugFilter("__all")}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  slugFilter === "__all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted/40 hover:bg-muted"
                }`}
              >
                All
              </button>
              {topChips.map(({ slug, count }) => {
                const active = slugFilter === slug;
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => setSlugFilter(active ? "__all" : slug)}
                    className={`rounded-full border px-2.5 py-0.5 font-mono text-xs transition ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted/40 hover:bg-muted"
                    }`}
                    title={`${count} job${count === 1 ? "" : "s"}`}
                  >
                    CNV-{slug} <span className="opacity-70">·{count}</span>
                  </button>
                );
              })}
              {slugOptions.length > topChips.length && (
                <span className="self-center text-xs text-muted-foreground">
                  +{slugOptions.length - topChips.length} more (use dropdown)
                </span>
              )}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job No</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Product / Assembly</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filteredConversions.length ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">{conversions?.length ? "No jobs match your filter" : "No conversion jobs yet"}</TableCell></TableRow>
              ) : filteredConversions.map((c: any) => {
                const totalCost = getTotalCost(c);
                const revenue = Number(c.quoted_price || 0);
                const profit = revenue - totalCost;
                const kind = c.job_kind ?? "product";
                const hasProject = !!(c as any).project?.code;
                return (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/conversions/${c.id}`)}>
                    <TableCell className="font-mono text-xs">{c.conversion_number}</TableCell>
                    <TableCell><Badge className={kindColor[kind] ?? ""} variant="secondary">{kind.replace("_"," ")}</Badge></TableCell>
                    <TableCell>{(c.customers as any)?.company_name ?? "—"}</TableCell>
                    <TableCell className="font-medium">{c.containers?.container_number ?? "—"}</TableCell>
                    <TableCell className="capitalize">{kind === "sub_assembly" ? c.assembly_type?.replace("_"," ") : c.product_type?.replace("_", " ")}</TableCell>
                    <TableCell><Badge className={statusColor[c.status] ?? ""} variant="secondary">{c.status?.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right font-mono">{revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${profit >= 0 ? "text-success" : "text-destructive"}`}>
                      {profit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-xs">
                      {hasProject ? (
                        <a onClick={(e) => e.stopPropagation()} href={`/finance/projects/${(c as any).project.id}`} className="font-mono underline hover:text-primary">{(c as any).project.code}</a>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), "dd MMM yyyy")}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isOwnerOrAdmin && c.status !== "cancelled" && (
                            <DropdownMenuItem onClick={() => setRevenueJob(c)}>
                              <Pencil className="h-4 w-4 mr-2" />Edit revenue…
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { setSelectedProjectId(c.project_id ?? ""); setLinkJob(c); }}>
                            <FolderKanban className="h-4 w-4 mr-2" />{hasProject ? "Change project…" : "Link to project…"}
                          </DropdownMenuItem>
                          {!hasProject && (
                            <DropdownMenuItem onClick={() => createProjectMut.mutate(c.id)} disabled={createProjectMut.isPending}>
                              <FolderPlus className="h-4 w-4 mr-2" />Create project from job
                            </DropdownMenuItem>
                          )}
                          {hasProject && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => linkMut.mutate({ jobId: c.id, projectId: null })}
                                className="text-destructive focus:text-destructive"
                              >
                                <Link2Off className="h-4 w-4 mr-2" />Unlink project
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!linkJob} onOpenChange={(o) => { if (!o) { setLinkJob(null); setSelectedProjectId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link {linkJob?.conversion_number} to project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Finance Project</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger><SelectValue placeholder="Pick a project" /></SelectTrigger>
                <SelectContent>
                  {projectsList.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projectsList.length === 0 && (
                <p className="text-xs text-muted-foreground">No projects yet. Use "Create project from job" instead.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setLinkJob(null); setSelectedProjectId(""); }}>Cancel</Button>
              <Button
                disabled={!selectedProjectId || linkMut.isPending}
                onClick={() => linkJob && linkMut.mutate({ jobId: linkJob.id, projectId: selectedProjectId })}
              >
                {linkMut.isPending ? "Linking…" : "Link project"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {revenueJob && (
        <EditConversionRevenueDialog
          open={!!revenueJob}
          onOpenChange={(o) => { if (!o) setRevenueJob(null); }}
          job={revenueJob}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["conversions"] });
            qc.invalidateQueries({ queryKey: ["project-pnl"] });
            qc.invalidateQueries({ queryKey: ["project-job-costs"] });
          }}
        />
      )}
    </div>
  );
}
