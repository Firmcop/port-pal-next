import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Tags, Sparkles, Pencil, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";

type Form = {
  id?: string;
  code: string;
  name: string;
  gl_account_id: string;
  tax_code_id: string;
  depot_id: string;
  project_id: string;
  is_capitalisable: boolean;
  is_active: boolean;
  sort_order: number;
};

const emptyForm = (): Form => ({
  code: "", name: "", gl_account_id: "", tax_code_id: "", depot_id: "", project_id: "",
  is_capitalisable: false, is_active: true, sort_order: 100,
});

export default function ExpenseCategories() {
  const org = useOrganization();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm());
  const [search, setSearch] = useState("");

  const { data: categories, isLoading } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("expense_categories")
        .select("*, gl_accounts(code,name,is_active,account_type), tax_codes(code,rate), depots(name), projects(code)")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: glAccounts } = useQuery({
    queryKey: ["gl-accounts-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gl_accounts")
        .select("id,code,name,account_type")
        .eq("is_active", true)
        .in("account_type", ["expense", "cost_of_goods"])
        .order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: taxCodes } = useQuery({
    queryKey: ["tax-codes-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("tax_codes").select("id,code,name,rate").eq("is_active", true).order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: depots } = useQuery({
    queryKey: ["depots-for-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("depots").select("id,name").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ["projects-for-expense"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("projects").select("id,code,name").order("code");
      if (error) throw error;
      return data as any[];
    },
  });

  const seed = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("ensure_default_expense_categories", { _org_id: org.organizationId });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      toast({ title: n ? `${n} categories created` : "Categories already up to date" });
    },
    onError: (e: any) => toast({ title: "Could not seed categories", description: e.message, variant: "destructive" }),
  });

  // Auto-seed once when empty
  useEffect(() => {
    if (!isLoading && categories && categories.length === 0 && org.organizationId) {
      (supabase as any).rpc("ensure_default_expense_categories", { _org_id: org.organizationId }).then(() => {
        qc.invalidateQueries({ queryKey: ["expense-categories"] });
      });
    }
  }, [isLoading, categories, org.organizationId, qc]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        organization_id: org.organizationId,
        code: form.code || null,
        name: form.name,
        gl_account_id: form.gl_account_id,
        tax_code_id: form.tax_code_id || null,
        depot_id: form.depot_id || null,
        project_id: form.project_id || null,
        is_capitalisable: form.is_capitalisable,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 100,
      };
      if (form.id) {
        const { error } = await (supabase as any).from("expense_categories").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("expense_categories").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      setOpen(false);
      setForm(emptyForm());
      toast({ title: "Category saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const edit = (c: any) => {
    setForm({
      id: c.id,
      code: c.code ?? "",
      name: c.name,
      gl_account_id: c.gl_account_id,
      tax_code_id: c.tax_code_id ?? "",
      depot_id: c.depot_id ?? "",
      project_id: c.project_id ?? "",
      is_capitalisable: !!c.is_capitalisable,
      is_active: !!c.is_active,
      sort_order: c.sort_order ?? 100,
    });
    setOpen(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories ?? [];
    return (categories ?? []).filter((c) =>
      [c.name, c.code, c.gl_accounts?.code, c.gl_accounts?.name].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [categories, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Tags className="h-6 w-6" />Expense Categories</h1>
          <p className="text-muted-foreground">Map each expense category to its ledger account and default tax rule.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
            <Sparkles className="h-4 w-4 mr-1" />Seed from chart of accounts
          </Button>
          <Button size="sm" onClick={() => { setForm(emptyForm()); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />New category
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <Label className="text-xs">Search</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Category or account…" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>GL account</TableHead>
                <TableHead>Default tax</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !filtered.length ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No categories yet — seed them from the chart of accounts.</TableCell></TableRow>
              ) : filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.code ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {c.gl_accounts ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs text-muted-foreground">{c.gl_accounts.code}</span>
                        {c.gl_accounts.name}
                        {!c.gl_accounts.is_active && (
                          <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />inactive
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-destructive text-destructive">
                        <AlertTriangle className="h-3 w-3" />missing account
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{c.tax_codes ? `${c.tax_codes.code} (${c.tax_codes.rate}%)` : "—"}</TableCell>
                  <TableCell className="text-xs">{c.depots?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{c.projects?.code ?? "—"}</TableCell>
                  <TableCell>
                    {c.is_capitalisable && <Badge variant="outline" className="mr-1">capex</Badge>}
                    {c.is_active
                      ? <Badge variant="secondary" className="bg-success/15 text-success">active</Badge>
                      : <Badge variant="secondary">inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => edit(c)}><Pencil className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Edit category" : "New expense category"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Motor vehicle fuel" /></div>
            <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Optional" /></div>
            <div><Label>Sort order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
            <div className="sm:col-span-2">
              <Label>GL account</Label>
              <Select value={form.gl_account_id} onValueChange={(v) => setForm({ ...form, gl_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select expense account…" /></SelectTrigger>
                <SelectContent>
                  {(glAccounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Default tax code</Label>
              <Select value={form.tax_code_id || NONE} onValueChange={(v) => setForm({ ...form, tax_code_id: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(taxCodes ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.code} ({t.rate}%)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Default depot</Label>
              <Select value={form.depot_id || NONE} onValueChange={(v) => setForm({ ...form, depot_id: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(depots ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Default project</Label>
              <Select value={form.project_id || NONE} onValueChange={(v) => setForm({ ...form, project_id: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><Label className="text-sm">Capitalisable</Label><p className="text-xs text-muted-foreground">Usually becomes a fixed asset</p></div>
              <Switch checked={form.is_capitalisable} onCheckedChange={(v) => setForm({ ...form, is_capitalisable: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><Label className="text-sm">Active</Label><p className="text-xs text-muted-foreground">Available when posting</p></div>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.name || !form.gl_account_id || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
