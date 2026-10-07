import { useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, ArrowLeft, FileText, Save, CheckCircle, Printer, Send, ThumbsUp, ThumbsDown, History, BookOpen, Camera, Layers, BookmarkPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { printQuote } from "@/lib/document-templates";
import { CatalogPicker } from "@/components/quotes/CatalogPicker";
import { TemplatePicker } from "@/components/quotes/TemplatePicker";
import QuoteVersionHistory from "@/components/quotes/QuoteVersionHistory";
import { ApprovalTimeline } from "@/components/approvals/ApprovalTimeline";
import QuoteVisualsTab from "@/components/quotes/QuoteVisualsTab";
import { QuoteAdminActions } from "@/components/quotes/QuoteAdminActions";

import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { useOrganization } from "@/hooks/use-organization";

const SECTION_KINDS = [
  "container", "fabrication", "subassembly", "service",
  "transport", "electrical", "plumbing", "flooring", "other",
] as const;

const ITEM_KINDS = [
  "container", "material", "subassembly", "service", "labor", "transport", "custom",
] as const;

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  sent: "bg-info/15 text-info",
  accepted: "bg-success/15 text-success",
  expired: "bg-warning/15 text-warning",
};

const SECTION_PRESETS: { title: string; kind: typeof SECTION_KINDS[number] }[] = [
  { title: "Container Unit(s)", kind: "container" },
  { title: "Fabrication Works", kind: "fabrication" },
  { title: "Sub-assemblies (Doors, Windows, …)", kind: "subassembly" },
  { title: "Electrical Installation", kind: "electrical" },
  { title: "Plumbing", kind: "plumbing" },
  { title: "Flooring", kind: "flooring" },
  { title: "Transport & Logistics", kind: "transport" },
  { title: "Other Services", kind: "service" },
];

