import { useMemo, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, FileQuestion, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type ItemRow = { description: string; material_id: string | null; quantity: number; uom: string };
type SupplierRow = { supplier_id: string };

export default function RFQs() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ description: "", material_id: null, quantity: 1, uom: "" }]);
  const [suppliersSel, setSuppliersSel] = useState<SupplierRow[]>([{ supplier_id: "" }]);

  const { data: rfqs, isLoading } = useQuery({
    queryKey: ["rfqs", search, status],
    queryFn: async () => {
      let q = supabase
        .from("rfqs")
        .select("id, rfq_number, title, status, response_deadline, created_at, awarded_supplier_id, awarded_po_id, suppliers:awarded_supplier_id(name), purchase_orders:awarded_po_id(po_number)")
        .order("created_at", { ascending: false });
      if (search) q = q.or(`rfq_number.ilike.%${search}%,title.ilike.%${search}%`);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["rfq-suppliers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: materials } = useQuery({
    queryKey: ["rfq-materials-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select("id, name, unit").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const resetForm = () => {
    setTitle(""); setDeadline(""); setNotes("");
    setItems([{ description: "", material_id: null, quantity: 1, uom: "" }]);
    setSuppliersSel([{ supplier_id: "" }]);
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title required");
      const cleanItems = items
        .filter((i) => i.description.trim() || i.material_id)
        .map((i, idx) => ({
          description: i.description || (materials?.find((m) => m.id === i.material_id)?.name ?? "Item"),
          material_id: i.material_id,
          quantity: Number(i.quantity) || 1,
          uom: i.uom || null,
          sort_order: idx,
        }));
      if (!cleanItems.length) throw new Error("Add at least one item");
      const cleanSuppliers = suppliersSel.filter((s) => s.supplier_id).map((s) => ({ supplier_id: s.supplier_id }));
      if (!cleanSuppliers.length) throw new Error("Invite at least one supplier");

      const { data, error } = await supabase.rpc("create_rfq", {
        _payload: {
          title,
          response_deadline: deadline || null,
          notes: notes || null,
          items: cleanItems,
          suppliers: cleanSuppliers,
        } as any,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast({ title: "RFQ created" });
      qc.invalidateQueries({ queryKey: ["rfqs"] });
      setOpen(false); resetForm();
      nav(`/procurement/rfqs/${id}`);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      draft: "secondary", sent: "default", closed: "outline", awarded: "default", cancelled: "destructive",
    };
    return <Badge variant={map[s] as any}>{s}</Badge>;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><FileQuestion className="h-6 w-6" /> Requests for Quotation</h1>
          <p className="text-sm text-muted-foreground">Collect supplier quotes and convert the winning one into a purchase order.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 me-2" />New RFQ</Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search RFQ #, title..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="awarded">Awarded</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RFQ #</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Awarded to</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              ) : (rfqs ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No RFQs yet.</TableCell></TableRow>
              ) : (
                (rfqs ?? []).map((r: any) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => nav(`/procurement/rfqs/${r.id}`)}>
                    <TableCell className="font-medium">{r.rfq_number}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell>{r.response_deadline ? format(new Date(r.response_deadline), "PP") : "—"}</TableCell>
                    <TableCell>
                      {r.suppliers?.name ? (
                        <span>{r.suppliers.name}{r.purchase_orders?.po_number ? ` · ${r.purchase_orders.po_number}` : ""}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{format(new Date(r.created_at), "PP")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New RFQ</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Title *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1"><Label>Response deadline</Label><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Items</Label>
                <Button size="sm" variant="outline" onClick={() => setItems((x) => [...x, { description: "", material_id: null, quantity: 1, uom: "" }])}>
                  <Plus className="h-3 w-3 me-1" />Add item
                </Button>
              </div>
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Label className="text-xs">Material (optional)</Label>
                    <Select value={it.material_id ?? "none"} onValueChange={(v) => {
                      const mid = v === "none" ? null : v;
                      const mat = materials?.find((m) => m.id === mid);
                      setItems((x) => x.map((r, i) => i === idx ? { ...r, material_id: mid, description: r.description || (mat?.name ?? ""), uom: r.uom || (mat?.unit ?? "") } : r));
                    }}>
                      <SelectTrigger><SelectValue placeholder="Free-text" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Free-text —</SelectItem>
                        {(materials ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Label className="text-xs">Description</Label>
                    <Input value={it.description} onChange={(e) => setItems((x) => x.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" min={0} value={it.quantity} onChange={(e) => setItems((x) => x.map((r, i) => i === idx ? { ...r, quantity: Number(e.target.value) } : r))} />
                  </div>
                  <div className="col-span-1">
                    <Label className="text-xs">UoM</Label>
                    <Input value={it.uom} onChange={(e) => setItems((x) => x.map((r, i) => i === idx ? { ...r, uom: e.target.value } : r))} />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setItems((x) => x.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Invite suppliers</Label>
                <Button size="sm" variant="outline" onClick={() => setSuppliersSel((x) => [...x, { supplier_id: "" }])}>
                  <Plus className="h-3 w-3 me-1" />Add supplier
                </Button>
              </div>
              {suppliersSel.map((s, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Select value={s.supplier_id || undefined} onValueChange={(v) => setSuppliersSel((x) => x.map((r, i) => i === idx ? { ...r, supplier_id: v } : r))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      {(suppliers ?? []).map((sup) => <SelectItem key={sup.id} value={sup.id}>{sup.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" onClick={() => setSuppliersSel((x) => x.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>Create RFQ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
