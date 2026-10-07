import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Layers, Hammer, ShoppingCart, ListTree, Trash2, FileText, Scale } from "lucide-react";
import { StockAdjustmentDialog } from "@/components/inventory/StockAdjustmentDialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const TYPES = ["door","window_frame","panel","electrical_kit","plumbing_kit","insulation_pack","other"] as const;
const fmt = (n: any) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });

function useProjects() {
  return useQuery({
    queryKey: ["sa-projects"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects").select("id, code, name, status").eq("status", "active").order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

const NONE = "__none__";

export default function SubAssemblyStock() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adjustFor, setAdjustFor] = useState<any | null>(null);
  const { data: projects = [] } = useProjects();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["sub-assembly-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_stock" as any).select("*, project:project_id(id, code, name)").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ assembly_type: "door", name: "", uom: "pcs", reorder_point: "0", default_sale_price: "", project_id: NONE });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const createMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sub_assembly_stock" as any).insert({
        assembly_type: f.assembly_type,
        name: f.name,
        uom: f.uom,
        reorder_point: parseFloat(f.reorder_point) || 0,
        default_sale_price: f.default_sale_price ? parseFloat(f.default_sale_price) : null,
        project_id: f.project_id === NONE ? null : f.project_id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sub-assembly-stock"] }); toast({ title: "SKU created" }); setOpen(false); setF({ assembly_type: "door", name: "", uom: "pcs", reorder_point: "0", default_sale_price: "", project_id: NONE }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });


  const [bomFor, setBomFor] = useState<any>(null);
  const [buildFor, setBuildFor] = useState<any>(null);
  const [sellFor, setSellFor] = useState<any>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="h-6 w-6" />Sub-assemblies</h1>
          <p className="text-muted-foreground">BOM-driven build, stock, and direct sale of doors, frames, panels and kits</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />New SKU</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Sub-assembly SKU</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
              <div className="space-y-2">
                <Label>Assembly Type</Label>
                <Select value={f.assembly_type} onValueChange={(v) => set("assembly_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace("_"," ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} required placeholder="e.g. Standard 20' personnel door" /></div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2"><Label>UoM</Label><Input value={f.uom} onChange={(e) => set("uom", e.target.value)} /></div>
                <div className="space-y-2"><Label>Reorder Pt</Label><Input type="number" value={f.reorder_point} onChange={(e) => set("reorder_point", e.target.value)} /></div>
                <div className="space-y-2"><Label>Sale Price</Label><Input type="number" value={f.default_sale_price} onChange={(e) => set("default_sale_price", e.target.value)} placeholder="optional" /></div>
              </div>
              <div className="space-y-2">
                <Label>Project (optional)</Label>
                <Select value={f.project_id} onValueChange={(v) => set("project_id", v)}>
                  <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No project</SelectItem>
                    {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Used as the default project for builds of this SKU.</p>
              </div>

              <Button type="submit" className="w-full" disabled={createMut.isPending || !f.name}>Create</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock & BOM</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>UoM</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">BOM Cost</TableHead>
                    <TableHead className="text-right">Avg Cost</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : !items.length ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No SKUs yet</TableCell></TableRow>
                  ) : items.map((it: any) => {
                    const low = Number(it.on_hand_qty) <= Number(it.reorder_point);
                    return (
                      <TableRow key={it.id}>
                        <TableCell className="capitalize">{it.assembly_type?.replace("_"," ")}</TableCell>
                        <TableCell className="font-medium">{it.name}</TableCell>
                        <TableCell>
                          <Select
                            value={it.project_id ?? NONE}
                            onValueChange={async (v) => {
                              const { error } = await (supabase as any).from("sub_assembly_stock")
                                .update({ project_id: v === NONE ? null : v }).eq("id", it.id);
                              if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
                              else { toast({ title: "Project updated" }); qc.invalidateQueries({ queryKey: ["sub-assembly-stock"] }); }
                            }}
                          >
                            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="No project" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No project</SelectItem>
                              {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{it.uom}</TableCell>

                        <TableCell className="text-right font-mono">{Number(it.on_hand_qty).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(it.bom_unit_cost)}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(it.avg_unit_cost)}</TableCell>
                        <TableCell className="text-right font-mono">{it.default_sale_price != null ? fmt(it.default_sale_price) : "—"}</TableCell>
                        <TableCell>{low ? <Badge variant="destructive">Low</Badge> : <Badge variant="secondary">OK</Badge>}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="outline" onClick={() => setBomFor(it)}><ListTree className="h-3 w-3 mr-1" />BOM</Button>
                            <Button size="sm" variant="outline" onClick={() => setBuildFor(it)}><Hammer className="h-3 w-3 mr-1" />Build</Button>
                            <Button size="sm" variant="outline" onClick={() => setAdjustFor(it)}><Scale className="h-3 w-3 mr-1" />Adjust</Button>
                            <Button size="sm" onClick={() => setSellFor(it)} disabled={Number(it.on_hand_qty) <= 0}><ShoppingCart className="h-3 w-3 mr-1" />Sell</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales"><SalesTab /></TabsContent>
      </Tabs>

      {bomFor && <BomDialog sku={bomFor} onClose={() => setBomFor(null)} />}
      {buildFor && <BuildDialog sku={buildFor} onClose={() => setBuildFor(null)} />}
      {sellFor && <SellDialog sku={sellFor} onClose={() => setSellFor(null)} />}
      {adjustFor && (
        <StockAdjustmentDialog
          open={!!adjustFor}
          onOpenChange={(v) => !v && setAdjustFor(null)}
          itemType="sub_assembly"
          itemId={adjustFor.id}
          itemLabel={adjustFor.name}
          currentQty={Number(adjustFor.on_hand_qty ?? 0)}
          currentUnitCost={Number(adjustFor.avg_unit_cost ?? adjustFor.bom_unit_cost ?? 0)}
        />
      )}
    </div>
  );
}

/* ─────────── BOM Dialog ─────────── */
function BomDialog({ sku, onClose }: { sku: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: mats = [] } = useQuery({
    queryKey: ["sa-bom-mat", sku.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_bom_materials" as any)
        .select("*, material:material_id(id, name, unit, avg_unit_cost, unit_cost)")
        .eq("assembly_stock_id", sku.id);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: labors = [] } = useQuery({
    queryKey: ["sa-bom-lab", sku.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_bom_labor" as any)
        .select("*, employee:employee_id(id, name, role)").eq("assembly_stock_id", sku.id);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["bom-employees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("employees")
        .select("id, name, role, daily_rate, status").eq("status", "active").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: ovh = [] } = useQuery({
    queryKey: ["sa-bom-ovh", sku.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_bom_overheads" as any)
        .select("*").eq("assembly_stock_id", sku.id);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: catalog = [] } = useQuery({
    queryKey: ["materials-catalog-bom"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials")
        .select("id, name, unit, avg_unit_cost, unit_cost, on_hand_qty").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sa-bom-mat", sku.id] });
    qc.invalidateQueries({ queryKey: ["sa-bom-lab", sku.id] });
    qc.invalidateQueries({ queryKey: ["sa-bom-ovh", sku.id] });
    qc.invalidateQueries({ queryKey: ["sub-assembly-stock"] });
  };

  const matCost = useMemo(() => mats.reduce((s: number, r: any) => s + Number(r.qty_per_unit) * Number(r.material?.avg_unit_cost ?? r.material?.unit_cost ?? 0), 0), [mats]);
  const labCost = useMemo(() => labors.reduce((s: number, r: any) => s + Number(r.hours_per_unit) * Number(r.rate_per_hour), 0), [labors]);
  const ovhCost = useMemo(() => ovh.reduce((s: number, r: any) => s + Number(r.cost_per_unit), 0), [ovh]);
  const total = matCost + labCost + ovhCost;

  const [newMat, setNewMat] = useState({ material_id: "", qty_per_unit: "1" });
  const [newLab, setNewLab] = useState({ employee_id: "", role: "", hours_per_unit: "1", rate_per_hour: "0" });
  const [newOvh, setNewOvh] = useState({ description: "", cost_per_unit: "0" });

  const addMat = async () => {
    if (!newMat.material_id) return;
    const { error } = await supabase.from("sub_assembly_bom_materials" as any).insert({
      assembly_stock_id: sku.id, material_id: newMat.material_id, qty_per_unit: parseFloat(newMat.qty_per_unit) || 0,
    });
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    setNewMat({ material_id: "", qty_per_unit: "1" }); invalidate();
  };
  const addLab = async () => {
    if (!newLab.employee_id && !newLab.role.trim()) return;
    const { error } = await supabase.from("sub_assembly_bom_labor" as any).insert({
      assembly_stock_id: sku.id,
      employee_id: newLab.employee_id || null,
      role: newLab.role.trim() || "Labour",
      hours_per_unit: parseFloat(newLab.hours_per_unit) || 0,
      rate_per_hour: parseFloat(newLab.rate_per_hour) || 0,
    });
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    setNewLab({ employee_id: "", role: "", hours_per_unit: "1", rate_per_hour: "0" }); invalidate();
  };
  const addOvh = async () => {
    if (!newOvh.description) return;
    const { error } = await supabase.from("sub_assembly_bom_overheads" as any).insert({
      assembly_stock_id: sku.id, description: newOvh.description, cost_per_unit: parseFloat(newOvh.cost_per_unit) || 0,
    });
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    setNewOvh({ description: "", cost_per_unit: "0" }); invalidate();
  };
  const del = async (table: string, id: string) => {
    const { error } = await supabase.from(table as any).delete().eq("id", id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    invalidate();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ListTree className="h-4 w-4" />BOM — {sku.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Materials */}
          <section>
            <h3 className="font-semibold mb-2">Materials</h3>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Material</TableHead><TableHead className="text-right">Qty / unit</TableHead>
                <TableHead className="text-right">Cost / unit</TableHead><TableHead className="text-right">Line</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {mats.map((m: any) => {
                  const c = Number(m.material?.avg_unit_cost ?? m.material?.unit_cost ?? 0);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>{m.material?.name} <span className="text-xs text-muted-foreground">({m.material?.unit})</span></TableCell>
                      <TableCell className="text-right font-mono">{m.qty_per_unit}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(c)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(c * Number(m.qty_per_unit))}</TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => del("sub_assembly_bom_materials", m.id)}><Trash2 className="h-3 w-3" /></Button></TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell>
                    <Select value={newMat.material_id} onValueChange={(v) => setNewMat({ ...newMat, material_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Pick material" /></SelectTrigger>
                      <SelectContent>{catalog.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name} <span className="text-xs text-muted-foreground">({c.unit}) · stock {c.on_hand_qty}</span></SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" step="0.01" value={newMat.qty_per_unit} onChange={(e) => setNewMat({ ...newMat, qty_per_unit: e.target.value })} /></TableCell>
                  <TableCell colSpan={2}></TableCell>
                  <TableCell className="text-right"><Button size="sm" onClick={addMat}><Plus className="h-3 w-3" /></Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

          {/* Labor */}
          <section>
            <h3 className="font-semibold mb-2">Labor</h3>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Employee / role</TableHead><TableHead className="text-right">Hrs / unit</TableHead>
                <TableHead className="text-right">Rate / hr</TableHead><TableHead className="text-right">Line</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {labors.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.employee?.name ?? l.role}
                      {l.employee?.name && l.role ? <span className="text-xs text-muted-foreground"> · {l.role}</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">{l.hours_per_unit}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(l.rate_per_hour)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(Number(l.hours_per_unit) * Number(l.rate_per_hour))}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => del("sub_assembly_bom_labor", l.id)}><Trash2 className="h-3 w-3" /></Button></TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="space-y-1 min-w-[220px]">
                    <Select
                      value={newLab.employee_id || "none"}
                      onValueChange={(v) => {
                        if (v === "none") return setNewLab({ ...newLab, employee_id: "" });
                        const emp = employees.find((e: any) => e.id === v);
                        setNewLab({
                          ...newLab,
                          employee_id: v,
                          role: emp?.role || newLab.role,
                          rate_per_hour: emp?.daily_rate ? String(Number(emp.daily_rate) / 8) : newLab.rate_per_hour,
                        });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Pick employee" /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        <SelectItem value="none">— Generic role —</SelectItem>
                        {employees.map((e: any) => (
                          <SelectItem key={e.id} value={e.id}>{e.name}{e.role ? ` · ${e.role}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input placeholder="Role e.g. welder" value={newLab.role} onChange={(e) => setNewLab({ ...newLab, role: e.target.value })} />
                  </TableCell>
                  <TableCell><Input type="number" step="0.1" value={newLab.hours_per_unit} onChange={(e) => setNewLab({ ...newLab, hours_per_unit: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={newLab.rate_per_hour} onChange={(e) => setNewLab({ ...newLab, rate_per_hour: e.target.value })} /></TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right"><Button size="sm" onClick={addLab}><Plus className="h-3 w-3" /></Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

          {/* Overhead */}
          <section>
            <h3 className="font-semibold mb-2">Overhead / Other</h3>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Description</TableHead><TableHead className="text-right">Cost / unit</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ovh.map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.description}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(o.cost_per_unit)}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => del("sub_assembly_bom_overheads", o.id)}><Trash2 className="h-3 w-3" /></Button></TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell><Input placeholder="e.g. consumables" value={newOvh.description} onChange={(e) => setNewOvh({ ...newOvh, description: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={newOvh.cost_per_unit} onChange={(e) => setNewOvh({ ...newOvh, cost_per_unit: e.target.value })} /></TableCell>
                  <TableCell className="text-right"><Button size="sm" onClick={addOvh}><Plus className="h-3 w-3" /></Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

          {/* Totals */}
          <Card>
            <CardHeader><CardTitle className="text-base">Computed Cost per Unit</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground">Materials</div><div className="font-mono font-semibold">{fmt(matCost)}</div></div>
                <div><div className="text-muted-foreground">Labor</div><div className="font-mono font-semibold">{fmt(labCost)}</div></div>
                <div><div className="text-muted-foreground">Overhead</div><div className="font-mono font-semibold">{fmt(ovhCost)}</div></div>
                <div><div className="text-muted-foreground">Total</div><div className="font-mono font-bold text-primary">{fmt(total)}</div></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Build Dialog ─────────── */
function BuildDialog({ sku, onClose }: { sku: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string>(sku.project_id ?? NONE);
  const { data: projects = [] } = useProjects();

  const submit = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("build_sub_assembly" as any, {
        _assembly_stock_id: sku.id, _qty: parseFloat(qty) || 0, _notes: notes || null,
        _project_id: projectId === NONE ? null : projectId,
      });

      if (error) throw error;
      toast({ title: "Built", description: `${qty} × ${sku.name} added to stock` });
      qc.invalidateQueries({ queryKey: ["sub-assembly-stock"] });
      onClose();
    } catch (e: any) { toast({ title: "Build failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const lineCost = Number(sku.bom_unit_cost || 0) * (parseFloat(qty) || 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Hammer className="h-4 w-4" />Build — {sku.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Quantity ({sku.uom})</Label><Input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project (stock build)</SelectItem>
                {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm bg-muted/40 rounded p-3 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">BOM unit cost</span><span className="font-mono">{fmt(sku.bom_unit_cost)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total build cost</span><span className="font-mono">{fmt(lineCost)}</span></div>
          </div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-16" /></div>
          <p className="text-xs text-muted-foreground">This will deduct BOM materials from stock and post labor/overhead expense entries{projectId !== NONE ? " to the selected project" : ""}.</p>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !(parseFloat(qty) > 0)}>Build</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Sell Dialog ─────────── */
function SellDialog({ sku, onClose }: { sku: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(String(sku.default_sale_price ?? ""));
  const [buyer, setBuyer] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name").order("company_name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const submit = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("sell_sub_assembly" as any, {
        _assembly_stock_id: sku.id,
        _qty: parseFloat(qty) || 0,
        _unit_price: parseFloat(price) || 0,
        _buyer_name: buyer,
        _buyer_customer_id: customerId || null,
        _notes: notes || null,
      });
      if (error) throw error;
      toast({ title: "Sold", description: `Invoice generated` });
      qc.invalidateQueries({ queryKey: ["sub-assembly-stock"] });
      qc.invalidateQueries({ queryKey: ["sub-assembly-sales"] });
      onClose();
    } catch (e: any) { toast({ title: "Sale failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const total = (parseFloat(qty) || 0) * (parseFloat(price) || 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" />Sell — {sku.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Qty ({sku.uom})</Label><Input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div><Label>Unit Price</Label><Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          </div>
          <div>
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={(v) => { setCustomerId(v); const c = customers.find((x: any) => x.id === v); if (c) setBuyer(c.company_name); }}>
              <SelectTrigger><SelectValue placeholder="Existing customer (optional)" /></SelectTrigger>
              <SelectContent>{customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Buyer name (on invoice)</Label><Input value={buyer} onChange={(e) => setBuyer(e.target.value)} required /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-16" /></div>
          <div className="text-sm bg-muted/40 rounded p-3 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">On hand</span><span className="font-mono">{sku.on_hand_qty}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Avg cost (COGS)</span><span className="font-mono">{fmt(sku.avg_unit_cost)}</span></div>
            <div className="flex justify-between font-semibold"><span>Invoice total</span><span className="font-mono">{fmt(total)}</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !buyer || !(parseFloat(qty) > 0) || !(parseFloat(price) >= 0)}>Sell & Invoice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Sales Tab ─────────── */
function SalesTab() {
  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["sub-assembly-sales"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_assembly_sales" as any)
        .select("*, sub_assembly_stock:assembly_stock_id(name, uom), invoice:invoice_id(invoice_number, status)")
        .order("sold_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>SKU</TableHead><TableHead>Buyer</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Price</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="text-right">COGS</TableHead>
            <TableHead>Invoice</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : !sales.length ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No sales yet</TableCell></TableRow>
            ) : sales.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="text-xs">{format(new Date(s.sold_at), "dd MMM yyyy HH:mm")}</TableCell>
                <TableCell className="font-medium">{s.sub_assembly_stock?.name}</TableCell>
                <TableCell>{s.buyer_name}</TableCell>
                <TableCell className="text-right font-mono">{s.qty} {s.sub_assembly_stock?.uom}</TableCell>
                <TableCell className="text-right font-mono">{fmt(s.unit_price)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{fmt(s.total_price)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{fmt(Number(s.unit_cost_snapshot) * Number(s.qty))}</TableCell>
                <TableCell>{s.invoice ? <Badge variant="outline"><FileText className="h-3 w-3 mr-1" />{s.invoice.invoice_number}</Badge> : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
