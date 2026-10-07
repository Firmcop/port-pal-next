import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  open: "bg-info/15 text-info border-info/30",
  in_progress: "bg-warning/15 text-warning border-warning/30",
  on_hold: "bg-gray-500/15 text-gray-700 border-gray-300",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
};

const priorityColors: Record<string, string> = {
  low: "bg-gray-500/15 text-gray-700 border-gray-300",
  medium: "bg-info/15 text-info border-info/30",
  high: "bg-warning/15 text-warning border-warning/30",
  urgent: "bg-destructive/15 text-destructive border-destructive/30",
};

function generateNumber(prefix: string) {
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}

export default function WorkOrders() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: workOrders, isLoading } = useQuery({
    queryKey: ["work-orders", search, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("work_orders")
        .select("*, containers(container_number), damage_estimates(estimate_number, total_cost)")
        .order("created_at", { ascending: false });
      if (search) q = q.ilike("wo_number", `%${search}%`);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: approvedEstimates } = useQuery({
    queryKey: ["approved-estimates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("damage_estimates")
        .select("id, estimate_number, container_id, total_cost, containers(container_number)")
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-for-wo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number").order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const createWorkOrder = useMutation({
    mutationFn: async (form: any) => {
      const payload = {
        ...form,
        wo_number: generateNumber("WO"),
        created_by: user?.id,
      };
      if (!payload.estimate_id) delete payload.estimate_id;
      if (!payload.container_id) delete payload.container_id;
      const { error } = await supabase.from("work_orders").insert(payload);
      if (error) throw error;
      // Update container to in_repair
      if (form.container_id) {
        await supabase.from("containers").update({ status: "in_repair" as any }).eq("id", form.container_id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      toast({ title: "Work order created" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, container_id, completion_notes }: { id: string; status: string; container_id?: string; completion_notes?: string }) => {
      const update: any = { status };
      if (status === "in_progress") update.started_at = new Date().toISOString();
      if (status === "completed") {
        update.completed_at = new Date().toISOString();
        if (completion_notes) update.completion_notes = completion_notes;
        // Mark container as available again
        if (container_id) {
          await supabase.from("containers").update({ status: "available" as any }).eq("id", container_id);
        }
      }
      const { error } = await supabase.from("work_orders").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      toast({ title: "Work order updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<any>({
    estimate_id: "",
    container_id: "",
    assigned_to: "",
    priority: "medium",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleEstimateSelect = (estId: string) => {
    const est = approvedEstimates?.find((e: any) => e.id === estId);
    if (est) {
      set("estimate_id", estId);
      set("container_id", est.container_id ?? "");
    }
  };

  const openCount = workOrders?.filter((w: any) => w.status === "open" || w.status === "in_progress").length ?? 0;
  const urgentCount = workOrders?.filter((w: any) => w.priority === "urgent" && w.status !== "completed" && w.status !== "cancelled").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.work_orders")}</h1>
          <p className="text-muted-foreground">
            {openCount} active · {urgentCount} urgent
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" />New Work Order</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Work Order</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createWorkOrder.mutate(form); }} className="space-y-4">
              <div className="space-y-2">
                <Label>From Approved Estimate</Label>
                <Select onValueChange={handleEstimateSelect}>
                  <SelectTrigger><SelectValue placeholder="Select approved estimate" /></SelectTrigger>
                  <SelectContent>
                    {approvedEstimates?.map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.estimate_number} — {e.containers?.container_number ?? "N/A"} (€{parseFloat(e.total_cost).toLocaleString()})
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
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Assigned To</Label>
                <Input value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)} placeholder="Technician or team name" />
              </div>
              <Button type="submit" className="w-full" disabled={createWorkOrder.isPending}>Create Work Order</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search work order number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>WO #</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Estimate</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={7} />
              ) : !workOrders?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No work orders found</TableCell></TableRow>
              ) : (
                workOrders.map((w: any) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-sm font-medium">{w.wo_number}</TableCell>
                    <TableCell className="font-mono text-sm">{w.containers?.container_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{w.damage_estimates?.estimate_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{w.assigned_to ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={priorityColors[w.priority] ?? ""}>{w.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[w.status] ?? ""}>{w.status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      {w.status === "open" && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: w.id, status: "in_progress" })}>
                          Start
                        </Button>
                      )}
                      {w.status === "in_progress" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: w.id, status: "completed", container_id: w.container_id })}>
                            Complete
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: w.id, status: "on_hold" })}>
                            Hold
                          </Button>
                        </div>
                      )}
                      {w.status === "on_hold" && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: w.id, status: "in_progress" })}>
                          Resume
                        </Button>
                      )}
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
