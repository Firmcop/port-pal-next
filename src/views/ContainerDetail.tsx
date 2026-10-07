import { useState } from "react";
import { useParams, useNavigate, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Pencil, ArrowRightFromLine, Wrench, RefreshCw, ShieldAlert, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import AcquisitionCostPanel from "@/components/containers/AcquisitionCostPanel";
import AcquisitionAuditPanel from "@/components/containers/AcquisitionAuditPanel";
import { ContainerCostJourney } from "@/components/containers/ContainerCostJourney";


const allStatuses = ["available", "allocated", "damaged", "repair_pending", "in_repair", "hold", "in_conversion", "sold", "booked_for_repatriation"];
const allSizes = ["10", "20", "40", "45"];
const allCategories = ["dry", "reefer", "open_top", "flat_rack", "tank", "high_cube", "special"];

export default function ContainerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);

  const { data: container } = useQuery({
    queryKey: ["container", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("*, yard_blocks(name, block_type), depots!containers_depot_id_fkey(name), pickup_depot:depots!containers_pickup_depot_id_fkey(name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: movements } = useQuery({
    queryKey: ["container-movements", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("container_movements")
        .select("*")
        .eq("container_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: auditLog } = useQuery({
    queryKey: ["container-audit", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_audit_log")
        .select("*")
        .eq("entity_type", "container")
        .eq("entity_id", id!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: traceability } = useQuery({
    queryKey: ["container-traceability", id],
    enabled: !!id,
    queryFn: async () => {
      const [convLinks, sales] = await Promise.all([
        supabase
          .from("conversion_containers")
          .select("conversion_id, container_conversions:conversion_id(id, conversion_number, status, quote_id, quotes:quote_id(id, quote_number))")
          .eq("container_id", id!),
        supabase
          .from("container_sales")
          .select("id, sale_number, status, quote_id, quotes:quote_id(id, quote_number)")
          .eq("container_id", id!)
          .order("created_at", { ascending: false }),
      ]);
      const jobs = (convLinks.data ?? []).map((r: any) => r.container_conversions).filter(Boolean);
      // Distinct quotes across both surfaces
      const quotes = new Map<string, { id: string; quote_number: string }>();
      for (const j of jobs) if (j?.quotes) quotes.set(j.quotes.id, j.quotes);
      for (const s of sales.data ?? []) if ((s as any).quotes) quotes.set((s as any).quotes.id, (s as any).quotes);
      return { jobs, sales: sales.data ?? [], quotes: Array.from(quotes.values()) };
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase.from("containers").update(updates).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["container", id] });
      queryClient.invalidateQueries({ queryKey: ["container-audit", id] });
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      toast({ title: "Container updated" });
      setEditOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const gateOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("containers").update({
        gate_out_at: new Date().toISOString(),
        status: "allocated" as any,
      }).eq("id", id!);
      if (error) throw error;
      await supabase.from("container_movements").insert({
        container_id: id!,
        movement_type: "gate_out" as any,
        notes: "Gate out via detail page",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["container", id] });
      queryClient.invalidateQueries({ queryKey: ["container-movements", id] });
      toast({ title: "Container gated out" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openEdit = () => {
    if (!container) return;
    setEditForm({
      container_number: container.container_number ?? "",
      size: container.size?.toString() ?? "20",
      category: container.category ?? "dry",
      status: container.status,
      owner: container.owner ?? "",
      shipping_line: container.shipping_line ?? "",
      iso_type: container.iso_type ?? "",
      weight_kg: container.weight_kg?.toString() ?? "",
      tare_weight_kg: container.tare_weight_kg?.toString() ?? "",
      notes: container.notes ?? "",
    });
    setEditOpen(true);
  };

  if (!container) return <div className="p-8 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/inventory")}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-2xl font-bold font-mono">{container.container_number}</h1>
          <p className="text-muted-foreground capitalize">{container.size}' {container.category}</p>
        </div>
        <Badge variant="outline" className="ml-auto text-sm">{container.status.replace("_", " ")}</Badge>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {isOwnerOrAdmin ? (
          <>
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="mr-1 h-4 w-4" />Edit
            </Button>
            <Select onValueChange={(s) => updateMutation.mutate({ status: s as any })}>
              <SelectTrigger className="w-auto h-9 px-3">
                <RefreshCw className="mr-1 h-4 w-4" /><span className="text-sm">Change Status</span>
              </SelectTrigger>
              <SelectContent>
                {allStatuses.filter(s => s !== container.status).map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!container.gate_out_at && (
              <Button variant="outline" size="sm" onClick={() => gateOutMutation.mutate()}>
                <ArrowRightFromLine className="mr-1 h-4 w-4" />Gate Out
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate("/work-orders")}>
              <Wrench className="mr-1 h-4 w-4" />Create Work Order
            </Button>
          </>
        ) : (
          <Badge variant="secondary" className="text-xs">Read-only — contact an admin to make changes</Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Owner" value={container.owner} />
            <Row label="Shipping Line" value={container.shipping_line} />
            <Row label="ISO Type" value={container.iso_type} />
            <Row label="Weight (kg)" value={container.weight_kg?.toString()} />
            <Row label="Tare Weight (kg)" value={container.tare_weight_kg?.toString()} />
            <Row label="IMO Class" value={container.imo_class} />
            <Row label="Empty" value={container.is_empty ? "Yes" : "No"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Location</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Depot" value={(container as any).depots?.name} />
            <Row label="Block" value={(container as any).yard_blocks?.name} />
            <Row label="Bay / Row / Tier" value={container.bay ? `${container.bay} / ${container.row} / ${container.tier}` : undefined} />
            <Row label="Gate In" value={container.gate_in_at ? format(new Date(container.gate_in_at), "PPp") : undefined} />
            <Row label="Gate Out" value={container.gate_out_at ? format(new Date(container.gate_out_at), "PPp") : undefined} />
          </CardContent>
        </Card>
      </div>

      <AcquisitionCostPanel containerId={container.id} containerNumber={container.container_number} />

      <AcquisitionAuditPanel containerId={container.id} containerNumber={container.container_number} />

      <ContainerCostJourney containerId={container.id} size={container.size} />



      {(traceability?.quotes.length || traceability?.jobs.length || traceability?.sales.length) ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Traceability</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {traceability!.quotes.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Originating quote(s):</span>
                {traceability!.quotes.map((q) => (
                  <Link key={q.id} to={`/quotes/${q.id}`}>
                    <Badge variant="outline" className="hover:bg-muted cursor-pointer">{q.quote_number}</Badge>
                  </Link>
                ))}
              </div>
            )}
            {traceability!.jobs.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Conversion job(s):</span>
                {traceability!.jobs.map((j: any) => (
                  <Link key={j.id} to={`/conversions/${j.id}`}>
                    <Badge variant="secondary" className="hover:bg-muted cursor-pointer">
                      {j.conversion_number} · {j.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
            {traceability!.sales.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Sale record(s):</span>
                {traceability!.sales.map((s: any) => (
                  <Link key={s.id} to={`/container-sales?highlight=${s.id}`}>
                    <Badge variant="secondary" className="hover:bg-muted cursor-pointer">
                      {s.sale_number} · {s.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}



      <Card>
        <CardHeader><CardTitle className="text-base">Movement History</CardTitle></CardHeader>
        <CardContent>
          {!movements?.length ? (
            <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {movements.map((m) => (
                <div key={m.id} className="flex items-start gap-3 border-b pb-3 last:border-0">
                  <div className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium text-sm capitalize">{m.movement_type.replace("_", " ")}</div>
                    {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">{format(new Date(m.created_at), "PPp")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />Change History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!auditLog?.length ? (
            <p className="text-sm text-muted-foreground">No edits recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {auditLog.map((a: any) => {
                const changed = a.summary && typeof a.summary === "object" ? a.summary : {};
                const keys = Object.keys(changed).filter(k => k !== "created" && k !== "deleted");
                return (
                  <div key={a.id} className="border-b pb-3 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="capitalize">{a.action}</Badge>
                        <span className="font-medium">{a.actor_email ?? "system"}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{format(new Date(a.created_at), "PPp")}</span>
                    </div>
                    {a.action === "update" && keys.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {keys.map((k) => {
                          const diff = changed[k] ?? {};
                          const from = diff?.from ?? "—";
                          const to = diff?.to ?? "—";
                          return (
                            <div key={k} className="text-xs flex flex-wrap items-center gap-2 pl-1">
                              <span className="font-mono text-muted-foreground">{k}:</span>
                              <span className="line-through text-destructive/80 break-all">{JSON.stringify(from)}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-success break-all">{JSON.stringify(to)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit {container.container_number}</DialogTitle></DialogHeader>
          {editForm && (
            <form onSubmit={(e) => {
              e.preventDefault();
              const { weight_kg, tare_weight_kg, size, ...rest } = editForm;
              updateMutation.mutate({
                ...rest,
                size: size ? parseInt(size, 10) : null,
                weight_kg: weight_kg ? parseFloat(weight_kg) : null,
                tare_weight_kg: tare_weight_kg ? parseFloat(tare_weight_kg) : null,
              });
            }} className="space-y-4">
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Changes are logged with your name and the previous values. Correct typos here — do not use this to reassign a physical container.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label>Container Number</Label>
                <Input
                  value={editForm.container_number}
                  onChange={(e) => setEditForm((f: any) => ({ ...f, container_number: e.target.value.toUpperCase() }))}
                  placeholder="MSCU1234567"
                  className="font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Size (ft)</Label>
                  <Select value={editForm.size} onValueChange={(v) => setEditForm((f: any) => ({ ...f, size: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allSizes.map(s => <SelectItem key={s} value={s}>{s}ft</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={editForm.category} onValueChange={(v) => setEditForm((f: any) => ({ ...f, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allCategories.map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editForm.status} onValueChange={(v) => setEditForm((f: any) => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allStatuses.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ISO Type</Label>
                  <Input value={editForm.iso_type} onChange={(e) => setEditForm((f: any) => ({ ...f, iso_type: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Owner</Label>
                  <Input value={editForm.owner} onChange={(e) => setEditForm((f: any) => ({ ...f, owner: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Shipping Line</Label>
                  <Input value={editForm.shipping_line} onChange={(e) => setEditForm((f: any) => ({ ...f, shipping_line: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Weight (kg)</Label>
                  <Input type="number" value={editForm.weight_kg} onChange={(e) => setEditForm((f: any) => ({ ...f, weight_kg: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Tare Weight (kg)</Label>
                  <Input type="number" value={editForm.tare_weight_kg} onChange={(e) => setEditForm((f: any) => ({ ...f, tare_weight_kg: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={editForm.notes} onChange={(e) => setEditForm((f: any) => ({ ...f, notes: e.target.value }))} />
              </div>
              <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}
