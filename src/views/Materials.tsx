import { useState, useMemo, useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Package, Search, MoreHorizontal, Edit, Copy, Archive, ArchiveRestore, Trash2, AlertTriangle, GitMerge, X, Scale } from "lucide-react";
import { StockAdjustmentDialog } from "@/components/inventory/StockAdjustmentDialog";
import { useToast } from "@/hooks/use-toast";
import { useRowSelection } from "@/hooks/use-row-selection";
import { HeaderCheckbox, RowCheckbox } from "@/components/bulk/SelectionCheckbox";
import { RegistryActions, BulkActions } from "@/components/bulk/RegistryActions";
import { REGISTRIES } from "@/config/bulk-registries";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";

const UNITS = ["pcs", "kg", "m", "sheets", "litres"] as const;

interface MaterialForm {
  name: string;
  unit: string;
  unit_cost: string;
  category: string;
  is_vatable: boolean;
}

const emptyForm: MaterialForm = { name: "", unit: "pcs", unit_cost: "", category: "", is_vatable: false };

function normalizeName(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

type StatusFilter = "active" | "archived" | "all";
type StockFilter = "all" | "in" | "out" | "low";
type VatFilter = "all" | "vat" | "novat";
type SortKey = "name" | "cost_desc" | "cost_asc" | "avail_desc";

export default function Materials() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [vatFilter, setVatFilter] = useState<VatFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [form, setForm] = useState<MaterialForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState<any | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<any | null>(null);
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v as any }));

  const { data: materials, isLoading } = useQuery({
    queryKey: ["materials-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materials")
        .select("*, material_stock(qty_available, qty_reserved)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["materials-catalog"] });

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (m: any) => {
    setEditingId(m.id);
    setForm({ name: m.name, unit: m.unit, unit_cost: String(m.unit_cost ?? ""), category: m.category ?? "", is_vatable: !!m.is_vatable });
    setOpen(true);
  };

  // Duplicate suggestions in dialog
  const nameNorm = useMemo(() => normalizeName(form.name), [form.name]);
  const dupSuggestions = useMemo(() => {
    if (!materials || nameNorm.length < 2) return [];
    const list = (materials as any[]).filter((m) => m.id !== editingId && m.is_active);
    const scored = list
      .map((m) => {
        const other = normalizeName(m.name);
        if (!other) return null;
        const exact = other === nameNorm;
        const contains = other.includes(nameNorm) || nameNorm.includes(other);
        // simple token overlap
        const a = new Set(nameNorm.split(" "));
        const b = new Set(other.split(" "));
        const inter = [...a].filter((t) => b.has(t)).length;
        const union = new Set([...a, ...b]).size;
        const jaccard = union ? inter / union : 0;
        const score = exact ? 1 : Math.max(contains ? 0.75 : 0, jaccard);
        return score >= 0.5 ? { m, score, exact } : null;
      })
      .filter(Boolean) as { m: any; score: number; exact: boolean }[];
    return scored.sort((x, y) => y.score - x.score).slice(0, 5);
  }, [materials, nameNorm, editingId]);
  const exactDup = dupSuggestions.find((d) => d.exact);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (exactDup && !editingId) {
        throw new Error(`A material named "${exactDup.m.name}" already exists.`);
      }
      const payload = {
        name: form.name,
        unit: form.unit,
        unit_cost: parseFloat(form.unit_cost) || 0,
        category: form.category || null,
        is_vatable: !!form.is_vatable,
      };
      if (editingId) {
        const { error } = await supabase.from("materials").update(payload as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data: mat, error } = await supabase.from("materials").insert(payload as any).select("id").single();
        if (error) throw error;
        await supabase.from("material_stock").insert({ material_id: mat.id, qty_available: 0, qty_reserved: 0 } as any);
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: editingId ? "Material updated" : "Material added" });
      setOpen(false);
      setForm(emptyForm);
      setEditingId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cloneMut = useMutation({
    mutationFn: async (m: any) => {
      const { data: mat, error } = await supabase.from("materials").insert({
        name: `Copy of ${m.name}`,
        unit: m.unit,
        unit_cost: m.unit_cost,
        category: m.category,
      } as any).select("id").single();
      if (error) throw error;
      await supabase.from("material_stock").insert({ material_id: mat.id, qty_available: 0, qty_reserved: 0 } as any);
    },
    onSuccess: () => { invalidate(); toast({ title: "Material cloned" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("materials").update({ is_active: !is_active } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, v) => { invalidate(); toast({ title: v.is_active ? "Material archived" : "Material restored" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("material_stock").delete().eq("material_id", id);
      const { error } = await supabase.from("materials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "Material deleted" }); setDeleteId(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const mergeMut = useMutation({
    mutationFn: async ({ from, into }: { from: string; into: string }) => {
      const { error } = await supabase.rpc("merge_materials" as any, { _from: from, _into: into });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: "Materials merged" }); setMergeFrom(null); },
    onError: (e: any) => toast({ title: "Merge failed", description: e.message, variant: "destructive" }),
  });

  // Derived filter options
  const categories = useMemo(() => {
    const s = new Set<string>();
    (materials as any[] | undefined)?.forEach((m) => { if (m.category) s.add(m.category); });
    return [...s].sort();
  }, [materials]);

  const dupKeys = useMemo(() => {
    const counts = new Map<string, number>();
    (materials as any[] | undefined)?.forEach((m) => {
      const k = normalizeName(m.name);
      if (!k) return;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
  }, [materials]);

  const filtered = useMemo(() => {
    let rows = (materials as any[] | undefined) ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((m) => (m.name ?? "").toLowerCase().includes(q) || (m.category ?? "").toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") {
      rows = rows.filter((m) => categoryFilter === "__uncategorized__" ? !m.category : m.category === categoryFilter);
    }
    if (unitFilter !== "all") rows = rows.filter((m) => m.unit === unitFilter);
    if (statusFilter === "active") rows = rows.filter((m) => m.is_active);
    else if (statusFilter === "archived") rows = rows.filter((m) => !m.is_active);
    if (vatFilter === "vat") rows = rows.filter((m) => m.is_vatable);
    else if (vatFilter === "novat") rows = rows.filter((m) => !m.is_vatable);
    if (stockFilter !== "all") {
      rows = rows.filter((m) => {
        const s = Array.isArray(m.material_stock) ? m.material_stock[0] : m.material_stock;
        const avail = Number(s?.qty_available ?? 0);
        const reorder = Number(m.reorder_point ?? 0);
        if (stockFilter === "in") return avail > 0;
        if (stockFilter === "out") return avail <= 0;
        if (stockFilter === "low") return avail > 0 && avail <= (reorder || 5);
        return true;
      });
    }
    if (showDuplicatesOnly) {
      rows = rows.filter((m) => dupKeys.has(normalizeName(m.name)));
    }
    rows = [...rows].sort((a, b) => {
      const sa = Array.isArray(a.material_stock) ? a.material_stock[0] : a.material_stock;
      const sb = Array.isArray(b.material_stock) ? b.material_stock[0] : b.material_stock;
      switch (sortKey) {
        case "cost_desc": return Number(b.unit_cost) - Number(a.unit_cost);
        case "cost_asc": return Number(a.unit_cost) - Number(b.unit_cost);
        case "avail_desc": return Number(sb?.qty_available ?? 0) - Number(sa?.qty_available ?? 0);
        default: return (a.name ?? "").localeCompare(b.name ?? "");
      }
    });
    return rows;
  }, [materials, search, categoryFilter, unitFilter, statusFilter, stockFilter, vatFilter, sortKey, showDuplicatesOnly, dupKeys]);

  const selection = useRowSelection<any>(filtered as any);

  const anyFilter =
    !!search || categoryFilter !== "all" || unitFilter !== "all" ||
    statusFilter !== "active" || stockFilter !== "all" || vatFilter !== "all" ||
    sortKey !== "name" || showDuplicatesOnly;

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setUnitFilter("all");
    setStatusFilter("active");
    setStockFilter("all");
    setVatFilter("all");
    setSortKey("name");
    setShowDuplicatesOnly(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" />Materials & Stock</h1>
          <p className="text-muted-foreground">Material catalog with stock levels</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <RegistryActions config={REGISTRIES.materials.config} schema={REGISTRIES.materials.schema} allRows={materials as any} selectedIds={selection.selectedIds} onClearSelection={selection.clear} />
          <Button onClick={openAdd}><Plus className="mr-1 h-4 w-4" />Add Material</Button>
        </div>
      </div>

      <BulkActions
        config={REGISTRIES.materials.config}
        selectedIds={selection.selectedIds}
        selectedRows={selection.selectedRows}
        onClear={selection.clear}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search name or category…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="__uncategorized__">Uncategorized</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="Unit" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All units</SelectItem>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any stock</SelectItem>
                <SelectItem value="in">In stock</SelectItem>
                <SelectItem value="low">Low stock</SelectItem>
                <SelectItem value="out">Out of stock</SelectItem>
              </SelectContent>
            </Select>
            <Select value={vatFilter} onValueChange={(v) => setVatFilter(v as VatFilter)}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">VAT: any</SelectItem>
                <SelectItem value="vat">VATable</SelectItem>
                <SelectItem value="novat">Non-VATable</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="cost_desc">Unit cost ↓</SelectItem>
                <SelectItem value="cost_asc">Unit cost ↑</SelectItem>
                <SelectItem value="avail_desc">Available ↓</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={showDuplicatesOnly ? "default" : "outline"}
              size="sm"
              onClick={() => { setShowDuplicatesOnly((v) => !v); setStatusFilter("all"); }}
            >
              <GitMerge className="h-4 w-4 mr-1" />
              Duplicates{dupKeys.size ? ` (${dupKeys.size})` : ""}
            </Button>
            {anyFilter && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />Clear
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Showing {filtered.length}{materials ? ` of ${materials.length}` : ""} materials
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <HeaderCheckbox allSelected={selection.allSelected} someSelected={selection.someSelected} onToggle={selection.toggleAll} />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No materials match the current filters</TableCell></TableRow>
              ) : filtered.map((m: any) => {
                const stock = Array.isArray(m.material_stock) ? m.material_stock[0] : m.material_stock;
                const isDup = dupKeys.has(normalizeName(m.name));
                return (
                  <TableRow key={m.id} data-state={selection.isSelected(m.id) ? "selected" : undefined}>
                    <TableCell><RowCheckbox checked={selection.isSelected(m.id)} onToggle={() => selection.toggle(m.id)} /></TableCell>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Link to={`/materials/${m.id}`} className="hover:underline text-primary">{m.name}</Link>
                        {isDup && (
                          <Badge variant="outline" className="text-amber-600 border-amber-500/40 gap-1">
                            <AlertTriangle className="h-3 w-3" />dup
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.category ? (
                        <button className="hover:underline" onClick={() => setCategoryFilter(m.category)}>{m.category}</button>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{m.unit}</TableCell>
                    <TableCell className="text-right font-mono">{Number(m.unit_cost).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{stock?.qty_available ?? 0}</TableCell>
                    <TableCell className="text-right font-mono">{stock?.qty_reserved ?? 0}</TableCell>
                    <TableCell><Badge variant={m.is_active ? "default" : "secondary"}>{m.is_active ? "Active" : "Archived"}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(m)}>
                            <Edit className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => cloneMut.mutate(m)}>
                            <Copy className="mr-2 h-4 w-4" />Clone
                          </DropdownMenuItem>
                          {isOwnerOrAdmin && (
                            <DropdownMenuItem onClick={() => setAdjustTarget({ ...m, qty_available: stock?.qty_available ?? 0 })}>
                              <Scale className="mr-2 h-4 w-4" />Adjust stock
                            </DropdownMenuItem>
                          )}
                          {isOwnerOrAdmin && m.is_active && (
                            <DropdownMenuItem onClick={() => setMergeFrom(m)}>
                              <GitMerge className="mr-2 h-4 w-4" />Merge into…
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => archiveMut.mutate({ id: m.id, is_active: m.is_active })}>
                            {m.is_active ? <><Archive className="mr-2 h-4 w-4" />Archive</> : <><ArchiveRestore className="mr-2 h-4 w-4" />Restore</>}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteId(m.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
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

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditingId(null); setForm(emptyForm); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit Material" : "Add Material"}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
              {dupSuggestions.length > 0 && (
                <div className={`rounded-md border p-2 text-xs ${exactDup ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                  <div className="flex items-center gap-1 font-medium mb-1">
                    <AlertTriangle className="h-3 w-3" />
                    {exactDup ? "An identical material already exists" : "Similar materials found"}
                  </div>
                  <ul className="space-y-1">
                    {dupSuggestions.map(({ m, exact }) => (
                      <li key={m.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {m.name}
                          <span className="text-muted-foreground"> · {m.unit}{m.category ? ` · ${m.category}` : ""}</span>
                          {exact && <Badge variant="destructive" className="ml-2">exact</Badge>}
                        </span>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setTimeout(() => openEdit(m), 50); }}>
                          Use this
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Unit Cost</Label><Input type="number" value={form.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Category</Label><Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Steel, Electrical, Plumbing" /></div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.is_vatable} onChange={(e) => set("is_vatable", e.target.checked)} />
              <span className="text-sm">VATable by default on purchases</span>
            </label>
            <Button type="submit" className="w-full" disabled={saveMut.isPending || !form.name || (!!exactDup && !editingId)}>
              {editingId ? "Save Changes" : "Add Material"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <MergeDialog
        source={mergeFrom}
        candidates={(materials as any[] | undefined) ?? []}
        onCancel={() => setMergeFrom(null)}
        onConfirm={(intoId) => mergeFrom && mergeMut.mutate({ from: mergeFrom.id, into: intoId })}
        pending={mergeMut.isPending}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Material</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this material and its stock record. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMut.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {adjustTarget && (
        <StockAdjustmentDialog
          open={!!adjustTarget}
          onOpenChange={(v) => !v && setAdjustTarget(null)}
          itemType="material"
          itemId={adjustTarget.id}
          itemLabel={adjustTarget.name}
          currentQty={Number(adjustTarget.qty_available ?? 0)}
          currentUnitCost={Number(adjustTarget.unit_cost ?? 0)}
        />
      )}
    </div>
  );
}

function MergeDialog({
  source, candidates, onCancel, onConfirm, pending,
}: {
  source: any | null;
  candidates: any[];
  onCancel: () => void;
  onConfirm: (intoId: string) => void;
  pending: boolean;
}) {
  const [intoId, setIntoId] = useState<string>("");
  useEffect(() => { setIntoId(""); }, [source?.id]);

  const suggestions = useMemo(() => {
    if (!source) return [];
    const norm = normalizeName(source.name);
    return candidates
      .filter((c) => c.id !== source.id && c.is_active)
      .map((c) => {
        const other = normalizeName(c.name);
        const a = new Set(norm.split(" "));
        const b = new Set(other.split(" "));
        const inter = [...a].filter((t) => b.has(t)).length;
        const union = new Set([...a, ...b]).size;
        return { c, score: union ? inter / union : 0 };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, 20);
  }, [source, candidates]);

  return (
    <Dialog open={!!source} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Merge Material</DialogTitle></DialogHeader>
        {source && (
          <div className="space-y-3 text-sm">
            <p>
              Move all stock, movements, and PO references from{" "}
              <span className="font-medium">{source.name}</span> into the material you pick below.
              The source will be archived.
            </p>
            <div className="space-y-1">
              <Label>Merge into</Label>
              <Select value={intoId} onValueChange={setIntoId}>
                <SelectTrigger><SelectValue placeholder="Pick the surviving material" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {suggestions.map(({ c, score }) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.category ? ` · ${c.category}` : ""} · {c.unit}
                      {score >= 0.6 ? "  ★ similar" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={!intoId || pending} onClick={() => intoId && onConfirm(intoId)}>
            {pending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
