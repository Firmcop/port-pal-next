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
import { Plus, Search, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { useRowSelection } from "@/hooks/use-row-selection";
import { HeaderCheckbox, RowCheckbox } from "@/components/bulk/SelectionCheckbox";
import { RegistryActions, BulkActions } from "@/components/bulk/RegistryActions";
import { REGISTRIES } from "@/config/bulk-registries";
import { CurrencySelect } from "@/components/CurrencySelect";

const typeColors: Record<string, string> = {
  buyer: "bg-success/15 text-success border-success/30",
  shipping_line: "bg-info/15 text-info border-info/30",
  owner: "bg-purple-500/15 text-purple-700 border-purple-300",
  agent: "bg-warning/15 text-warning border-warning/30",
};

const typeLabels: Record<string, string> = {
  buyer: "Buyer",
  shipping_line: "Shipping Line",
  owner: "Owner",
  agent: "Agent",
};

const emptyForm = {
  customer_type: "buyer" as string,
  company_name: "",
  contact_person: "",
  email: "",
  phone: "",
  whatsapp_number: "",
  address: "",
  tax_id: "",
  kra_pin: "",
  notes: "",
  is_active: true,
  currency: "" as string,
};

export default function Customers() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [form, setForm] = useState(emptyForm);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers", search, filterType],
    queryFn: async () => {
      let q = supabase
        .from("customers")
        .select("*")
        .order("company_name");
      if (search) q = q.or(`company_name.ilike.%${search}%,contact_person.ilike.%${search}%,email.ilike.%${search}%`);
      if (filterType !== "all") q = q.eq("customer_type", filterType as any);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return data;
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      if (!form.currency || !form.currency.trim()) {
        throw new Error("Currency is required — used for all invoices, POs and payments to/from this customer.");
      }
      const payload = { ...form, currency: form.currency.trim().toUpperCase(), created_by: user?.id } as any;
      if (editId) {
        const { error } = await supabase.from("customers").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: editId ? "Customer updated" : "Customer added" });
      setDialogOpen(false);
      setEditId(null);
      setForm(emptyForm);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openEdit = (c: any) => {
    setEditId(c.id);
    setForm({
      customer_type: c.customer_type,
      company_name: c.company_name,
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      whatsapp_number: c.whatsapp_number ?? "",
      address: c.address ?? "",
      tax_id: c.tax_id ?? "",
      kra_pin: c.kra_pin ?? "",
      notes: c.notes ?? "",
      is_active: c.is_active,
      currency: c.currency ?? "",
    });
    setDialogOpen(true);
  };

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const selection = useRowSelection<any>(customers as any);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.customers")}</h1>
          <p className="text-muted-foreground">{customers?.length ?? 0} customers</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <RegistryActions config={REGISTRIES.customers.config} schema={REGISTRIES.customers.schema} allRows={customers as any} selectedIds={selection.selectedIds} onClearSelection={selection.clear} />
          <Button size="sm" onClick={openNew}><Plus className="mr-1 h-4 w-4" />Add Customer</Button>
        </div>
      </div>

      <BulkActions
        config={REGISTRIES.customers.config}
        selectedIds={selection.selectedIds}
        selectedRows={selection.selectedRows}
        onClear={selection.clear}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search company, contact, email..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="buyer">Buyers</SelectItem>
                <SelectItem value="shipping_line">Shipping Lines</SelectItem>
                <SelectItem value="owner">Owners</SelectItem>
                <SelectItem value="agent">Agents</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <HeaderCheckbox allSelected={selection.allSelected} someSelected={selection.someSelected} onToggle={selection.toggleAll} />
                </TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={9} />
              ) : !customers?.length ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No customers found</TableCell></TableRow>
              ) : (
                customers.map((c: any) => (
                  <TableRow key={c.id} data-state={selection.isSelected(c.id) ? "selected" : undefined}>
                    <TableCell><RowCheckbox checked={selection.isSelected(c.id)} onToggle={() => selection.toggle(c.id)} /></TableCell>
                    <TableCell className="font-medium">{c.company_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={typeColors[c.customer_type] ?? ""}>{typeLabels[c.customer_type] ?? c.customer_type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{c.contact_person ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.email ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.whatsapp_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditId(null); setForm(emptyForm); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editId ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); upsert.mutate(); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Type</Label>
                <Select value={form.customer_type} onValueChange={(v) => set("customer_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buyer">Buyer</SelectItem>
                    <SelectItem value="shipping_line">Shipping Line</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Company Name *</Label>
                <Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Contact Person</Label>
                <Input value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp Number</Label>
                <Input value={form.whatsapp_number} onChange={(e) => set("whatsapp_number", e.target.value)} placeholder="+1234567890" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tax ID</Label>
                <Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>KRA PIN</Label>
                <Input value={form.kra_pin} onChange={(e) => set("kra_pin", e.target.value)} placeholder="e.g. A123456789B" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Currency <span className="text-destructive">*</span></Label>
              <CurrencySelect
                value={form.currency || null}
                onChange={(v) => set("currency", v)}
                placeholder="Select currency (required)"
              />
              <p className="text-xs text-muted-foreground">All invoices, quotes and payments for this customer will use this currency.</p>
            </div>
            <div className="space-y-2 flex items-end gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="rounded" />
                <span className="text-sm">Active</span>
              </label>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
            </div>
            <Button type="submit" className="w-full" disabled={upsert.isPending}>{editId ? "Update" : "Add"} Customer</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