function lineTotal(qty: number, price: number, disc: number, tax: number) {
  return qty * price * (1 - (disc || 0) / 100) * (1 + (tax || 0) / 100);
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin } = useUserStaffRole();
  const org = useOrganization();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSectionId, setPickerSectionId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [packSectionId, setPackSectionId] = useState<string | null>(null);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [saveTplName, setSaveTplName] = useState("");
  const [saveTplDesc, setSaveTplDesc] = useState("");
  const [savePackOpen, setSavePackOpen] = useState(false);
  const [savePackSectionId, setSavePackSectionId] = useState<string | null>(null);
  const [savePackName, setSavePackName] = useState("");

  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, customers(id, company_name)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: sections } = useQuery({
    queryKey: ["quote-sections", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quote_sections")
        .select("*")
        .eq("quote_id", id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

  const { data: items } = useQuery({
    queryKey: ["quote-items", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_items")
        .select("*")
        .eq("quote_id", id!)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

  const { data: materials } = useQuery({
    queryKey: ["materials-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materials")
        .select("id, name, unit, unit_cost")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-available"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, category, status")
        .eq("status", "available")
        .order("container_number")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const { data: subAssemblies } = useQuery({
    queryKey: ["sub-assembly-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sub_assembly_stock")
        .select("id, name, assembly_type, uom, avg_unit_cost")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["quote", id] });
    qc.invalidateQueries({ queryKey: ["quote-sections", id] });
    qc.invalidateQueries({ queryKey: ["quote-items", id] });
  };

  const addSection = useMutation({
    mutationFn: async (preset?: { title: string; kind: string }) => {
      const sortOrder = (sections?.length ?? 0) * 10;
      const { error } = await (supabase as any).from("quote_sections").insert({
        quote_id: id,
        title: preset?.title ?? "New Section",
        kind: preset?.kind ?? "other",
        sort_order: sortOrder,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateSection = useMutation({
    mutationFn: async ({ id: sid, patch }: { id: string; patch: any }) => {
      const { error } = await (supabase as any).from("quote_sections").update(patch).eq("id", sid);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteSection = useMutation({
    mutationFn: async (sid: string) => {
      const { error } = await (supabase as any).from("quote_sections").delete().eq("id", sid);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const addItem = useMutation({
    mutationFn: async (sectionId: string) => {
      const { error } = await supabase.from("quote_items").insert({
        quote_id: id,
        section_id: sectionId,
        item_type: "custom",
        item_kind: "custom",
        description: "",
        quantity: 1,
        unit_price: 0,
      } as any);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateItem = useMutation({
    mutationFn: async ({ id: iid, patch }: { id: string; patch: any }) => {
      const { error } = await supabase.from("quote_items").update(patch as any).eq("id", iid);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: async (iid: string) => {
      const { error } = await supabase.from("quote_items").delete().eq("id", iid);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateQuote = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await supabase.from("quotes").update(patch as any).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const acceptAndOrder = useMutation({
    mutationFn: async () => {
      if (!quote) return null;
      if (quote.status !== "accepted") {
        await supabase.from("quotes").update({ status: "accepted" } as any).eq("id", id!);
      }
      const { data: existingSo } = await supabase.from("sales_orders").select("id").eq("quote_id", id!).maybeSingle();
      if (!existingSo) {
        const num = `SO-${Date.now().toString(36).toUpperCase()}`;
        const { error } = await supabase.from("sales_orders").insert({
          order_number: num, quote_id: id, customer_id: quote.customer_id,
          total_amount: quote.total_amount || 0, created_by: user?.id,
        } as any);
        if (error) throw error;
      }
      const { data: invRes, error: invErr } = await (supabase as any).rpc("generate_invoice_from_quote", { _quote_id: id });
      if (invErr) throw invErr;
      const row: any = Array.isArray(invRes) ? invRes[0] : invRes;
      return row ?? null;
    },
    onSuccess: (row: any) => {
      toast({
        title: "Sales order created",
        description: row?.invoice_number
          ? `Invoice ${row.invoice_number} ${row.already_existed ? "already existed" : "generated"}.`
          : undefined,
      });
      navigate("/sales-orders");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createConversionJob = useMutation({
    mutationFn: async () => {
      if (!quote) return null;
      const { convertQuoteToConversionJob } = await import("@/lib/quote-conversion");
      return convertQuoteToConversionJob(supabase as any, { quoteId: id!, userId: user?.id });
    },
    onSuccess: (res) => {
      if (!res) return;
      toast({
        title: res.alreadyExisted ? "Opening existing job" : "Conversion job created",
        description: res.alreadyExisted
          ? "This quote was already converted."
          : res.containerIds.length
            ? `${res.containerIds.length} container(s) attached. Enter materials, labour and services on the job page.`
            : "Enter materials, labour and services on the job page.",
      });
      navigate(`/conversions/${res.jobId}`);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createContainerSale = useMutation({
    mutationFn: async () => {
      if (!quote) return null;
      const { convertQuoteToContainerSales } = await import("@/lib/quote-conversion");
      return convertQuoteToContainerSales(supabase as any, { quoteId: id!, userId: user?.id });
    },
    onSuccess: (res) => {
      if (!res) return;
      toast({
        title: res.alreadyExisted ? "Sales already created" : "Container sale created",
        description: `${res.saleIds.length} sale record(s).`,
      });
      navigate(`/container-sales?quote=${id}`);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });




  const submitApproval = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("request_quote_approval", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Submitted for approval" }); invalidate(); qc.invalidateQueries({ queryKey: ["quote-versions", id] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const approveMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("approve_quote", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Quote approved" }); invalidate(); qc.invalidateQueries({ queryKey: ["quote-versions", id] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const rejectMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("reject_quote", { _id: id, _reason: rejectReason });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Quote rejected" }); setRejectOpen(false); setRejectReason(""); invalidate(); qc.invalidateQueries({ queryKey: ["quote-versions", id] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const snapshotMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc("snapshot_quote", { _id: id, _event: "manual", _note: "Manual snapshot" });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Snapshot saved" }); qc.invalidateQueries({ queryKey: ["quote-versions", id] }); },
  });

  const handlePrint = async () => {
    const orgRow = (org as any)?.organization ?? null;
    const { data: visualsData } = await (supabase as any)
      .from("quote_visuals").select("*").eq("quote_id", id);
    await printQuote({
      quote_number: quote!.quote_number,
      status: quote!.status,
      created_at: quote!.created_at,
      valid_until: quote!.valid_until,
      notes: quote!.notes,
      customer: quote!.customers ? { company_name: (quote!.customers as any).company_name } : null,
      organization: orgRow ? { name: orgRow.name, tax_id: orgRow.tax_id ?? null, address: orgRow.address ?? null } : null,
      issuer_name: user?.email ?? null,
      sections: (sections ?? []).map((sec) => ({
        id: sec.id, title: sec.title, kind: sec.kind,
        items: (itemsBySection.get(sec.id) ?? []).map((it) => ({
          description: it.description, unit: it.unit,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price),
          discount_pct: Number(it.discount_pct || 0), tax_pct: Number(it.tax_pct || 0),
          total_price: Number(it.total_price || 0),
        })),
      })),
      visuals: (visualsData ?? []).map((v: any) => ({
        id: v.id, section_id: v.section_id, kind: v.kind,
        image_url: v.image_url, caption: v.caption,
      })),
    });
  };


  const itemsBySection = useMemo(() => {
    const map = new Map<string, any[]>();
    (items ?? []).forEach((it) => {
      const key = it.section_id ?? "_unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    return map;
  }, [items]);

  const sectionTotals = useMemo(() => {
    const m = new Map<string, number>();
    (items ?? []).forEach((it) => {
      const key = it.section_id ?? "_unassigned";
      m.set(key, (m.get(key) ?? 0) + Number(it.total_price || 0));
    });
    return m;
  }, [items]);

  const grandTotal = (items ?? []).reduce((s, it) => s + Number(it.total_price || 0), 0);
  const totalDiscount = (items ?? []).reduce((s, it) => {
    const gross = Number(it.quantity || 0) * Number(it.unit_price || 0);
    return s + gross * (Number(it.discount_pct || 0) / 100);
  }, 0);
  const totalTax = (items ?? []).reduce((s, it) => {
    const net = Number(it.quantity || 0) * Number(it.unit_price || 0) * (1 - Number(it.discount_pct || 0) / 100);
    return s + net * (Number(it.tax_pct || 0) / 100);
  }, 0);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!quote) return <div className="p-8 text-muted-foreground">Quote not found.</div>;

  const editable = quote.status === "draft" && !(quote as any).archived_at;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/quotes"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6" />{quote.quote_number}
            </h1>
            <p className="text-sm text-muted-foreground">
              {quote.customers?.company_name ?? "—"} · created {format(new Date(quote.created_at), "dd MMM yyyy")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={statusColor[quote.status] ?? ""} variant="secondary">{quote.status.replace("_"," ")}</Badge>
          {(quote as any).archived_at && <Badge variant="secondary">Archived</Badge>}
          <QuoteAdminActions
            quote={quote as any}
            invalidateKeys={[["quotes"], ["quote", id]]}
            onDeleted={() => navigate("/quotes")}
          />
          <Button variant="outline" onClick={handlePrint}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>

          {editable && (
            <Button variant="outline" onClick={() => setTplOpen(true)}>
              <BookOpen className="mr-1 h-4 w-4" />Apply Template
            </Button>
          )}
          <Button variant="outline" onClick={() => { setSaveTplName(""); setSaveTplDesc(""); setSaveTplOpen(true); }}>
            <BookmarkPlus className="mr-1 h-4 w-4" />Save as Template
          </Button>
          {editable && (
            <Button onClick={() => submitApproval.mutate()} disabled={submitApproval.isPending}>
              <Send className="mr-1 h-4 w-4" />Submit for Approval
            </Button>
          )}
          {quote.status === "rejected" && (
            <Button onClick={() => submitApproval.mutate()} disabled={submitApproval.isPending}>
              <Send className="mr-1 h-4 w-4" />Re-submit
            </Button>
          )}
          {quote.status === "pending_approval" && isAdmin && (
            <>
              <Button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
                <ThumbsUp className="mr-1 h-4 w-4" />Approve
              </Button>
              <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                <ThumbsDown className="mr-1 h-4 w-4" />Reject
              </Button>
            </>
          )}
          {(quote.status === "approved" || quote.status === "accepted") && (
            <>
              <Button onClick={() => acceptAndOrder.mutate()} disabled={acceptAndOrder.isPending}>
                <CheckCircle className="mr-1 h-4 w-4" />
                {quote.status === "accepted" ? "Generate Invoice" : "Accept & Order"}
              </Button>
              <Button variant="outline" onClick={() => createConversionJob.mutate()} disabled={createConversionJob.isPending}>
                <Layers className="mr-1 h-4 w-4" />Create Conversion Job
              </Button>
              <Button variant="outline" onClick={() => createContainerSale.mutate()} disabled={createContainerSale.isPending}>
                <FileText className="mr-1 h-4 w-4" />Create Container Sale
              </Button>
            </>
          )}

        </div>
      </div>

      {quote.status === "rejected" && quote.rejection_reason && (
        <div className="border-l-4 border-destructive bg-destructive/5 px-4 py-2 text-sm">
          <strong>Rejection reason:</strong> {quote.rejection_reason}
        </div>
      )}

      <Tabs defaultValue="builder">
        <TabsList>
          <TabsTrigger value="builder"><FileText className="mr-1 h-3 w-3" />Builder</TabsTrigger>
          <TabsTrigger value="visuals"><Camera className="mr-1 h-3 w-3" />Visuals</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-1 h-3 w-3" />History</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
        </TabsList>



        <TabsContent value="builder" className="mt-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-6">
        <div className="space-y-4">
          {!editable && (
            <div className="border rounded p-2 text-xs text-muted-foreground bg-muted/40">
              Editing is locked because the quote is <strong>{quote.status.replace("_"," ")}</strong>. {quote.status === "rejected" ? "Re-submit to revise." : ""}
            </div>
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">Quote Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Valid Until</Label>
                <Input type="date" defaultValue={quote.valid_until ?? ""}
                  onBlur={(e) => updateQuote.mutate({ valid_until: e.target.value || null })} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Notes</Label>
                <Textarea rows={2} defaultValue={quote.notes ?? ""}
                  onBlur={(e) => updateQuote.mutate({ notes: e.target.value || null })} />
              </div>
            </CardContent>
          </Card>

          {(!sections || sections.length === 0) && (
            <Card>
              <CardContent className="p-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Build a comprehensive quote by adding sections (e.g. for a container house: container unit, fabrication, sub-assemblies, electrical, plumbing, transport).
                </p>
                <div className="flex flex-wrap gap-2">
                  {SECTION_PRESETS.map((p) => (
                    <Button key={p.title} size="sm" variant="outline" onClick={() => addSection.mutate(p)}>
                      <Plus className="mr-1 h-3 w-3" />{p.title}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {sections?.map((sec) => (
            <Card key={sec.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    className="h-8 max-w-md font-semibold"
                    defaultValue={sec.title}
                    onBlur={(e) => e.target.value !== sec.title && updateSection.mutate({ id: sec.id, patch: { title: e.target.value } })}
                  />
                  <Select value={sec.kind} onValueChange={(v) => updateSection.mutate({ id: sec.id, patch: { kind: v } })}>
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SECTION_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                    </SelectContent>
                </Select>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {editable && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => { setPickerSectionId(sec.id); setPickerOpen(true); }}>
                        <BookOpen className="mr-1 h-3 w-3" />Add from catalog
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => { setPackSectionId(sec.id); setPackOpen(true); }}>
                        <Layers className="mr-1 h-3 w-3" />Add Pack
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" onClick={() => { setSavePackSectionId(sec.id); setSavePackName(sec.title); setSavePackOpen(true); }}>
                    <BookmarkPlus className="mr-1 h-3 w-3" />Save as Pack
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteSection.mutate(sec.id)} disabled={!editable}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Type</TableHead>
                      <TableHead>Item / Description</TableHead>
                      <TableHead className="w-20">Unit</TableHead>
                      <TableHead className="w-20 text-right">Qty</TableHead>
                      <TableHead className="w-28 text-right">Unit Price</TableHead>
                      <TableHead className="w-20 text-right">Disc %</TableHead>
                      <TableHead className="w-20 text-right">Tax %</TableHead>
                      <TableHead className="w-28 text-right">Line Total</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(itemsBySection.get(sec.id) ?? []).map((it) => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        materials={materials ?? []}
                        containers={containers ?? []}
                        subAssemblies={subAssemblies ?? []}
                        onPatch={(patch) => updateItem.mutate({ id: it.id, patch })}
                        onDelete={() => deleteItem.mutate(it.id)}
                      />
                    ))}
                    <TableRow>
                      <TableCell colSpan={9}>
                        <Button size="sm" variant="ghost" onClick={() => addItem.mutate(sec.id)}>
                          <Plus className="mr-1 h-3 w-3" />Add line item
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/40">
                      <TableCell colSpan={7} className="text-right font-medium">Section Subtotal</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{fmt(sectionTotals.get(sec.id) ?? 0)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}

          {sections && sections.length > 0 && (
            <div className="flex justify-center">
              <Select onValueChange={(v) => {
                const preset = SECTION_PRESETS.find((p) => p.title === v);
                addSection.mutate(preset);
              }}>
                <SelectTrigger className="w-72"><SelectValue placeholder="+ Add another section…" /></SelectTrigger>
                <SelectContent>
                  {SECTION_PRESETS.map((p) => <SelectItem key={p.title} value={p.title}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 self-start">
          <Card>
            <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {sections?.length ? (
                <div className="space-y-1">
                  {sections.map((sec) => (
                    <div key={sec.id} className="flex justify-between">
                      <span className="text-muted-foreground truncate pr-2">{sec.title}</span>
                      <span className="font-mono">{fmt(sectionTotals.get(sec.id) ?? 0)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No sections yet.</p>
              )}
              <div className="border-t pt-3 space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Discount</span><span className="font-mono">−{fmt(totalDiscount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Tax</span><span className="font-mono">{fmt(totalTax)}</span>
                </div>
                <div className="flex justify-between text-base font-bold pt-2 border-t">
                  <span>Grand Total</span><span className="font-mono">{fmt(grandTotal)}</span>
                </div>
              </div>
              <Button className="w-full" variant="outline" onClick={() => snapshotMut.mutate()}>
                <Camera className="mr-1 h-4 w-4" />Save snapshot
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>
        <TabsContent value="visuals" className="mt-4">
          <QuoteVisualsTab quoteId={id!} sections={(sections ?? []).map((s: any) => ({ id: s.id, title: s.title }))} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <QuoteVersionHistory quoteId={id!} />
        </TabsContent>
        <TabsContent value="approvals" className="mt-4">
          <ApprovalTimeline docType="quote" docId={id!} />
        </TabsContent>

      </Tabs>

      <CatalogPicker open={pickerOpen} onOpenChange={setPickerOpen} quoteId={id!} sectionId={pickerSectionId} />

      <TemplatePicker
        open={tplOpen}
        kind="full"
        onOpenChange={setTplOpen}
        onPick={async (templateId, mode) => {
          const { error } = await (supabase as any).rpc("apply_quote_template", {
            _quote_id: id, _template_id: templateId, _mode: mode,
          });
          if (error) {
            toast({ title: "Error applying template", description: error.message, variant: "destructive" });
            return;
          }
          toast({ title: "Template applied" });
          invalidate();
        }}
      />

      <TemplatePicker
        open={packOpen}
        kind="pack"
        onOpenChange={setPackOpen}
        onPick={async (templateId) => {
          if (!packSectionId) return;
          const { error } = await (supabase as any).rpc("apply_section_pack", {
            _section_id: packSectionId, _template_id: templateId,
          });
          if (error) {
            toast({ title: "Error adding pack", description: error.message, variant: "destructive" });
            return;
          }
          toast({ title: "Pack added" });
          invalidate();
        }}
      />

      <Dialog open={saveTplOpen} onOpenChange={setSaveTplOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save quote as template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Template name *</Label>
              <Input value={saveTplName} onChange={(e) => setSaveTplName(e.target.value)} placeholder="e.g. 20ft Container House" />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea rows={2} value={saveTplDesc} onChange={(e) => setSaveTplDesc(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              All sections and line items in this quote will be saved as a reusable template you and your team can apply to new quotes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveTplOpen(false)}>Cancel</Button>
            <Button
              disabled={!saveTplName.trim()}
              onClick={async () => {
                const { error } = await (supabase as any).rpc("save_quote_as_template", {
                  _quote_id: id, _name: saveTplName.trim(), _description: saveTplDesc.trim() || null, _category: null,
                });
                if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
                toast({ title: "Saved as template" });
                setSaveTplOpen(false);
                qc.invalidateQueries({ queryKey: ["quote-templates"] });
              }}
            >Save Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={savePackOpen} onOpenChange={setSavePackOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save section as pack</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Pack name *</Label>
              <Input value={savePackName} onChange={(e) => setSavePackName(e.target.value)} placeholder="e.g. Standard Electrical" />
            </div>
            <p className="text-xs text-muted-foreground">
              Saves only this section's items as a reusable pack that can be appended to any section in future quotes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSavePackOpen(false)}>Cancel</Button>
            <Button
              disabled={!savePackName.trim() || !savePackSectionId}
              onClick={async () => {
                const { error } = await (supabase as any).rpc("save_section_as_pack", {
                  _section_id: savePackSectionId, _name: savePackName.trim(), _category: null,
                });
                if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
                toast({ title: "Saved as pack" });
                setSavePackOpen(false);
                qc.invalidateQueries({ queryKey: ["quote-templates"] });
              }}
            >Save Pack</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Quote</DialogTitle></DialogHeader>
          <Label>Reason</Label>
          <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Explain why this quote is being rejected" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => rejectMut.mutate()} disabled={!rejectReason.trim() || rejectMut.isPending}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemRow({
  item, materials, containers, subAssemblies, onPatch, onDelete,
}: {
  item: any;
  materials: any[];
  containers: any[];
  subAssemblies: any[];
  onPatch: (patch: any) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(item);
  useMemo(() => setLocal(item), [item.id, item.total_price, item.unit_price, item.quantity, item.discount_pct, item.tax_pct, item.description, item.unit, item.item_kind, item.ref_id]);

  const set = (patch: any) => {
    const merged = { ...local, ...patch };
    setLocal(merged);
  };
  const commit = (patch: any) => onPatch(patch);

  const onPickRef = (val: string) => {
    if (local.item_kind === "material") {
      const m = materials.find((x) => x.id === val);
      if (m) commit({ ref_table: "materials", ref_id: m.id, description: m.name, unit: m.unit, unit_price: Number(m.unit_cost || 0) });
    } else if (local.item_kind === "container") {
      const c = containers.find((x) => x.id === val);
      if (c) commit({ ref_table: "containers", ref_id: c.id, description: `${c.container_number} (${c.size}' ${c.category})`, unit: "unit" });
    } else if (local.item_kind === "subassembly") {
      const s = subAssemblies.find((x) => x.id === val);
      if (s) commit({ ref_table: "sub_assembly_stock", ref_id: s.id, description: `${s.name} (${s.assembly_type})`, unit: s.uom, unit_price: Number(s.avg_unit_cost || 0) });
    }
  };

  const computed = lineTotal(
    Number(local.quantity || 0),
    Number(local.unit_price || 0),
    Number(local.discount_pct || 0),
    Number(local.tax_pct || 0),
  );

  return (
    <TableRow>
      <TableCell>
        <Select value={local.item_kind ?? "custom"} onValueChange={(v) => { set({ item_kind: v, ref_id: null, ref_table: null }); commit({ item_kind: v, ref_id: null, ref_table: null }); }}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ITEM_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {(local.item_kind === "material" || local.item_kind === "container" || local.item_kind === "subassembly") ? (
          <div className="flex gap-2">
            <Select value={local.ref_id ?? ""} onValueChange={onPickRef}>
              <SelectTrigger className="h-8 max-w-[200px]"><SelectValue placeholder="Pick…" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {(local.item_kind === "material" ? materials : local.item_kind === "container" ? containers : subAssemblies).map((o: any) => (
                  <SelectItem key={o.id} value={o.id}>
                    {local.item_kind === "container" ? `${o.container_number} (${o.size}')` : o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="h-8 flex-1" value={local.description ?? ""}
              onChange={(e) => set({ description: e.target.value })}
              onBlur={(e) => e.target.value !== item.description && commit({ description: e.target.value })} />
          </div>
        ) : (
          <Input className="h-8" placeholder="Description"
            value={local.description ?? ""}
            onChange={(e) => set({ description: e.target.value })}
            onBlur={(e) => e.target.value !== item.description && commit({ description: e.target.value })} />
        )}
      </TableCell>
      <TableCell>
        <Input className="h-8" value={local.unit ?? ""}
          onChange={(e) => set({ unit: e.target.value })}
          onBlur={(e) => e.target.value !== item.unit && commit({ unit: e.target.value || null })} />
      </TableCell>
      <TableCell>
        <Input type="number" step="0.01" className="h-8 text-right" value={local.quantity ?? 0}
          onChange={(e) => set({ quantity: e.target.value })}
          onBlur={(e) => Number(e.target.value) !== Number(item.quantity) && commit({ quantity: Number(e.target.value) || 0 })} />
      </TableCell>
      <TableCell>
        <Input type="number" step="0.01" className="h-8 text-right" value={local.unit_price ?? 0}
          onChange={(e) => set({ unit_price: e.target.value })}
          onBlur={(e) => Number(e.target.value) !== Number(item.unit_price) && commit({ unit_price: Number(e.target.value) || 0 })} />
      </TableCell>
      <TableCell>
        <Input type="number" step="0.01" className="h-8 text-right" value={local.discount_pct ?? 0}
          onChange={(e) => set({ discount_pct: e.target.value })}
          onBlur={(e) => Number(e.target.value) !== Number(item.discount_pct) && commit({ discount_pct: Number(e.target.value) || 0 })} />
      </TableCell>
      <TableCell>
        <Input type="number" step="0.01" className="h-8 text-right" value={local.tax_pct ?? 0}
          onChange={(e) => set({ tax_pct: e.target.value })}
          onBlur={(e) => Number(e.target.value) !== Number(item.tax_pct) && commit({ tax_pct: Number(e.target.value) || 0 })} />
      </TableCell>
      <TableCell className="text-right font-mono">{fmt(computed)}</TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
