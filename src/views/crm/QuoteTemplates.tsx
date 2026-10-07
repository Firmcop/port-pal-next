import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Copy, Edit, Trash2, Plus, FileText, Printer, History, Import, BookOpen, Save, Upload, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { printQuote } from "@/lib/document-templates";
import { UploadQuoteFileDialog } from "@/components/quotes/UploadQuoteFileDialog";
import { InsertSectionPackDialog } from "@/components/quotes/InsertSectionPackDialog";
import { useOrganization } from "@/hooks/use-organization";

export default function QuoteTemplates() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("__all__");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionsOf, setVersionsOf] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("full");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["quote-templates-admin", search, kindFilter],
    queryFn: async () => {
      let q = (supabase as any).from("quote_templates").select("*").order("updated_at", { ascending: false });
      if (kindFilter !== "__all__") q = q.eq("kind", kindFilter);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const createTpl = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).from("quote_templates").insert({
        name: newName, kind: newKind, is_active: true,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast({ title: "Template created" });
      setNewOpen(false); setNewName("");
      qc.invalidateQueries({ queryKey: ["quote-templates-admin"] });
      setEditingId(id);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cloneTpl = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("clone_quote_template", { _template_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Template cloned" });
      qc.invalidateQueries({ queryKey: ["quote-templates-admin"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTpl = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("quote_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Template deleted" });
      qc.invalidateQueries({ queryKey: ["quote-templates-admin"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" />Quote Templates</h1>
          <p className="text-muted-foreground text-sm">Reusable BOQ templates &amp; section packs for your sales team.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-1 h-4 w-4" />Upload File
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Import className="mr-1 h-4 w-4" />Import from Quote
          </Button>
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />New Template
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-2 items-center">
            <Input placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All kinds</SelectItem>
                <SelectItem value="full">Full quote</SelectItem>
                <SelectItem value="pack">Section pack</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              ) : templates.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No templates yet.</TableCell></TableRow>
              ) : templates.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <div>{t.name}</div>
                    {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{t.kind}</Badge></TableCell>
                  <TableCell className="text-sm">{t.updated_at ? format(new Date(t.updated_at), "MMM d, yyyy") : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={t.is_active ? "default" : "secondary"}>{t.is_active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(t.id)}>
                        <Edit className="h-3 w-3 mr-1" />Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cloneTpl.mutate(t.id)}>
                        <Copy className="h-3 w-3 mr-1" />Clone
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setVersionsOf(t.id)}>
                        <History className="h-3 w-3 mr-1" />Versions
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        if (confirm(`Delete template "${t.name}"?`)) deleteTpl.mutate(t.id);
                      }}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. 20ft Office Container" />
            </div>
            <div>
              <Label>Kind</Label>
              <Select value={newKind} onValueChange={setNewKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full quote</SelectItem>
                  <SelectItem value="pack">Section pack</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={() => createTpl.mutate()} disabled={!newName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplateEditorDialog
        templateId={editingId}
        onClose={() => setEditingId(null)}
      />

      <ImportFromQuoteDialog open={importOpen} onOpenChange={setImportOpen} />

      <UploadQuoteFileDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={(id) => setEditingId(id)}
      />

      <VersionsDialog templateId={versionsOf} onClose={() => setVersionsOf(null)} />
    </div>
  );
}

/* ----------------- Inline Editor ----------------- */

function TemplateEditorDialog({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const open = !!templateId;
  const [showInsertPack, setShowInsertPack] = useState(false);

  const { data: tpl } = useQuery({
    queryKey: ["quote-template-edit", templateId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("quote_templates").select("*").eq("id", templateId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: sections = [] } = useQuery({
    queryKey: ["quote-template-sections", templateId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("quote_template_sections")
        .select("*").eq("template_id", templateId).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: items = [] } = useQuery({
    queryKey: ["quote-template-items", templateId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("quote_template_items")
        .select("*").eq("template_id", templateId).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["quote-template-edit", templateId] });
    qc.invalidateQueries({ queryKey: ["quote-template-sections", templateId] });
    qc.invalidateQueries({ queryKey: ["quote-template-items", templateId] });
    qc.invalidateQueries({ queryKey: ["quote-templates-admin"] });
  };

  const saveHeader = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await (supabase as any).from("quote_templates").update(patch).eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Saved" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addSection = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("quote_template_sections").insert({
        template_id: templateId, title: "New Section", kind: "other", sort_order: sections.length,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const updateSection = useMutation({
    mutationFn: async ({ id, patch }: any) => {
      const { error } = await (supabase as any).from("quote_template_sections").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const deleteSection = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("quote_template_sections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const addItem = useMutation({
    mutationFn: async (sectionId: string) => {
      const { error } = await (supabase as any).from("quote_template_items").insert({
        template_id: templateId, section_id: sectionId,
        description: "New item", unit: "pc", default_quantity: 1, default_unit_price: 0,
        discount_pct: 0, tax_pct: 0, item_kind: "material",
        sort_order: items.filter((i: any) => i.section_id === sectionId).length,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, patch }: any) => {
      const { error } = await (supabase as any).from("quote_template_items").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("quote_template_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const snapshot = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("snapshot_quote_template", { _template_id: templateId, _note: "Manual snapshot" });
      if (error) throw error;
    },
    onSuccess: () => toast({ title: "Snapshot saved" }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handlePreviewPdf = async () => {
    if (!tpl) return;
    await printQuote({
      quote_number: `TPL-${tpl.name}`,
      status: "draft",
      created_at: new Date().toISOString(),
      valid_until: null,
      notes: tpl.default_notes ?? null,
      customer: { company_name: "<Customer Name>" } as any,
      organization: null,
      issuer_name: null,
      sections: sections.map((s: any) => ({
        id: s.id, title: s.title, kind: s.kind,
        items: items.filter((i: any) => i.section_id === s.id).map((i: any) => {
          const qty = Number(i.default_quantity ?? 0);
          const price = Number(i.default_unit_price ?? 0);
          const total = qty * price *
            (1 - Number(i.discount_pct || 0) / 100) *
            (1 + Number(i.tax_pct || 0) / 100);
          return {
            description: i.description, unit: i.unit,
            quantity: qty, unit_price: price,
            discount_pct: Number(i.discount_pct || 0), tax_pct: Number(i.tax_pct || 0),
            total_price: total,
          };
        }),
      })),

    });
  };

  if (!open || !tpl) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent key={templateId} className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Edit Template</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handlePreviewPdf}>
                <Printer className="mr-1 h-4 w-4" />Preview PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => snapshot.mutate()}>
                <Save className="mr-1 h-4 w-4" />Snapshot
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="meta">
          <TabsList>
            <TabsTrigger value="meta">Details</TabsTrigger>
            <TabsTrigger value="sections">Sections &amp; Items</TabsTrigger>
            <TabsTrigger value="notes">Notes &amp; Terms</TabsTrigger>
          </TabsList>

          <TabsContent value="meta" className="space-y-3 mt-4">
            <div>
              <Label>Name</Label>
              <Input defaultValue={tpl.name} onBlur={(e) => saveHeader.mutate({ name: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea defaultValue={tpl.description ?? ""} onBlur={(e) => saveHeader.mutate({ description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kind</Label>
                <Select defaultValue={tpl.kind} onValueChange={(v) => saveHeader.mutate({ kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full quote</SelectItem>
                    <SelectItem value="pack">Section pack</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select defaultValue={tpl.is_active ? "active" : "inactive"} onValueChange={(v) => saveHeader.mutate({ is_active: v === "active" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <TemplateReferenceFileField tpl={tpl} onSaved={invalidate} />
          </TabsContent>

          <TabsContent value="sections" className="space-y-3 mt-4">
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowInsertPack(true)}>
                <BookOpen className="mr-1 h-4 w-4" />Insert Section Pack
              </Button>
              <Button size="sm" onClick={() => addSection.mutate()}>
                <Plus className="mr-1 h-4 w-4" />Add Section
              </Button>
            </div>
            {sections.map((s: any) => {
              const secItems = items.filter((i: any) => i.section_id === s.id);
              return (
                <Card key={s.id}>
                  <CardHeader className="pb-2">
                    <div className="flex gap-2 items-center">
                      <Input className="font-semibold" defaultValue={s.title}
                        onBlur={(e) => updateSection.mutate({ id: s.id, patch: { title: e.target.value } })} />
                      <Input className="w-32" defaultValue={s.kind}
                        onBlur={(e) => updateSection.mutate({ id: s.id, patch: { kind: e.target.value } })} />
                      <Button size="icon" variant="ghost" onClick={() => {
                        if (confirm("Delete this section and its items?")) deleteSection.mutate(s.id);
                      }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[40%]">Description</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Disc %</TableHead>
                          <TableHead className="text-right">Tax %</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {secItems.map((i: any) => (
                          <TableRow key={i.id}>
                            <TableCell><Input defaultValue={i.description}
                              onBlur={(e) => updateItem.mutate({ id: i.id, patch: { description: e.target.value } })} /></TableCell>
                            <TableCell><Input className="w-16" defaultValue={i.unit ?? ""}
                              onBlur={(e) => updateItem.mutate({ id: i.id, patch: { unit: e.target.value } })} /></TableCell>
                            <TableCell><Input type="number" className="w-20 text-right" defaultValue={i.default_quantity}
                              onBlur={(e) => updateItem.mutate({ id: i.id, patch: { default_quantity: Number(e.target.value) } })} /></TableCell>
                            <TableCell><Input type="number" className="w-28 text-right" defaultValue={i.default_unit_price}
                              onBlur={(e) => updateItem.mutate({ id: i.id, patch: { default_unit_price: Number(e.target.value) } })} /></TableCell>

                            <TableCell><Input type="number" className="w-16 text-right" defaultValue={i.discount_pct ?? 0}
                              onBlur={(e) => updateItem.mutate({ id: i.id, patch: { discount_pct: Number(e.target.value) } })} /></TableCell>
                            <TableCell><Input type="number" className="w-16 text-right" defaultValue={i.tax_pct ?? 0}
                              onBlur={(e) => updateItem.mutate({ id: i.id, patch: { tax_pct: Number(e.target.value) } })} /></TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" onClick={() => deleteItem.mutate(i.id)}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Button size="sm" variant="outline" onClick={() => addItem.mutate(s.id)}>
                      <Plus className="mr-1 h-3 w-3" />Add Item
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            {sections.length === 0 && (
              <div className="text-center text-muted-foreground py-6">No sections yet.</div>
            )}
          </TabsContent>

          <TabsContent value="notes" className="space-y-3 mt-4">
            <div>
              <Label>Default Notes</Label>
              <Textarea rows={5} defaultValue={tpl.default_notes ?? ""}
                onBlur={(e) => saveHeader.mutate({ default_notes: e.target.value })} />
            </div>
            <div>
              <Label>Default Terms</Label>
              <Textarea rows={5} defaultValue={tpl.default_terms ?? ""}
                onBlur={(e) => saveHeader.mutate({ default_terms: e.target.value })} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
      {templateId && (
        <InsertSectionPackDialog
          targetTemplateId={templateId}
          open={showInsertPack}
          onOpenChange={setShowInsertPack}
          onInserted={invalidate}
        />
      )}
    </Dialog>
  );
}

/* ----------------- Import from quote ----------------- */

function ImportFromQuoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data: quotes = [] } = useQuery({
    queryKey: ["quotes-for-import", search],
    enabled: open,
    queryFn: async () => {
      let q = (supabase as any).from("quotes").select("id, quote_number, customers(company_name)").order("created_at", { ascending: false }).limit(40);
      if (search.trim()) q = q.ilike("quote_number", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const importMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("save_quote_as_template", {
        _quote_id: selected, _name: name, _kind: "full",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Template imported" });
      qc.invalidateQueries({ queryKey: ["quote-templates-admin"] });
      onOpenChange(false);
      setSelected(null); setName("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Import Template from Existing Quote</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Search quote number…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="border rounded max-h-64 overflow-y-auto">
            {quotes.map((q: any) => (
              <div key={q.id}
                className={`px-3 py-2 cursor-pointer hover:bg-muted ${selected === q.id ? "bg-muted" : ""}`}
                onClick={() => setSelected(q.id)}>
                <div className="font-medium text-sm">{q.quote_number}</div>
                <div className="text-xs text-muted-foreground">{q.customers?.company_name ?? "—"}</div>
              </div>
            ))}
            {quotes.length === 0 && <div className="px-3 py-4 text-center text-sm text-muted-foreground">No quotes found.</div>}
          </div>
          <div>
            <Label>New template name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Workshop 40ft Layout" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => importMut.mutate()} disabled={!selected || !name.trim()}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------- Versions ----------------- */

function VersionsDialog({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const open = !!templateId;
  const { data: versions = [] } = useQuery({
    queryKey: ["template-versions", templateId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quote_template_versions").select("*").eq("template_id", templateId)
        .order("created_at", { ascending: false });
      if (error) return [];
      return data ?? [];
    },
  });
  const restoreMut = useMutation({
    mutationFn: async (versionId: string) => {
      const { error } = await (supabase as any).rpc("restore_quote_template_version", { _version_id: versionId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Version restored" });
      qc.invalidateQueries({ queryKey: ["quote-templates-admin"] });
      qc.invalidateQueries({ queryKey: ["quote-template-sections", templateId] });
      qc.invalidateQueries({ queryKey: ["quote-template-items", templateId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Version History</DialogTitle></DialogHeader>
        {versions.length === 0 ? (
          <div className="text-center text-muted-foreground py-6">No snapshots yet. Use the Snapshot button in the editor to save one.</div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Note</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {versions.map((v: any) => (
                <TableRow key={v.id}>
                  <TableCell className="text-sm">{format(new Date(v.created_at), "MMM d, yyyy HH:mm")}</TableCell>
                  <TableCell className="text-sm">{v.note ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => {
                      if (confirm("Restore this version? Current sections/items will be replaced.")) restoreMut.mutate(v.id);
                    }}>Restore</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateReferenceFileField({ tpl, onSaved }: { tpl: any; onSaved: () => void }) {
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const kindFromMime = (m: string): "pdf" | "spreadsheet" | "other" => {
    if (m === "application/pdf") return "pdf";
    if (m.includes("spreadsheet") || m.includes("excel") || m.includes("csv")) return "spreadsheet";
    return "other";
  };

  const download = async () => {
    if (!tpl.reference_file_url) return;
    const { data, error } = await supabase.storage
      .from("quote-template-refs")
      .createSignedUrl(tpl.reference_file_url, 60);
    if (error) return toast({ title: "Download failed", description: error.message, variant: "destructive" });
    window.open(data.signedUrl, "_blank");
  };

  const upload = async (file: File) => {
    if (!organizationId) return;
    setBusy(true);
    try {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
      const path = `${organizationId}/${tpl.id}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("quote-template-refs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      // Best effort: remove previous file
      if (tpl.reference_file_url) {
        await supabase.storage.from("quote-template-refs").remove([tpl.reference_file_url]);
      }
      const { error: updErr } = await (supabase as any).from("quote_templates").update({
        reference_file_url: path,
        reference_file_name: file.name,
        reference_file_kind: kindFromMime(file.type),
      }).eq("id", tpl.id);
      if (updErr) throw updErr;
      toast({ title: "Starter file uploaded" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!tpl.reference_file_url) return;
    setBusy(true);
    try {
      await supabase.storage.from("quote-template-refs").remove([tpl.reference_file_url]);
      await (supabase as any).from("quote_templates").update({
        reference_file_url: null, reference_file_name: null, reference_file_kind: null,
      }).eq("id", tpl.id);
      toast({ title: "Removed" });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between">
        <div>
          <Label>Starter file (PDF or spreadsheet)</Label>
          <p className="text-xs text-muted-foreground">
            Attach a reference quote built elsewhere. Use it as the source of truth while you map its
            content into the sections and items above.
          </p>
        </div>
        {tpl.reference_file_url && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{tpl.reference_file_kind ?? "file"}</Badge>
            <Button size="sm" variant="outline" onClick={download}>
              <Download className="mr-1 h-3.5 w-3.5" />{tpl.reference_file_name ?? "Download"}
            </Button>
            <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </div>
      <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
        <input
          type="file"
          className="hidden"
          accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }}
        />
        <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-accent">
          <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : tpl.reference_file_url ? "Replace file" : "Upload starter file"}
        </span>
      </label>
    </div>
  );
}
