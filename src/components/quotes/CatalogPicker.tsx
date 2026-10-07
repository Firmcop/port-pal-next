import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type SelectedRow = {
  key: string;
  item_kind: string;
  ref_table?: string;
  ref_id?: string;
  description: string;
  unit?: string;
  unit_price: number;
  quantity: number;
};

export function CatalogPicker({
  open, onOpenChange, quoteId, sectionId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  quoteId: string;
  sectionId: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("materials");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, SelectedRow>>({});

  const [materialCategory, setMaterialCategory] = useState<string>("all");
  const [containerSize, setContainerSize] = useState<string>("all");
  const [containerCategory, setContainerCategory] = useState<string>("all");
  const [assemblyType, setAssemblyType] = useState<string>("all");

  const { data: materials } = useQuery({
    queryKey: ["catalog-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materials").select("id, name, unit, unit_cost, category, on_hand_qty")
        .eq("is_active", true).order("name").limit(1000);
      if (error) throw error; return data;
    },
    enabled: open,
  });
  const { data: containers } = useQuery({
    queryKey: ["catalog-containers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers").select("id, container_number, size, category, status, owner")
        .eq("status","available").order("container_number").limit(1000);
      if (error) throw error; return data;
    },
    enabled: open,
  });
  const { data: subAssemblies } = useQuery({
    queryKey: ["catalog-sub-assemblies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sub_assembly_stock")
        .select("id, name, assembly_type, uom, avg_unit_cost, on_hand_qty")
        .order("name").limit(1000);
      if (error) throw error; return data;
    },
    enabled: open,
  });
  const { data: services } = useQuery({
    queryKey: ["catalog-services"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quote_service_catalog")
        .select("id, name, category, unit, default_price")
        .eq("is_active", true).order("name");
      if (error) throw error; return data as any[];
    },
    enabled: open,
  });

  const matCategories = useMemo(() => Array.from(new Set((materials ?? []).map((m: any) => m.category).filter(Boolean))) as string[], [materials]);
  const ctCategories = useMemo(() => Array.from(new Set((containers ?? []).map((c: any) => c.category).filter(Boolean))) as string[], [containers]);
  const ctSizes = useMemo(() => Array.from(new Set((containers ?? []).map((c: any) => String(c.size)))).sort(), [containers]);
  const saTypes = useMemo(() => Array.from(new Set((subAssemblies ?? []).map((s: any) => s.assembly_type).filter(Boolean))) as string[], [subAssemblies]);

  const q = search.trim().toLowerCase();
  const matches = (s?: string | null) => !q || (s ?? "").toLowerCase().includes(q);

  const filteredMaterials = (materials ?? []).filter((m: any) =>
    matches(m.name) && (materialCategory === "all" || m.category === materialCategory));
  const filteredContainers = (containers ?? []).filter((c: any) =>
    matches(c.container_number) && (containerSize === "all" || String(c.size) === containerSize)
    && (containerCategory === "all" || c.category === containerCategory));
  const filteredSubA = (subAssemblies ?? []).filter((s: any) =>
    matches(s.name) && (assemblyType === "all" || s.assembly_type === assemblyType));
  const filteredServices = (services ?? []).filter((s: any) =>
    matches(s.name) || matches(s.category));

  const toggle = (row: SelectedRow) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[row.key]) delete next[row.key];
      else next[row.key] = row;
      return next;
    });
  };

  const setQty = (key: string, qty: number) => {
    setSelected((prev) => prev[key] ? { ...prev, [key]: { ...prev[key], quantity: Math.max(0.01, qty || 1) } } : prev);
  };

  const addMut = useMutation({
    mutationFn: async () => {
      if (!sectionId) throw new Error("Pick a section first");
      const items = Object.values(selected).map((r) => ({
        item_type: r.item_kind === "service" ? "service" : "product",
        item_kind: r.item_kind,
        ref_table: r.ref_table ?? null,
        ref_id: r.ref_id ?? null,
        description: r.description,
        unit: r.unit ?? null,
        quantity: r.quantity,
        unit_price: r.unit_price,
      }));
      const { error } = await (supabase as any).rpc("bulk_add_quote_items", {
        _quote_id: quoteId, _section_id: sectionId, _items: items,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: `Added ${Object.keys(selected).length} item(s)` });
      qc.invalidateQueries({ queryKey: ["quote-items", quoteId] });
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      setSelected({});
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const SelChk = ({ row }: { row: SelectedRow }) => {
    const isSel = !!selected[row.key];
    return (
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={isSel} onChange={() => toggle(row)} className="h-4 w-4" />
        {isSel && (
          <Input type="number" step="0.01" className="h-7 w-20"
            value={selected[row.key].quantity}
            onChange={(e) => setQty(row.key, Number(e.target.value))} />
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add from Catalog</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Badge variant="secondary">{Object.keys(selected).length} selected</Badge>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="materials">Materials</TabsTrigger>
            <TabsTrigger value="containers">Containers</TabsTrigger>
            <TabsTrigger value="subassemblies">Sub-assemblies</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
          </TabsList>

          <TabsContent value="materials" className="space-y-2">
            <div className="flex gap-2">
              <Select value={materialCategory} onValueChange={setMaterialCategory}>
                <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {matCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-96 overflow-auto border rounded">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-32">Add</TableHead>
                  <TableHead>Name</TableHead><TableHead>Category</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredMaterials.map((m: any) => {
                    const row: SelectedRow = {
                      key: `mat:${m.id}`, item_kind: "material", ref_table: "materials", ref_id: m.id,
                      description: m.name, unit: m.unit, unit_price: Number(m.unit_cost || 0), quantity: 1,
                    };
                    return (
                      <TableRow key={m.id}>
                        <TableCell><SelChk row={row} /></TableCell>
                        <TableCell>{m.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.category ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{Number(m.on_hand_qty ?? 0)} {m.unit}</TableCell>
                        <TableCell className="text-right font-mono">{Number(m.unit_cost ?? 0).toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="containers" className="space-y-2">
            <div className="flex gap-2">
              <Select value={containerSize} onValueChange={setContainerSize}>
                <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sizes</SelectItem>
                  {ctSizes.map((s) => <SelectItem key={s} value={s}>{s}'</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={containerCategory} onValueChange={setContainerCategory}>
                <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {ctCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-96 overflow-auto border rounded">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-32">Add</TableHead>
                  <TableHead>Number</TableHead><TableHead>Size</TableHead>
                  <TableHead>Category</TableHead><TableHead>Owner</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredContainers.map((c: any) => {
                    const row: SelectedRow = {
                      key: `ct:${c.id}`, item_kind: "container", ref_table: "containers", ref_id: c.id,
                      description: `${c.container_number} (${c.size}' ${c.category})`,
                      unit: "unit", unit_price: 0, quantity: 1,
                    };
                    return (
                      <TableRow key={c.id}>
                        <TableCell><SelChk row={row} /></TableCell>
                        <TableCell className="font-mono">{c.container_number}</TableCell>
                        <TableCell>{c.size}'</TableCell>
                        <TableCell className="text-xs">{c.category}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.owner ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="subassemblies" className="space-y-2">
            <Select value={assemblyType} onValueChange={setAssemblyType}>
              <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {saTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="max-h-96 overflow-auto border rounded">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-32">Add</TableHead>
                  <TableHead>Name</TableHead><TableHead>Type</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Avg Cost</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredSubA.map((s: any) => {
                    const row: SelectedRow = {
                      key: `sa:${s.id}`, item_kind: "subassembly", ref_table: "sub_assembly_stock", ref_id: s.id,
                      description: `${s.name} (${s.assembly_type})`, unit: s.uom,
                      unit_price: Number(s.avg_unit_cost || 0), quantity: 1,
                    };
                    return (
                      <TableRow key={s.id}>
                        <TableCell><SelChk row={row} /></TableCell>
                        <TableCell>{s.name}</TableCell>
                        <TableCell className="text-xs">{s.assembly_type}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{Number(s.on_hand_qty ?? 0)} {s.uom}</TableCell>
                        <TableCell className="text-right font-mono">{Number(s.avg_unit_cost ?? 0).toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="services" className="space-y-2">
            <p className="text-xs text-muted-foreground">Curated services for this organization. Manage in the Quote Services catalog.</p>
            <div className="max-h-96 overflow-auto border rounded">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-32">Add</TableHead>
                  <TableHead>Name</TableHead><TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Default Price</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredServices.map((s: any) => {
                    const row: SelectedRow = {
                      key: `svc:${s.id}`, item_kind: "service", ref_table: "quote_service_catalog", ref_id: s.id,
                      description: s.name, unit: s.unit,
                      unit_price: Number(s.default_price || 0), quantity: 1,
                    };
                    return (
                      <TableRow key={s.id}>
                        <TableCell><SelChk row={row} /></TableCell>
                        <TableCell>{s.name}</TableCell>
                        <TableCell className="text-xs">{s.category}</TableCell>
                        <TableCell className="text-xs">{s.unit}</TableCell>
                        <TableCell className="text-right font-mono">{Number(s.default_price ?? 0).toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {!filteredServices.length && (
                    <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                      No services yet. Add some in the Quote Services catalog.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => addMut.mutate()} disabled={!Object.keys(selected).length || addMut.isPending || !sectionId}>
            <Plus className="mr-1 h-4 w-4" />Add {Object.keys(selected).length} item(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
