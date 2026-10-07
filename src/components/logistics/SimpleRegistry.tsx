import { useState, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "switch";
  options?: { value: string; label: string }[];
  span?: 1 | 2;
  optional?: boolean;
};

export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
};

interface Props<T extends { id: string }> {
  title: string;
  icon?: ReactNode;
  table: string;
  searchField?: string;
  orderBy?: string;
  fields: Field[];
  columns: Column<T>[];
  defaultForm?: Record<string, any>;
  toFormValues?: (row: T) => Record<string, any>;
  enrichSelect?: string;
}

export function SimpleRegistry<T extends { id: string }>({
  title,
  icon,
  table,
  searchField = "name",
  orderBy = "name",
  fields,
  columns,
  defaultForm = {},
  toFormValues,
  enrichSelect = "*",
}: Props<T>) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Record<string, any>>(defaultForm);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const { data, isLoading } = useQuery({
    queryKey: [table, search],
    queryFn: async () => {
      let q = (supabase.from(table as any) as any).select(enrichSelect).order(orderBy);
      if (search && searchField) q = q.ilike(searchField, `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      const payload: any = {};
      for (const k of Object.keys(form)) {
        const v = form[k];
        payload[k] = v === "" ? null : v;
      }
      if (editId) {
        const { error } = await (supabase.from(table as any) as any).update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from(table as any) as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
      toast({ title: editId ? `${title} updated` : `${title} added` });
      setOpen(false);
      setEditId(null);
      setForm(defaultForm);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openEdit = (row: any) => {
    setEditId(row.id);
    setForm(toFormValues ? toFormValues(row) : { ...defaultForm, ...row });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">{icon}{title}</h1>
          <p className="text-muted-foreground">{data?.length ?? 0} {title.toLowerCase()}</p>
        </div>
        <Button onClick={() => { setEditId(null); setForm(defaultForm); setOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </div>

      {searchField && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : (data ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">No records</TableCell></TableRow>
              ) : (
                (data ?? []).map((row: any) => (
                  <TableRow key={row.id}>
                    {columns.map((c) => (
                      <TableCell key={c.key}>{c.render ? c.render(row) : (row[c.key] ?? "—")}</TableCell>
                    ))}
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editId ? `Edit ${title}` : `New ${title}`}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key} className={f.span === 2 ? "col-span-2" : ""}>
                <Label>{f.label}{f.optional ? <span className="text-muted-foreground"> (optional)</span> : null}</Label>
                {f.type === "select" ? (
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form[f.key] ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">—</option>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === "switch" ? (
                  <div className="flex items-center h-10">
                    <input type="checkbox" checked={!!form[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
                  </div>
                ) : (
                  <Input
                    type={f.type ?? "text"}
                    value={form[f.key] ?? ""}
                    onChange={(e) => set(f.key, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => upsert.mutate()} disabled={upsert.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StatusBadge({ value, tone }: { value: string; tone?: "default" | "secondary" | "destructive" | "outline" }) {
  return <Badge variant={tone ?? "secondary"}>{value}</Badge>;
}
