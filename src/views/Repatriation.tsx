import { useState, Fragment, useEffect } from "react";
import { getPrintDepot } from "@/lib/app-settings";
import { useSearchParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ApprovalTimeline } from "@/components/approvals/ApprovalTimeline";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Search, MoreHorizontal, Ship, CheckCircle, Truck, XCircle, DollarSign, ChevronDown, ChevronRight, FileText, Unlink2, AlertTriangle, Link as LinkIcon, History, RefreshCw, Calculator, Receipt, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { generateEirPrint, type EirPrintData } from "@/lib/eir-templates";
import { mapRepatriationError } from "@/lib/repatriation-errors";
import { RepatriationAuditTimeline } from "@/components/repatriation/RepatriationAuditTimeline";
import { RepatriationBillPreviewDialog } from "@/components/repatriation/RepatriationBillPreviewDialog";
import { RepatriationBillingCard } from "@/components/repatriation/RepatriationBillingCard";
import { RepatriationRecordPaymentDialog } from "@/components/repatriation/RepatriationRecordPaymentDialog";
import { RepatriationSettlementBadge } from "@/components/repatriation/RepatriationSettlementBadge";
import { RepatriationExecutionDialog } from "@/components/repatriation/RepatriationExecutionDialog";
import { RepatriationHandlingInvoiceDialog } from "@/components/repatriation/RepatriationHandlingInvoiceDialog";
import { RepatriationTransferInvoiceDialog } from "@/components/repatriation/RepatriationTransferInvoiceDialog";
import { getOrgCurrency } from "@/lib/app-settings";



const statusColors: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-info/15 text-info border-info/30",
  dispatched: "bg-purple-500/15 text-purple-700 border-purple-300",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
};

const COST_TYPES = ["truck_hire", "fuel", "maintenance", "driver_salary", "tolls", "other"];

