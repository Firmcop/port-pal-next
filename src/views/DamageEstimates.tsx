import { getOrgCurrency } from "@/lib/app-settings";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, CheckCircle, XCircle, Printer } from "lucide-react";
import { printDamageEstimate } from "@/lib/document-templates";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  revised: "bg-info/15 text-info border-info/30",
};

function generateNumber(prefix: string) {
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

export default function DamageEstimates() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: estimates, isLoading } = useQuery({
    queryKey: ["damage-estimates", search, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("damage_estimates")
        .select("*, containers(container_number), inspections(inspection_number)")
        .order("created_at", { ascending: false });
      if (search) q = q.ilike("estimate_number", `%${search}%`);
      if (statusFilter !== "all") q = q.eq("approval_status", statusFilter as any);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: inspections } = useQuery({
    queryKey: ["inspections-for-estimate"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspections")
        .select("id, inspection_number, container_id, containers(container_number)")
        .eq("requires_repair", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-for-estimate"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number").order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const createEstimate = useMutation({
    mutationFn: async (form: any) => {
      const totalCost = parseFloat(form.labor_cost || 0) + parseFloat(form.material_cost || 0);
      const payload = {
        ...form,
        estimate_number: generateNumber("EST"),
        total_cost: totalCost,
        labor_hours: parseFloat(form.labor_hours || 0),
        labor_cost: parseFloat(form.labor_cost || 0),
        material_cost: parseFloat(form.material_cost || 0),
        created_by: user?.id,
      };
      if (!payload.inspection_id) delete payload.inspection_id;
      if (!payload.container_id) delete payload.container_id;
      const { error } = await supabase.from("damage_estimates").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["damage-estimates"] });
      toast({ title: "Estimate created" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateApproval = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const update: any = { approval_status: status };
      if (status === "approved") {
        update.approved_by = user?.id;
        update.approved_at = new Date().toISOString();
      }
      if (reason) update.rejection_reason = reason;
      const { error } = await supabase.from("damage_estimates").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["damage-estimates"] });
      toast({ title: "Approval status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<any>({
    inspection_id: "",
    container_id: "",
    description: "",
    repair_type: "structural",
    labor_hours: "",
    labor_cost: "",
    material_cost: "",
    currency: getOrgCurrency(),
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleInspectionSelect = (inspId: string) => {
    const insp = inspections?.find((i: any) => i.id === inspId);
    if (insp) {
      set("inspection_id", inspId);
      set("container_id", insp.container_id ?? "");
    }
  };

  const pendingCount = estimates?.filter((e: any) => e.approval_status === "pending").length ?? 0;
  const totalValue = estimates?.reduce((sum: number, e: any) => sum + parseFloat(e.total_cost || 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Damage Estimates</h1>
          <p className="text-muted-foreground">
            {pendingCount} pending · €{totalValue.toLocaleString()} total value
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />New Estimate</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Damage Estimate</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createEstimate.mutate(form); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Link to Inspection</Label>
                <Select onValueChange={handleInspectionSelect}>
                  <SelectTrigger><SelectValue placeholder="Select inspection (repair required)" /></SelectTrigger>
                  <SelectContent>
                    {inspections?.map((i: any) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.inspection_number} — {i.containers?.container_number ?? "N/A"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Container</Label>
                  <Select value={form.container_id} onValueChange={(v) => set("container_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                    <SelectContent>
                      {containers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.container_number}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Repair Type</Label>
                  <Select value={form.repair_type} onValueChange={(v) => set("repair_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="structural">Structural</SelectItem>
                      <SelectItem value="cosmetic">Cosmetic</SelectItem>
                      <SelectItem value="mechanical">Mechanical</SelectItem>
                      <SelectItem value="electrical">Electrical</SelectItem>
                      <SelectItem value="reefer">Reefer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description *</Label>
                <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} required placeholder="Describe the damage and required repair..." />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Labor Hours</Label>
                  <Input type="number" step="0.5" min="0" value={form.labor_hours} onChange={(e) => set("labor_hours", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Labor Cost (€)</Label>
                  <Input type="number" step="0.01" min="0" value={form.labor_cost} onChange={(e) => set("labor_cost", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Material Cost (€)</Label>
                  <Input type="number" step="0.01" min="0" value={form.material_cost} onChange={(e) => set("material_cost", e.target.value)} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createEstimate.isPending}>Create Estimate</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search estimate number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="revised">Revised</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estimate #</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={7} />
              ) : !estimates?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No estimates found</TableCell></TableRow>
              ) : (
                estimates.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm font-medium">{e.estimate_number}</TableCell>
                    <TableCell className="font-mono text-sm">{e.containers?.container_number ?? "—"}</TableCell>
                    <TableCell className="capitalize text-sm">{e.repair_type}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{e.description}</TableCell>
                    <TableCell className="text-right font-mono text-sm">€{parseFloat(e.total_cost).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[e.approval_status] ?? ""}>
                        {e.approval_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {e.approval_status === "pending" && (
                          <>
                            <Button size="sm" variant="outline" className="text-success" onClick={() => updateApproval.mutate({ id: e.id, status: "approved" })}>
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => updateApproval.mutate({ id: e.id, status: "rejected", reason: "Needs revision" })}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => printDamageEstimate({
                          estimate_number: e.estimate_number,
                          description: e.description,
                          repair_type: e.repair_type,
                          approval_status: e.approval_status,
                          labor_hours: parseFloat(e.labor_hours ?? 0),
                          labor_cost: parseFloat(e.labor_cost ?? 0),
                          material_cost: parseFloat(e.material_cost ?? 0),
                          total_cost: parseFloat(e.total_cost ?? 0),
                          currency: e.currency,
                          created_at: e.created_at,
                          approved_at: e.approved_at,
                          rejection_reason: e.rejection_reason,
                          container_number: e.containers?.container_number,
                          inspection_number: e.inspections?.inspection_number,
                        })}>
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
