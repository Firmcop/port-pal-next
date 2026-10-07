import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Building2, Pencil, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRowSelection } from "@/hooks/use-row-selection";
import { HeaderCheckbox, RowCheckbox } from "@/components/bulk/SelectionCheckbox";
import { RegistryActions, BulkActions } from "@/components/bulk/RegistryActions";
import { REGISTRIES } from "@/config/bulk-registries";
import { CurrencySelect } from "@/components/CurrencySelect";

const emptyForm = { name: "", contact_person: "", phone: "", email: "", address: "", notes: "", is_active: true, currency: "" as string };

export default function Suppliers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ["suppliers", search],
    queryFn: async () => {
      let q = supabase.from("suppliers").select("*").order("name");
      if (search) q = q.ilike("name", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      if (!form.currency || !form.currency.trim()) {
        throw new Error("Currency is required — used for all POs, bills and payments to this supplier.");
      }
      const payload = { ...form, currency: form.currency.trim().toUpperCase() } as any;
      if (editId) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast({ title: editId ? "Supplier updated" : "Supplier added" });
      setOpen(false);
      setEditId(null);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openEdit = (s: any) => {
    setEditId(s.id);
    setForm({ name: s.name, contact_person: s.contact_person ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", notes: s.notes ?? "", is_active: s.is_active, currency: s.currency ?? "" });
    setOpen(true);
  };

  const selection = useRowSelection<any>(suppliers as any);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6" />Suppliers</h1>
          <p className="text-muted-foreground">{suppliers?.length ?? 0} suppliers</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <RegistryActions config={REGISTRIES.suppliers.config} schema={REGISTRIES.suppliers.schema} allRows={suppliers as any} selectedIds={selection.selectedIds} onClearSelection={selection.clear} />
          <Button onClick={() => { setEditId(null); setForm(emptyForm); setOpen(true); }}><Plus className="mr-1 h-4 w-4" />Add Supplier</Button>
        </div>
      </div>

      <BulkActions
        config={REGISTRIES.suppliers.config}
        selectedIds={selection.selectedIds}
        selectedRows={selection.selectedRows}
        onClear={selection.clear}
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <HeaderCheckbox allSelected={selection.allSelected} someSelected={selection.someSelected} onToggle={selection.toggleAll} />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !suppliers?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No suppliers yet</TableCell></TableRow>
              ) : suppliers.map((s: any) => (
                <TableRow key={s.id} data-state={selection.isSelected(s.id) ? "selected" : undefined}>
                  <TableCell><RowCheckbox checked={selection.isSelected(s.id)} onToggle={() => selection.toggle(s.id)} /></TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm">{s.contact_person ?? "—"}</TableCell>
                  <TableCell className="text-sm">{s.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.email ?? "—"}</TableCell>
                  <TableCell><Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditId(null); setForm(emptyForm); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Supplier" : "Add Supplier"}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); upsert.mutate(); }} className="space-y-4">
            <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
            <div className="space-y-2"><Label>Address</Label><Textarea value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} /></div>
            <div className="space-y-2">
              <Label>Currency <span className="text-destructive">*</span></Label>
              <CurrencySelect
                value={form.currency || null}
                onChange={(v) => set("currency", v)}
                placeholder="Select currency (required)"
              />
              <p className="text-xs text-muted-foreground">All POs, bills and payments for this supplier will use this currency.</p>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} /></div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="rounded" />
              <span className="text-sm">Active</span>
            </label>
            <Button type="submit" className="w-full" disabled={upsert.isPending || !form.name}>{editId ? "Update" : "Add"} Supplier</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