export default function Repatriation() {
  const cur = getOrgCurrency();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [costDialogId, setCostDialogId] = useState<string | null>(null);
  const [unlinkRow, setUnlinkRow] = useState<any | null>(null);
  const [unlinkReason, setUnlinkReason] = useState("");
  const [unlinkNewRo, setUnlinkNewRo] = useState("");
  const [auditOpenId, setAuditOpenId] = useState<string | null>(null);
  const [mismatchSheetOpen, setMismatchSheetOpen] = useState(false);
  const [previewRepId, setPreviewRepId] = useState<string | null>(null);
  const [payRepId, setPayRepId] = useState<string | null>(null);
  const [payCtx, setPayCtx] = useState<{ outstanding: number; currency: string }>({ outstanding: 0, currency: "USD" });
  const [execRow, setExecRow] = useState<any | null>(null);
  const [handlingDialogOpen, setHandlingDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Realtime: refresh billing badges the instant an invoice or payment changes.
  useEffect(() => {
    const channel = supabase
      .channel("repatriation-billing")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices" },
        (payload: any) => {
          const num = payload?.new?.invoice_number ?? payload?.old?.invoice_number;
          if (typeof num === "string" && num.startsWith("REP-")) {
            queryClient.invalidateQueries({ queryKey: ["repatriation-invoices-batch"] });
            queryClient.invalidateQueries({ queryKey: ["repatriation-invoice-payments-batch"] });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["repatriation-invoice-payments-batch"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // ?highlight=<rep_number> opens the matching row expander (invoice → repatriation deep link).
  // (Defined here as a variable — actual effect is placed after `repatriations` is declared.)


  const { data: repatriations, isLoading } = useQuery({
    queryKey: ["repatriations", search, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("repatriations")
        .select("*, containers(container_number, status, size, category)")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      if (search) q = q.or(`repatriation_number.ilike.%${search}%,release_order_no.ilike.%${search}%,shipping_line.ilike.%${search}%,destination.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const hl = searchParams.get("highlight");
    if (!hl || !repatriations?.length) return;
    const match = repatriations.find((r: any) => r.repatriation_number === hl);
    if (match) {
      setAuditOpenId(match.id);
      const next = new URLSearchParams(searchParams);
      next.delete("highlight");
      setSearchParams(next, { replace: true });
      setTimeout(() => {
        const el = document.getElementById(`rep-row-${match.id}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [searchParams, repatriations, setSearchParams]);


  // Branding follows the header working-depot picker; falls back to org.
  const depot = getPrintDepot();


  // Batch-fetch REP-* invoices so we can show settlement badges per row without N queries.
  const repNumbers = (repatriations ?? []).map((r: any) => `REP-${r.repatriation_number}`);
  const { data: repInvoices } = useQuery({
    queryKey: ["repatriation-invoices-batch", repNumbers.join(",")],
    enabled: repNumbers.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, currency, status, total_amount")
        .in("invoice_number", repNumbers);
      if (error) throw error;
      return data ?? [];
    },
  });
  const invoiceIds = (repInvoices ?? []).map((i: any) => i.id);
  const { data: repPayments } = useQuery({
    queryKey: ["repatriation-invoice-payments-batch", invoiceIds.join(",")],
    enabled: invoiceIds.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("invoice_id, amount")
        .in("invoice_id", invoiceIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const invoiceByRepNum = new Map<string, any>();
  (repInvoices ?? []).forEach((inv: any) => invoiceByRepNum.set(inv.invoice_number, inv));
  const paidByInvoice = new Map<string, number>();
  (repPayments ?? []).forEach((p: any) => paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0)));


  const { data: repatriationCosts = [] } = useQuery({
    queryKey: ["repatriation-costs-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("repatriation_costs").select("*").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: availableContainers } = useQuery({
    queryKey: ["containers-available"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("containers")
        .select("id, container_number, size, category, shipping_line, owner")
        .eq("status", "available")
        .order("container_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: shippingLines } = useQuery({
    queryKey: ["customers-shipping-lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, company_name")
        .eq("customer_type", "shipping_line")
        .eq("is_active", true)
        .order("company_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: trucksDrivers } = useQuery({
    queryKey: ["trucks-drivers-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trucks_drivers")
        .select("id, driver_name, truck_plate, company")
        .eq("is_active", true)
        .order("driver_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const generateNumber = async () => {
    const { count } = await supabase.from("repatriations").select("id", { count: "exact", head: true });
    return `REP-${String((count ?? 0) + 1).padStart(4, "0")}`;
  };

  const createMutation = useMutation({
    mutationFn: async (form: {
      container_id: string;
      release_order_no: string;
      shipping_line: string;
      destination: string;
      transporter: string;
      charge_amount: string;
      notes: string;
      origin?: string;
      handling_amount?: string;
      rate_card_id?: string;
      currency?: string;
      release_instruction_id?: string | null;

    }) => {
      const { data: container } = await supabase
        .from("containers")
        .select("status")
        .eq("id", form.container_id)
        .single();
      if (container?.status !== "available") throw new Error("Container must be in AVAILABLE status for repatriation");

      const repNumber = await generateNumber();
      const { error } = await supabase.from("repatriations").insert({
        repatriation_number: repNumber,
        container_id: form.container_id,
        release_order_no: form.release_order_no,
        shipping_line: form.shipping_line,
        destination: form.destination,
        transporter: form.transporter || null,
        charge_amount: parseFloat(form.charge_amount) || 0,
        origin: form.origin || null,
        handling_amount: form.handling_amount === "" ? null : parseFloat(form.handling_amount),
        rate_card_id: form.rate_card_id || null,
        currency: form.currency || null,
        notes: form.notes || null,
        release_instruction_id: form.release_instruction_id || null,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repatriations"] });
      toast({ title: "Repatriation request created" });
      setDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  const applyRateCard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("apply_repat_rate_card" as any, { _repatriation_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repatriations"] });
      toast({ title: "Rate card applied", description: "Transport rate and handling fee updated." });
    },
    onError: (e: any) =>
      toast({
        title: "No rate card matched",
        description: "Add a rate card for this route and size under Repatriation → Rate Cards.",
        variant: "destructive",
      }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async ({ id, new_ro, reason }: { id: string; new_ro: string; reason: string }) => {
      const { error } = await supabase.rpc("unlink_repatriation_release" as any, {
        _repatriation_id: id,
        _new_release_order_no: new_ro,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repatriations"] });
      toast({ title: "Release instruction unlinked" });
      setUnlinkRow(null);
      setUnlinkReason("");
      setUnlinkNewRo("");
    },
    onError: (e: any) => toast({ title: "Unlink failed", description: mapRepatriationError(e), variant: "destructive" }),
  });

  // ===== Mismatch reconciliation =====
  const { data: mismatches = [] } = useQuery({
    queryKey: ["repatriation-ro-mismatches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repatriation_ro_mismatches" as any)
        .select("*, repatriations(repatriation_number, container_id, containers(container_number))")
        .is("resolved_at", null)
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("reconcile_repatriation_ro_mismatches" as any);
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["repatriation-ro-mismatches"] });
      toast({ title: "Reconciliation complete", description: `${count ?? 0} open mismatches` });
    },
    onError: (e: any) => toast({ title: "Reconciliation failed", description: mapRepatriationError(e), variant: "destructive" }),
  });

  const resolveMismatch = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase
        .from("repatriation_ro_mismatches" as any)
        .update({ resolved_at: new Date().toISOString(), resolved_by: user?.id, resolution_note: note || "Manually resolved" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repatriation-ro-mismatches"] });
      toast({ title: "Mismatch marked resolved" });
    },
    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "dispatch" | "complete" | "cancel" }) => {
      const rep = repatriations?.find(r => r.id === id);
      if (!rep) throw new Error("Record not found");

      if (action === "approve") {
        if (rep.status !== "pending") throw new Error("Can only approve pending requests");
        await supabase.from("repatriations").update({
          status: "approved" as any,
          approved_at: new Date().toISOString(),
          approved_by: user?.id,
        }).eq("id", id);
        if (rep.container_id) {
          await supabase.from("containers").update({ status: "booked_for_repatriation" as any }).eq("id", rep.container_id);
        }
      } else if (action === "dispatch") {
        if (rep.status !== "approved") throw new Error("Can only dispatch approved requests");
        let eirId: string | null = null;
        if (rep.container_id) {
          // Auto-create gate-out EIR
          const { data: repEirNum } = await supabase.rpc("next_eir_number" as any, { prefix: "EIR-REP" });
          const eirNumber = (repEirNum as unknown as string) ?? `EIR-REP-${Date.now().toString(36).toUpperCase()}`;
          const { data: eirData, error: eirErr } = await supabase.from("eir_records").insert({
            eir_number: eirNumber,
            eir_type: "gate_out" as any,
            container_id: rep.container_id,
            condition_grade: "A" as any,
            cargo_status: "empty",
            inspector_notes: `Repatriation ${rep.repatriation_number} to ${rep.destination}`,
            release_purpose: "repatriation",
            completed_at: new Date().toISOString(),
          }).select("id").single();
          if (eirErr) throw eirErr;
          eirId = eirData?.id ?? null;

          await supabase.from("containers").update({
            gate_out_at: new Date().toISOString(),
          }).eq("id", rep.container_id);
          await supabase.from("container_movements").insert({
            container_id: rep.container_id,
            movement_type: "repatriation" as any,
            notes: `Repatriation ${rep.repatriation_number} — dispatched to ${rep.destination}`,
          });
        }
        await supabase.from("repatriations").update({
          status: "dispatched" as any,
          dispatched_at: new Date().toISOString(),
          ...(eirId ? { eir_id: eirId } : {}),
        } as any).eq("id", id);
      } else if (action === "complete") {
        if (rep.status !== "dispatched") throw new Error("Can only complete dispatched requests");
        await supabase.from("repatriations").update({
          status: "completed" as any,
          completed_at: new Date().toISOString(),
        }).eq("id", id);

        // Issue sales invoice to the container owner (gate-in + storage + handling + repat fee)
        let ownerInvoiceId: string | null = null;
        try {
          const { data: invId, error: billErr } = await supabase.rpc(
            "bill_repatriation_to_owner" as any,
            { _repatriation_id: id },
          );
          if (billErr) throw billErr;
          ownerInvoiceId = (invId as unknown as string) ?? null;
        } catch (e: any) {
          // Surface billing failures but don't roll back the status change.
          toast({
            title: "Repatriation completed, but billing failed",
            description: mapRepatriationError(e),
            variant: "destructive",
          });
        }

        // Post cost-side accounting entries (revenue is now driven by the invoice).
        const { error: costErr } = await (supabase as any).rpc("post_repatriation_costs", { _repatriation_id: id });
        if (costErr) throw costErr;
        return { ownerInvoiceId };
      } else if (action === "cancel") {
        if (["completed", "cancelled"].includes(rep.status)) throw new Error("Cannot cancel");
        if (rep.container_id && ["approved"].includes(rep.status)) {
          await supabase.from("containers").update({ status: "available" as any }).eq("id", rep.container_id);
        }
        await supabase.from("repatriations").update({
          status: "cancelled" as any,
        }).eq("id", id);
      }

    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["repatriations"] });
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      queryClient.invalidateQueries({ queryKey: ["containers-available"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: res?.ownerInvoiceId
          ? "Repatriation completed — invoice issued to owner"
          : "Status updated",
      });
    },

    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  const getCostsForRep = (repId: string) => repatriationCosts.filter((c: any) => c.repatriation_id === repId);

  const handlePrintEir = async (rep: any) => {
    const eirId = rep.eir_id;
    if (!eirId) return;
    const { data: eir } = await supabase
      .from("eir_records")
      .select("*, containers(container_number, size, iso_type, category, owner, shipping_line, tare_weight_kg, weight_kg, is_empty, status)")
      .eq("id", eirId)
      .single();
    if (!eir) {
      toast({ title: "EIR not found", variant: "destructive" });
      return;
    }
    const printData: EirPrintData = {
      eir_number: eir.eir_number,
      eir_type: eir.eir_type as any,
      completed_at: eir.completed_at,
      created_at: eir.created_at,
      condition_grade: eir.condition_grade,
      cargo_status: eir.cargo_status,
      seal_number: eir.seal_number,
      damage_description: eir.damage_description,
      inspector_notes: eir.inspector_notes,
      release_purpose: eir.release_purpose,
      released_by_name: eir.released_by_name,
      released_by_role: eir.released_by_role,
      photos: (eir.photos as string[]) ?? [],
      container: eir.containers as any,
      appointment: null,
      depot: depot ? { name: depot.name, code: depot.code, location: depot.location, logo_url: depot.logo_url } : null,
      buyer: {
        label: "Consignee",
        name: rep.destination,
        contact: rep.transporter,
        original_owner: rep.shipping_line,
        address: rep.destination,
      },
    };
    await generateEirPrint(printData);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repatriation</h1>
          <p className="text-muted-foreground">Container return & export requests with trip costing</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setHandlingDialogOpen(true)}><Receipt className="mr-2 h-4 w-4" /> Handling invoice</Button>
          <Button variant="outline" onClick={() => setTransferDialogOpen(true)}><Receipt className="mr-2 h-4 w-4" /> Transfer invoice</Button>
          <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Repatriation</Button>
        </div>
      </div>

      {mismatches.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>RO Mismatches Need Review ({mismatches.length})</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>One or more repatriations have an RO number that doesn't match the linked release instruction.</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => reconcileMutation.mutate()} disabled={reconcileMutation.isPending}>
                <RefreshCw className="mr-1 h-4 w-4" /> Run now
              </Button>
              <Sheet open={mismatchSheetOpen} onOpenChange={setMismatchSheetOpen}>
                <SheetTrigger asChild>
                  <Button size="sm" variant="destructive">Review</Button>
                </SheetTrigger>
                <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
                  <SheetHeader><SheetTitle>RO Mismatches</SheetTitle></SheetHeader>
                  <div className="space-y-3 mt-4">
                    {mismatches.map((m: any) => (
                      <div key={m.id} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-medium text-sm">{m.repatriations?.repatriation_number}</span>
                          <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(m.detected_at), { addSuffix: true })}</span>
                        </div>
                        <div className="text-xs space-y-1">
                          <div>Container: <span className="font-mono">{m.repatriations?.containers?.container_number ?? "—"}</span></div>
                          <div>Expected RO: <span className="font-mono text-success">{m.expected_ro}</span></div>
                          <div>Actual RO: <span className="font-mono text-destructive">{m.actual_ro}</span></div>
                        </div>
                        <Button size="sm" variant="outline" className="w-full"
                          onClick={() => resolveMismatch.mutate({ id: m.id, note: "Reviewed and accepted" })}
                          disabled={resolveMismatch.isPending}>
                          Mark resolved
                        </Button>
                      </div>
                    ))}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by number, release order, shipping line, destination..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["pending", "approved", "dispatched", "completed", "cancelled"].map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]" />
                <TableHead>REP #</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Release Order</TableHead>
                <TableHead>Shipping Line</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Transporter</TableHead>
                <TableHead className="text-right">Charge</TableHead>
                <TableHead className="text-right">Costs</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>

            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={13} />
              ) : !repatriations?.length ? (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No repatriation records found</TableCell></TableRow>
              ) : repatriations.map(r => {

                const costs = getCostsForRep(r.id);
                const totalCost = costs.reduce((s: number, c: any) => s + Number(c.amount), 0);
                const charge = Number((r as any).charge_amount || 0);
                const profit = charge - totalCost;
                // Each repatriation bills in its own currency (USD routes stay USD).
                const rcur = (r as any).currency || cur;

                return (
                  <Fragment key={r.id}>
                    <TableRow id={`rep-row-${r.id}`}>
                      <TableCell className="w-[36px]">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAuditOpenId(auditOpenId === r.id ? null : r.id)}>
                          {auditOpenId === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono font-medium">{r.repatriation_number}</TableCell>
                      <TableCell className="font-mono">{(r.containers as any)?.container_number ?? "—"}</TableCell>
                      <TableCell>
                        {r.release_order_no ? (
                          <>
                            <span className="font-mono">{r.release_order_no}</span>
                            {(r as any).release_instruction_id && <LinkIcon className="inline ml-1 h-3 w-3 text-info" />}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{r.shipping_line || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{r.destination}</TableCell>
                      <TableCell>{r.transporter || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{charge > 0 ? `${rcur} ${charge.toLocaleString()}` : "—"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {totalCost > 0 ? (
                          `${rcur} ${totalCost.toLocaleString()}`
                        ) : ["dispatched", "completed"].includes(r.status) ? (
                          <button
                            type="button"
                            onClick={() => setCostDialogId(r.id)}
                            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning hover:bg-warning/20"
                            title="No costs recorded — click to add"
                          >
                            <AlertTriangle className="h-3 w-3" /> Add costs
                          </button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${profit >= 0 ? "text-success" : "text-destructive"}`}>
                        {charge > 0 || totalCost > 0 ? `${rcur} ${profit.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[r.status] ?? ""}>{r.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const inv = invoiceByRepNum.get(`REP-${r.repatriation_number}`);
                          const paid = inv ? (paidByInvoice.get(inv.id) ?? 0) : 0;
                          return (
                            <div className="space-y-1">
                              <div className="text-[10px] uppercase text-muted-foreground">Transport</div>
                              <RepatriationSettlementBadge invoice={inv} paidTotal={paid} />
                              <div className="text-[10px] uppercase text-muted-foreground">Handling</div>
                              {(r as any).handling_invoice_id ? <Badge variant="outline" className="font-mono text-[10px]">USD 30 billed</Badge> : <Badge variant="outline" className="text-warning text-[10px]">Pending</Badge>}
                              <div className="text-[10px] uppercase text-muted-foreground">Transfer</div>
                              {(r as any).transfer_invoice_id ? <Badge variant="outline" className="font-mono text-[10px]">USD {Number((r as any).transfer_fee_applied ?? 320).toFixed(0)} billed</Badge> : <Badge variant="outline" className="text-warning text-[10px]">Pending</Badge>}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setCostDialogId(r.id)}>
                              <DollarSign className="mr-2 h-4 w-4" /> Manage Costs
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setExecRow(r)}>
                              <Truck className="mr-2 h-4 w-4" /> Execution & costing
                            </DropdownMenuItem>
                            {!["completed", "cancelled"].includes(r.status) && (
                              <DropdownMenuItem onClick={() => applyRateCard.mutate(r.id)}>
                                <Calculator className="mr-2 h-4 w-4" /> Apply rate card
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setAuditOpenId(auditOpenId === r.id ? null : r.id)}>
                              <History className="mr-2 h-4 w-4" /> {auditOpenId === r.id ? "Hide" : "Show"} Audit History
                            </DropdownMenuItem>
                            {(r as any).release_instruction_id && !["completed","cancelled"].includes(r.status) && (
                              <DropdownMenuItem onClick={() => { setUnlinkRow(r); setUnlinkNewRo(r.release_order_no || ""); setUnlinkReason(""); }}>
                                <Unlink2 className="mr-2 h-4 w-4" /> Unlink Release Instruction
                              </DropdownMenuItem>
                            )}
                            {(r as any).eir_id && (
                              <DropdownMenuItem onClick={() => handlePrintEir(r)}>
                                <FileText className="mr-2 h-4 w-4" /> Print EIR
                              </DropdownMenuItem>
                            )}
                            {r.status === "pending" && (
                              <DropdownMenuItem onClick={() => transitionMutation.mutate({ id: r.id, action: "approve" })}>
                                <CheckCircle className="mr-2 h-4 w-4" /> Approve
                              </DropdownMenuItem>
                            )}
                            {r.status === "approved" && (
                              <DropdownMenuItem onClick={() => transitionMutation.mutate({ id: r.id, action: "dispatch" })}>
                                <Truck className="mr-2 h-4 w-4" /> Dispatch (Gate Out)
                              </DropdownMenuItem>
                            )}
                            {r.status === "dispatched" && (
                              <>
                                <DropdownMenuItem onClick={() => setPreviewRepId(r.id)}>
                                  <Calculator className="mr-2 h-4 w-4" /> Preview bill
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => transitionMutation.mutate({ id: r.id, action: "complete" })}>
                                  <Ship className="mr-2 h-4 w-4" /> Mark Completed
                                </DropdownMenuItem>
                              </>
                            )}
                            {r.status === "completed" && (() => {
                              const inv = invoiceByRepNum.get(`REP-${r.repatriation_number}`);
                              const paid = inv ? (paidByInvoice.get(inv.id) ?? 0) : 0;
                              const outstanding = inv ? Math.max(0, Number(inv.total_amount) - paid) : 0;
                              return inv && outstanding > 0 ? (
                                <DropdownMenuItem onClick={() => { setPayCtx({ outstanding, currency: inv.currency }); setPayRepId(r.id); }}>
                                  <CreditCard className="mr-2 h-4 w-4" /> Mark as paid
                                </DropdownMenuItem>
                              ) : null;
                            })()}
                            {!["completed", "cancelled"].includes(r.status) && (
                              <DropdownMenuItem onClick={() => transitionMutation.mutate({ id: r.id, action: "cancel" })} className="text-destructive">
                                <XCircle className="mr-2 h-4 w-4" /> Cancel
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {auditOpenId === r.id && (
                      <TableRow>
                        <TableCell colSpan={13} className="bg-muted/30 p-4 space-y-4">
                          {r.status === "completed" && (
                            <RepatriationBillingCard
                              repatriationId={r.id}
                              repatriationNumber={r.repatriation_number}
                              organizationId={(r as any).organization_id}
                              onRecordPayment={(ctx) => { setPayCtx(ctx); setPayRepId(r.id); }}
                            />
                          )}
                          <RepatriationAuditTimeline repatriationId={r.id} />
                        </TableCell>
                      </TableRow>
                    )}

                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateRepatriationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        availableContainers={availableContainers ?? []}
        shippingLines={shippingLines ?? []}
        trucksDrivers={trucksDrivers ?? []}
        onSubmit={(form) => createMutation.mutate(form)}
        isPending={createMutation.isPending}
      />

      <RepatriationExecutionDialog
        repatriation={execRow}
        onOpenChange={(open) => { if (!open) setExecRow(null); }}
      />

      <RepatriationHandlingInvoiceDialog open={handlingDialogOpen} onOpenChange={setHandlingDialogOpen} />
      <RepatriationTransferInvoiceDialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen} />

      <RepatriationBillPreviewDialog
        repatriationId={previewRepId}
        repatriationNumber={previewRepId ? repatriations?.find((r: any) => r.id === previewRepId)?.repatriation_number : undefined}
        onOpenChange={(open) => { if (!open) setPreviewRepId(null); }}
        canComplete={previewRepId ? repatriations?.find((r: any) => r.id === previewRepId)?.status === "dispatched" : false}
        isCompleting={transitionMutation.isPending}
        onCompleteAndBill={() => {
          if (!previewRepId) return;
          transitionMutation.mutate(
            { id: previewRepId, action: "complete" },
            { onSuccess: () => setPreviewRepId(null) },
          );
        }}
      />

      <RepatriationRecordPaymentDialog
        repatriationId={payRepId}
        repatriationNumber={payRepId ? repatriations?.find((r: any) => r.id === payRepId)?.repatriation_number : undefined}
        outstanding={payCtx.outstanding}
        currency={payCtx.currency}
        onOpenChange={(open) => { if (!open) setPayRepId(null); }}
      />



      {/* Unlink Release Instruction Dialog */}
      <Dialog open={!!unlinkRow} onOpenChange={(v) => { if (!v) { setUnlinkRow(null); setUnlinkReason(""); setUnlinkNewRo(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Unlink Release Instruction</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Removes the link to release instruction <span className="font-mono">{unlinkRow?.release_order_no}</span> and lets you set a new RO number. This action is recorded in the audit log.
            </p>
            <div>
              <Label>New Release Order No. *</Label>
              <Input value={unlinkNewRo} onChange={e => setUnlinkNewRo(e.target.value)} placeholder="e.g. RO-MANUAL-001" />
            </div>
            <div>
              <Label>Reason for override *</Label>
              <Textarea value={unlinkReason} onChange={e => setUnlinkReason(e.target.value)} rows={3} placeholder="Why is the RO number being overridden?" />
              <p className="text-xs text-muted-foreground mt-1">Minimum 3 characters.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkRow(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={unlinkMutation.isPending || !unlinkNewRo.trim() || unlinkReason.trim().length < 3}
              onClick={() => unlinkRow && unlinkMutation.mutate({ id: unlinkRow.id, new_ro: unlinkNewRo.trim(), reason: unlinkReason.trim() })}
            >
              {unlinkMutation.isPending ? "Unlinking..." : "Unlink & Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cost Management Dialog */}
      {costDialogId && (
        <RepatriationCostDialog
          repId={costDialogId}
          rep={repatriations?.find(r => r.id === costDialogId)}
          costs={getCostsForRep(costDialogId)}
          open={!!costDialogId}
          onOpenChange={(v) => { if (!v) setCostDialogId(null); }}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["repatriation-costs-all"] })}
        />
      )}
    </div>
  );
}

/* ── Repatriation Cost Dialog ── */
function RepatriationCostDialog({ repId, rep, costs, open, onOpenChange, onSuccess }: {
  repId: string;
  rep: any;
  costs: any[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const cur = getOrgCurrency();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ cost_type: "fuel", description: "", amount: "" });
  const [chargeAmount, setChargeAmount] = useState(String(Number(rep?.charge_amount || 0)));

  const totalCost = costs.reduce((s, c: any) => s + Number(c.amount), 0);
  const charge = parseFloat(chargeAmount) || 0;
  const profit = charge - totalCost;

  const addCost = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("repatriation_costs").insert({
        repatriation_id: repId,
        cost_type: f.cost_type,
        description: f.description || null,
        amount: parseFloat(f.amount) || 0,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      onSuccess();
      toast({ title: "Cost added" });
      setF({ cost_type: "fuel", description: "", amount: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  const updateCharge = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("repatriations").update({
        charge_amount: parseFloat(chargeAmount) || 0,
      } as any).eq("id", repId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repatriations"] });
      toast({ title: "Charge updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: mapRepatriationError(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trip Costs — {rep?.repatriation_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Charge to customer */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label>Charge to Customer ({cur})</Label>
              <Input type="number" value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => updateCharge.mutate()} disabled={updateCharge.isPending}>Save</Button>
          </div>

          <Separator />

          {/* Add cost */}
          <form onSubmit={(e) => { e.preventDefault(); addCost.mutate(); }} className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={f.cost_type} onValueChange={v => setF(p => ({ ...p, cost_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COST_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Amount</Label><Input type="number" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} required /></div>
            <div className="flex items-end"><Button type="submit" size="sm" disabled={addCost.isPending}><Plus className="mr-1 h-3 w-3" />Add</Button></div>
          </form>

          {/* Cost list */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!costs.length ? (
                <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No costs recorded</TableCell></TableRow>
              ) : costs.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{c.cost_type.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-sm">{c.description ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{cur} {Number(c.amount).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm"><span>Charge to Customer</span><span className="font-mono">{cur} {charge.toLocaleString()}</span></div>
            <div className="flex justify-between text-sm"><span>Total Costs</span><span className="font-mono">{cur} {totalCost.toLocaleString()}</span></div>
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Profit</span>
              <span className={`font-mono ${profit >= 0 ? "text-success" : "text-destructive"}`}>{cur} {profit.toLocaleString()}</span>
            </div>
          </div>
          {rep?.id && <ApprovalTimeline docType="repatriation" docId={rep.id} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateRepatriationDialog({
  open, onOpenChange, availableContainers, shippingLines, trucksDrivers, onSubmit, isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  availableContainers: { id: string; container_number: string; size: string; category: string; shipping_line: string | null }[];
  shippingLines: { id: string; company_name: string }[];
  trucksDrivers: { id: string; driver_name: string; truck_plate: string; company: string | null }[];
  onSubmit: (form: any) => void;
  isPending: boolean;
}) {
  const cur = getOrgCurrency();
  const [form, setForm] = useState({
    container_id: "",
    release_order_no: "",
    shipping_line: "",
    destination: "",
    origin: "",
    transporter: "",
    charge_amount: "",
    handling_amount: "",
    rate_card_id: "",
    currency: "",
    notes: "",
    release_instruction_id: "",
  });

  const selectedSize = availableContainers.find(c => c.id === form.container_id)?.size ?? "";

  // Auto-price from the route rate card whenever route / size / line changes.
  useEffect(() => {
    if (!open || !form.destination.trim() || !selectedSize) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("lookup_repat_rate" as any, {
        _origin: form.origin || null,
        _destination: form.destination,
        _size: String(selectedSize),
        _shipping_line: form.shipping_line || null,
      });
      if (cancelled || error) return;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      setForm(f => ({
        ...f,
        rate_card_id: row.rate_card_id,
        charge_amount: String(row.rate_amount ?? ""),
        handling_amount: String(row.handling_fee ?? ""),
        currency: row.currency || f.currency,
      }));
    })();
    return () => { cancelled = true; };
  }, [open, form.destination, form.origin, form.shipping_line, selectedSize]);

  const { data: approvedInstructions = [] } = useQuery({
    queryKey: ["approved-release-instructions", form.container_id],
    enabled: open && !!form.container_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("release_instructions")
        .select("id, instruction_number, release_type, consignee_name, valid_until, truck_plate, driver_name, container_id")
        .eq("status", "approved")
        .eq("container_id", form.container_id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleSubmit = () => {
    if (!form.container_id || !form.release_order_no || !form.shipping_line || !form.destination) return;
    onSubmit(form);
    setForm({ container_id: "", release_order_no: "", shipping_line: "", destination: "", origin: "", transporter: "", charge_amount: "", handling_amount: "", rate_card_id: "", currency: "", notes: "", release_instruction_id: "" });
  };

  const handleContainerChange = (cid: string) => {
    const c = availableContainers.find(x => x.id === cid);
    setForm(prev => ({
      ...prev,
      container_id: cid,
      shipping_line: c?.shipping_line || prev.shipping_line,
      release_instruction_id: "",
    }));
  };

  const handleInstructionChange = (id: string) => {
    const ri = approvedInstructions.find((x: any) => x.id === id);
    if (!ri) return;
    setForm(prev => ({
      ...prev,
      release_instruction_id: id,
      release_order_no: ri.instruction_number,
      destination: prev.destination || ri.consignee_name || "",
      transporter: prev.transporter || (ri.driver_name || ri.truck_plate
        ? [ri.driver_name, ri.truck_plate].filter(Boolean).join(" — ")
        : ""),
    }));
  };

  const clearInstruction = () => setForm(prev => ({ ...prev, release_instruction_id: "", release_order_no: "" }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Repatriation Request</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label>Container *</Label>
            <Select value={form.container_id} onValueChange={handleContainerChange}>
              <SelectTrigger><SelectValue placeholder="Select available container" /></SelectTrigger>
              <SelectContent>
                {availableContainers.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.container_number} ({c.size}' {c.category})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Approved Release Instruction</Label>
            {!form.container_id ? (
              <p className="text-xs text-muted-foreground mt-1">Select a container first.</p>
            ) : approvedInstructions.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">No approved release instructions for this container — enter RO manually below.</p>
            ) : (
              <Select value={form.release_instruction_id} onValueChange={handleInstructionChange}>
                <SelectTrigger><SelectValue placeholder="Select approved release instruction" /></SelectTrigger>
                <SelectContent>
                  {approvedInstructions.map((ri: any) => (
                    <SelectItem key={ri.id} value={ri.id}>
                      {ri.instruction_number} — {ri.release_type}
                      {ri.consignee_name ? ` — ${ri.consignee_name}` : ""}
                      {ri.valid_until ? ` (until ${format(new Date(ri.valid_until), "dd MMM")})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {form.release_instruction_id && (
              <button type="button" onClick={clearInstruction} className="text-xs text-primary hover:underline mt-1">
                Clear selection (enter RO manually)
              </button>
            )}
          </div>
          <div>
            <Label>Release Order No. *</Label>
            <Input
              value={form.release_order_no}
              onChange={e => setForm(f => ({ ...f, release_order_no: e.target.value }))}
              placeholder="e.g. RO-2024-001"
              readOnly={!!form.release_instruction_id}
            />
          </div>
          <div>
            <Label>Shipping Line *</Label>
            <Select value={form.shipping_line} onValueChange={v => setForm(f => ({ ...f, shipping_line: v }))}>
              <SelectTrigger><SelectValue placeholder="Select shipping line" /></SelectTrigger>
              <SelectContent>
                {shippingLines.map(s => (
                  <SelectItem key={s.id} value={s.company_name}>{s.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Origin</Label>
              <Input value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} placeholder="e.g. Nairobi" />
            </div>
            <div>
              <Label>Destination (Port / Depot) *</Label>
              <Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Multiple Depot Kampala" />
            </div>
          </div>
          <div>
            <Label>Transporter</Label>
            <Select value={form.transporter} onValueChange={v => setForm(f => ({ ...f, transporter: v }))}>
              <SelectTrigger><SelectValue placeholder="Select transporter (optional)" /></SelectTrigger>
              <SelectContent>
                {trucksDrivers.map(t => (
                  <SelectItem key={t.id} value={`${t.driver_name} — ${t.truck_plate}`}>
                    {t.driver_name} — {t.truck_plate} {t.company ? `(${t.company})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Currency</Label>
              <Select value={form.currency || cur} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["USD", "KES", "EUR", "UGX", "TZS"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Repat charge ({form.currency || cur})</Label>
              <Input type="number" value={form.charge_amount} onChange={e => setForm(f => ({ ...f, charge_amount: e.target.value, rate_card_id: "" }))} placeholder="0" />
            </div>
            <div>
              <Label>Handling fee</Label>
              <Input value="USD 30 (separate invoice)" readOnly />
            </div>
          </div>
          {form.rate_card_id && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Priced from the matching route rate card — this repatriation bills in {form.currency || cur}.
            </p>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !form.container_id || !form.release_order_no || !form.shipping_line || !form.destination}>
            {isPending ? "Creating..." : "Create Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
