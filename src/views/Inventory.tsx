import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Download, MoreHorizontal, Pencil, ArrowRightFromLine, Move, ClipboardCheck, Eye, FileSpreadsheet, FileText, RotateCcw, FileCheck2, ReceiptText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useNavigate } from "@/lib/router";
import { formatDistanceToNow } from "date-fns";
import { useRowSelection } from "@/hooks/use-row-selection";
import { HeaderCheckbox, RowCheckbox } from "@/components/bulk/SelectionCheckbox";
import { RegistryActions, BulkActions } from "@/components/bulk/RegistryActions";
import { REGISTRIES } from "@/config/bulk-registries";
import { formatCategory, HEIGHT_CLASSES, HEIGHT_CLASS_LABELS } from "@/lib/container-constants";
import { fetchAllContainersForExport, exportInventoryXlsx, exportInventoryPdf } from "@/lib/inventory-export";
import { useUserStaffRole } from "@/hooks/use-user-staff-role";
import { ReasonDialog } from "@/components/inventory/ReasonDialog";
import { z } from "zod";
import { acquireContainerFromOwner } from "@/lib/container-acquisition";
import BulkEditAcquisitionDialog from "@/components/containers/BulkEditAcquisitionDialog";
import { recordContainerServiceInvoice } from "@/lib/container-service-costs";
import SupplierCombobox from "@/components/suppliers/SupplierCombobox";
import { getPrintDepot, getOrgCurrency, getAcquisitionDefaults } from "@/lib/app-settings";
import AcquisitionCostPanel from "@/components/containers/AcquisitionCostPanel";
import { backfillContainerRecords, fetchContainerRecordStatus, type ContainerRecordStatus } from "@/lib/container-backfill";

const CONTAINER_NUMBER_RE = /^[A-Z]{4}[0-9]{7}$/;
const PHONE_RE = /^[+0-9()\-\s]{7,20}$/;
const PLATE_RE = /^[A-Z0-9\-\s]{4,15}$/;

const addContainerSchema = z.object({
  container_number: z.string().trim().regex(CONTAINER_NUMBER_RE, "Must be 4 letters + 7 digits (e.g. MSCU1234567)"),
  size: z.enum(["20", "40", "45"]),
  category: z.enum(["dry", "reefer", "tank", "flat_rack", "open_top"]),
  height_class: z.string().max(4).optional().nullable(),
  ownership_type: z.enum(["depot_owned", "shipper_owned"]),
  owner: z.string().trim().max(120).optional().or(z.literal("")),
  shipping_line: z.string().trim().max(120).optional().or(z.literal("")),
  seller_name: z.string().trim().max(160).optional().or(z.literal("")),
  purchase_price: z.union([z.string(), z.number()]).optional().nullable(),
  purchase_currency: z.string().trim().max(8).optional().or(z.literal("")),
  transporter: z.string().trim().min(2, "Transporter is required").max(120),
  truck_registration: z.string().trim().regex(PLATE_RE, "Enter a valid plate (letters, digits, dashes)"),
  driver_name: z.string().trim().min(2, "Driver name is required").max(100),
  driver_phone: z.string().trim().regex(PHONE_RE, "Enter a valid phone number"),
  driver_id_number: z.string().trim().min(3, "Driver ID/license is required").max(60),
  pickup_location: z.string().trim().min(2, "Pickup location is required").max(160),
  pickup_depot_id: z.string().uuid().optional().nullable(),
  transport_cost: z.union([z.string(), z.number()]).optional().nullable(),
  transport_vendor: z.string().trim().max(160).optional().or(z.literal("")),
  offloading_cost: z.union([z.string(), z.number()]).optional().nullable(),
  offloading_vendor: z.string().trim().max(160).optional().or(z.literal("")),
  acquisition_currency: z.string().trim().max(8).optional().or(z.literal("")),
  override_reason: z.string().trim().max(300).optional().or(z.literal("")),
}).superRefine((val, ctx) => {
  if (val.category === "dry" && !val.height_class) {
    ctx.addIssue({ code: "custom", path: ["height_class"], message: "Height class required for dry containers" });
  }
  if (val.ownership_type === "shipper_owned") {
    if (!val.owner || val.owner.trim().length < 2) {
      ctx.addIssue({ code: "custom", path: ["owner"], message: "Owner is required for shipper-owned containers" });
    }
  }
  if (val.ownership_type === "depot_owned") {
    if (!val.seller_name || val.seller_name.trim().length < 2) {
      ctx.addIssue({ code: "custom", path: ["seller_name"], message: "Seller is required when depot purchases the container" });
    }
    const price = Number(val.purchase_price ?? 0);
    if (!(price > 0)) {
      ctx.addIssue({ code: "custom", path: ["purchase_price"], message: "Purchase price must be greater than 0" });
    }
    if (!val.purchase_currency || val.purchase_currency.trim().length < 3) {
      ctx.addIssue({ code: "custom", path: ["purchase_currency"], message: "Currency is required" });
    }
  }
  if (Number(val.transport_cost ?? 0) > 0 && !(val.transport_vendor && val.transport_vendor.trim().length >= 2)) {
    ctx.addIssue({ code: "custom", path: ["transport_vendor"], message: "Transport vendor is required when a transport cost is entered" });
  }
  if (Number(val.offloading_cost ?? 0) > 0 && !(val.offloading_vendor && val.offloading_vendor.trim().length >= 2)) {
    ctx.addIssue({ code: "custom", path: ["offloading_vendor"], message: "Crane / offloading vendor is required when a cost is entered" });
  }
});




const statusColors: Record<string, string> = {
  available: "bg-success/15 text-success border-success/30",
  allocated: "bg-info/15 text-info border-info/30",
  damaged: "bg-destructive/15 text-destructive border-destructive/30",
  repair_pending: "bg-warning/15 text-warning border-warning/30",
  in_repair: "bg-purple-500/15 text-purple-700 border-purple-300",
  hold: "bg-gray-500/15 text-gray-700 border-gray-300",
  in_conversion: "bg-warning/15 text-warning border-warning/30",
  sold: "bg-teal-500/15 text-teal-700 border-teal-300",
  booked_for_repatriation: "bg-indigo-500/15 text-indigo-700 border-indigo-300",
  converted: "bg-muted text-muted-foreground border-border line-through",
  on_lease: "bg-teal-500/15 text-teal-700 border-teal-300",
};

const RETIRED_STATUSES = ["converted", "sold", "on_lease"];
const REVERSIBLE_TERMINAL = ["converted", "sold", "on_lease", "booked_for_repatriation"];
const allStatuses = ["available", "allocated", "damaged", "repair_pending", "in_repair", "hold", "in_conversion", "sold", "booked_for_repatriation", "converted", "on_lease"];


function useCustomers() {
  return useQuery({
    queryKey: ["customers-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, company_name, customer_type")
        .eq("is_active", true)
        .order("company_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useYardBlocks() {
  return useQuery({
    queryKey: ["yard-blocks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("yard_blocks").select("id, name, block_type, max_bays, max_rows, max_tiers").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Inventory() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [shippingLineFilter, setShippingLineFilter] = useState<string>("all");
  const [heightFilter, setHeightFilter] = useState<string>("all");
  const [includeRetired, setIncludeRetired] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [acqReview, setAcqReview] = useState<{ containerId: string; containerNumber: string } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [backfillTarget, setBackfillTarget] = useState<any>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [reasonState, setReasonState] = useState<
    | null
    | { kind: "status_change"; id: string; container: string; status: string }
    | { kind: "reverse"; id: string; container: string; from: string }
    | { kind: "gate_out"; id: string; container: string }
  >(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isOwnerOrAdmin } = useUserStaffRole();
  const { data: customers } = useCustomers();
  const { data: yardBlocks } = useYardBlocks();

  const owners = customers?.filter((c) => c.customer_type === "owner") ?? [];
  const shippingLines = customers?.filter((c) => c.customer_type === "shipping_line") ?? [];


  const { data: containers, isLoading } = useQuery({
    queryKey: ["containers", search, statusFilter, ownerFilter, shippingLineFilter, heightFilter, includeRetired],
    queryFn: async () => {
      let q = supabase.from("containers").select("*, yard_blocks(name), depots!containers_depot_id_fkey(name), pickup_depot:depots!containers_pickup_depot_id_fkey(name)").order("created_at", { ascending: false });
      if (search) q = q.ilike("container_number", `%${search}%`);
      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter as any);
      } else if (!includeRetired) {
        q = q.not("status", "in", `(${RETIRED_STATUSES.join(",")})`);
      }
      if (ownerFilter !== "all") q = q.eq("owner", ownerFilter);
      if (shippingLineFilter !== "all") q = q.eq("shipping_line", shippingLineFilter);
      if (heightFilter !== "all") q = q.eq("height_class", heightFilter as any);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  // Records-presence lookup for badges: which containers have appt / EIR / PINV
  const { data: recordStatus } = useQuery({
    queryKey: ["container-record-status", (containers ?? []).map((c: any) => c.id).join(",")],
    enabled: !!containers?.length,
    queryFn: async () =>
      fetchContainerRecordStatus(
        (containers as any[]).map((c) => ({ id: c.id, container_number: c.container_number })),
      ),
  });

  const backfillOne = useMutation({
    mutationFn: async (input: Parameters<typeof backfillContainerRecords>[0]) =>
      backfillContainerRecords(input),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      queryClient.invalidateQueries({ queryKey: ["container-record-status"] });
      const parts: string[] = [];
      if (res.appointment === "created") parts.push("appointment");
      if (res.eir === "created") parts.push("EIR");
      if (res.invoice === "created") parts.push("supplier invoice");
      const desc = parts.length ? `Created: ${parts.join(", ")}.` : "Nothing to backfill — all records already exist.";
      if (res.errors.length) {
        toast({ title: `Backfill completed with issues`, description: `${desc} ${res.errors.join(" ")}`, variant: "destructive" });
      } else {
        toast({ title: `Records backfilled for ${res.container_number}`, description: desc });
      }
      setBackfillTarget(null);
    },
    onError: (e: any) => toast({ title: "Backfill failed", description: e.message, variant: "destructive" }),
  });

  const bulkBackfill = useMutation({
    mutationFn: async (rows: any[]) => {
      const results: Awaited<ReturnType<typeof backfillContainerRecords>>[] = [];
      for (const c of rows) {
        results.push(
          await backfillContainerRecords({
            container: {
              id: c.id,
              container_number: c.container_number,
              owner: c.owner,
              shipping_line: c.shipping_line,
              ownership_type: c.ownership_type,
              transporter: c.transporter,
              truck_registration: c.truck_registration,
              driver_name: c.driver_name,
              driver_phone: c.driver_phone,
              driver_id_number: c.driver_id_number,
              pickup_location: c.pickup_location,
              pickup_depot_id: c.pickup_depot_id,
            },
          }),
        );
      }
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      queryClient.invalidateQueries({ queryKey: ["container-record-status"] });
      const appts = results.filter((r) => r.appointment === "created").length;
      const eirs = results.filter((r) => r.eir === "created").length;
      const invs = results.filter((r) => r.invoice === "created").length;
      const invSkipped = results.filter((r) => r.invoice === "skipped" && r.errors.some((e) => e.startsWith("Invoice:"))).length;
      toast({
        title: `Backfilled ${results.length} containers`,
        description: `Appointments: ${appts} • EIRs: ${eirs} • Invoices: ${invs}${invSkipped ? ` • ${invSkipped} depot-owned rows need seller/price — edit them individually.` : ""}`,
      });
      selection.clear();
    },
    onError: (e: any) => toast({ title: "Bulk backfill failed", description: e.message, variant: "destructive" }),
  });



  const createMutation = useMutation({
    mutationFn: async (form: any) => {
      const payload = { ...form };
      // Strip seller/purchase fields — they live on invoice, not container
      const sellerName: string | null = payload.seller_name ?? null;
      const purchasePrice: number = Number(payload.purchase_price ?? 0);
      const purchaseCurrency: string = payload.purchase_currency || getOrgCurrency() || "USD";
      delete payload.seller_name; delete payload.purchase_price; delete payload.purchase_currency;

      const overrideReason: string = (payload.override_reason ?? "").toString();
      delete payload.override_reason;

      // Normalise acquisition service cost fields (they persist on the container row)
      payload.transport_cost = Number(payload.transport_cost ?? 0) || 0;
      payload.offloading_cost = Number(payload.offloading_cost ?? 0) || 0;
      payload.transport_vendor = payload.transport_vendor?.trim() || null;
      payload.offloading_vendor = payload.offloading_vendor?.trim() || null;
      payload.acquisition_currency = (payload.acquisition_currency || purchaseCurrency || "USD").toUpperCase();

      if (!payload.depot_id) {
        const wdId = (await import("@/lib/app-settings")).getWorkingDepotId();
        if (wdId) payload.depot_id = wdId;
      }
      const { data: inserted, error } = await supabase.from("containers").insert(payload).select("id, container_number, owner").single();
      if (error) throw error;
      const containerId = inserted?.id as string;
      const containerNumber = inserted?.container_number as string;

      const transportParts = [
        payload.transporter && `Transporter: ${payload.transporter}`,
        payload.truck_registration && `Truck: ${payload.truck_registration}`,
        payload.driver_name && `Driver: ${payload.driver_name}`,
        payload.driver_id_number && `Driver ID: ${payload.driver_id_number}`,
        payload.driver_phone && `Phone: ${payload.driver_phone}`,
        payload.pickup_location && `Picked up from: ${payload.pickup_location}`,
        `Ownership: ${payload.ownership_type === "depot_owned" ? "Depot-owned" : "Shipper-owned"}`,
        sellerName && `Seller: ${sellerName}`,
      ].filter(Boolean).join(" | ");

      // 1) Gate appointment (auto-completed since container is already at gate)
      const apptNumber = `APT-INV-${Date.now().toString(36).toUpperCase()}`;
      const { data: appt } = await supabase.from("gate_appointments").insert({
        appointment_number: apptNumber,
        appointment_type: "gate_in",
        scheduled_at: new Date().toISOString(),
        container_number: containerNumber,
        container_id: containerId,
        truck_plate: payload.truck_registration ?? null,
        driver_name: payload.driver_name ?? null,
        shipping_line: payload.shipping_line ?? payload.owner ?? null,
        status: "completed" as any,
        notes: `Auto-created on container add. ${transportParts}`,
      } as any).select("id").single();

      // 2) EIR gate-in record
      const { data: eirNumData } = await supabase.rpc("next_eir_number" as any, { prefix: "EIR" });
      const eirNumber = (eirNumData as unknown as string) ?? `EIR-${Date.now()}`;
      await supabase.from("eir_records").insert({
        eir_number: eirNumber,
        appointment_id: appt?.id ?? null,
        container_id: containerId,
        eir_type: "gate_in",
        condition_grade: "A",
        cargo_status: "empty",
        transporter_company: payload.transporter ?? null,
        truck_plate: payload.truck_registration ?? null,
        driver_name: payload.driver_name ?? null,
        driver_phone: payload.driver_phone ?? null,
        driver_id_number: payload.driver_id_number ?? null,
        origin_location: payload.pickup_location ?? null,
        pickup_depot_id: payload.pickup_depot_id ?? null,
        release_purpose: payload.ownership_type === "depot_owned" ? "depot_purchase" : "storage",
        inspector_notes: transportParts,
        completed_at: new Date().toISOString(),
      } as any);

      // 3) Movement audit trail (existing behavior)
      await supabase.from("container_movements").insert({
        container_id: containerId,
        movement_type: "gate_in" as any,
        notes: `Container added to inventory. ${transportParts}`,
      });

      // 4) If depot purchased, generate supplier invoice payable to seller
      if (payload.ownership_type === "depot_owned" && sellerName && purchasePrice > 0) {
        await acquireContainerFromOwner({
          containerId,
          amount: purchasePrice,
          currency: purchaseCurrency,
          reason: "purchase" as any,
          reference: containerNumber,
          expectedOwner: sellerName,
        });
      }

      // 5) Acquisition service invoices — transporter and crane / offloading.
      // Raised for every container received, regardless of ownership.
      const acqCurrency: string = payload.acquisition_currency || purchaseCurrency;
      await recordContainerServiceInvoice({
        containerId,
        vendorName: payload.transport_vendor || payload.transporter,
        amount: Number(payload.transport_cost ?? 0),
        currency: acqCurrency,
        serviceKind: "transport",
        reference: containerNumber,
      });
      await recordContainerServiceInvoice({
        containerId,
        vendorName: payload.offloading_vendor,
        amount: Number(payload.offloading_cost ?? 0),
        currency: acqCurrency,
        serviceKind: "crane_offloading",
        reference: containerNumber,
      });

      // 6) Audit any deviation from the org-wide acquisition defaults
      const defaults = getAcquisitionDefaults();
      const changes: Record<string, { from: any; to: any }> = {};
      const cmp = (key: string, from: any, to: any) => {
        const norm = (v: any) => (v === null || v === undefined || v === "" ? null : typeof v === "number" ? v : String(v).trim());
        if (norm(from) !== norm(to)) changes[key] = { from: norm(from), to: norm(to) };
      };
      cmp("transport_vendor", defaults.transportVendor, payload.transport_vendor);
      cmp("transport_cost", defaults.transportCost, payload.transport_cost || null);
      cmp("offloading_vendor", defaults.offloadingVendor, payload.offloading_vendor);
      cmp("offloading_cost", defaults.offloadingCost, payload.offloading_cost || null);
      if (Object.keys(changes).length > 0) {
        await supabase.rpc("log_container_acquisition_override" as any, {
          _container_id: containerId,
          _changes: changes as any,
          _reason: overrideReason || null,
        });
      }

      return { containerId, containerNumber };
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      toast({ title: "Container added", description: "Gate-in appointment, EIR and audit trail recorded." });
      setDialogOpen(false);
      if (created?.containerId) setAcqReview(created);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });



  const updateMutation = useMutation({
    mutationFn: async ({ id, reason, ...updates }: any) => {
      const { error } = await supabase.rpc("admin_update_container", {
        _id: id,
        _patch: updates,
        _reason: reason || "Inventory edit",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      toast({ title: "Container updated" });
      setEditDialogOpen(false);
      setMoveDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const gateOutMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error: rpcErr } = await supabase.rpc("admin_update_container", {
        _id: id,
        _patch: { status: "allocated" } as any,
        _reason: `Gate out: ${reason}`,
      });
      if (rpcErr) throw rpcErr;
      await supabase.from("containers").update({ gate_out_at: new Date().toISOString() }).eq("id", id);
      await supabase.from("container_movements").insert({
        container_id: id,
        movement_type: "gate_out" as any,
        notes: `Gate out via inventory action: ${reason}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      toast({ title: "Container gated out" });
      setReasonState(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changeStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_update_container", {
        _id: id,
        _patch: { status } as any,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      toast({ title: "Status updated" });
      setReasonState(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reverseStatus = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("reverse_container_terminal_status", { _id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      toast({ title: "Container returned to available" });
      setReasonState(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });


  const [exporting, setExporting] = useState(false);
  const handleExport = async (kind: "xlsx" | "pdf") => {
    try {
      setExporting(true);
      toast({ title: "Preparing export…", description: "Fetching all containers" });
      const all = await fetchAllContainersForExport();
      if (!all.length) {
        toast({ title: "No containers to export", variant: "destructive" });
        return;
      }
      if (kind === "xlsx") exportInventoryXlsx(all);
      else exportInventoryPdf(all);
      toast({ title: `Exported ${all.length} containers` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const openEdit = (c: any) => {
    setEditTarget({
      id: c.id,
      category: c.category,
      height_class: c.height_class ?? "",
      status: c.status,
      owner: c.owner ?? "",
      shipping_line: c.shipping_line ?? "",
      is_empty: c.is_empty,
      notes: c.notes ?? "",
      iso_type: c.iso_type ?? "",
      weight_kg: c.weight_kg?.toString() ?? "",
      tare_weight_kg: c.tare_weight_kg?.toString() ?? "",
    });
    setEditDialogOpen(true);
  };

  const openMove = (c: any) => {
    setEditTarget({
      id: c.id,
      block_id: c.block_id ?? "",
      bay: c.bay?.toString() ?? "",
      row: c.row?.toString() ?? "",
      tier: c.tier?.toString() ?? "",
    });
    setMoveDialogOpen(true);
  };

  const selection = useRowSelection<any>(containers as any);
  const [bulkAcqOpen, setBulkAcqOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.inventory")}</h1>
          <p className="text-muted-foreground">{containers?.length ?? 0} containers</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exporting}>
                <Download className="mr-1 h-4 w-4" />Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("pdf")}>
                <FileText className="mr-2 h-4 w-4" />PDF (landscape)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <RegistryActions config={REGISTRIES.containers.config} schema={REGISTRIES.containers.schema} allRows={containers as any} selectedIds={selection.selectedIds} onClearSelection={selection.clear} />
          <AddContainerDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={(f) => createMutation.mutate(f)} loading={createMutation.isPending} owners={owners} shippingLines={shippingLines} />
        </div>
      </div>

      <Dialog open={!!acqReview} onOpenChange={(o) => { if (!o) setAcqReview(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Acquisition invoices — {acqReview?.containerNumber}</DialogTitle>
          </DialogHeader>
          {acqReview && (
            <AcquisitionCostPanel
              containerId={acqReview.containerId}
              containerNumber={acqReview.containerNumber}
            />
          )}
        </DialogContent>
      </Dialog>

      <BulkActions
        config={REGISTRIES.containers.config}
        selectedIds={selection.selectedIds}
        selectedRows={selection.selectedRows}
        onClear={selection.clear}
      />

      {isOwnerOrAdmin && (
        <div className="flex flex-wrap items-center gap-2 -mt-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/inventory/acquisition-backfill">
              <FileCheck2 className="mr-2 h-4 w-4" />
              Acquisition invoice backfill
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            Raise missing seller / transport / offloading purchase invoices in bulk.
          </span>
        </div>
      )}

      {isOwnerOrAdmin && selection.selectedIds.length > 0 && (

        <div className="flex flex-wrap items-center gap-2 -mt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={bulkBackfill.isPending}
            onClick={() => bulkBackfill.mutate(selection.selectedRows)}
          >
            <FileCheck2 className="mr-2 h-4 w-4" />
            {bulkBackfill.isPending ? "Backfilling…" : `Backfill gate records for ${selection.selectedIds.length}`}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkAcqOpen(true)}>
            <FileCheck2 className="mr-2 h-4 w-4" />
            Edit acquisition costs for {selection.selectedIds.length}
          </Button>
          <span className="text-xs text-muted-foreground">
            Creates missing appointment + EIR. Depot-owned invoices need seller/price — edit those rows individually.
          </span>
        </div>
      )}

      <BulkEditAcquisitionDialog
        open={bulkAcqOpen}
        onOpenChange={setBulkAcqOpen}
        containers={(selection.selectedRows as any[]).map((r) => ({ id: r.id, container_number: r.container_number }))}
        onDone={() => selection.clear()}
      />



      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search container number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="allocated">Allocated</SelectItem>
                <SelectItem value="damaged">Damaged</SelectItem>
                <SelectItem value="repair_pending">Repair Pending</SelectItem>
                <SelectItem value="in_repair">In Repair</SelectItem>
                <SelectItem value="hold">Hold</SelectItem>
                <SelectItem value="in_conversion">In Conversion</SelectItem>
                <SelectItem value="converted">Converted</SelectItem>
                <SelectItem value="on_lease">On Lease</SelectItem>
                <SelectItem value="sold">Sold</SelectItem>
                <SelectItem value="booked_for_repatriation">Booked for Repatriation</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Owners</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.company_name}>{o.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={shippingLineFilter} onValueChange={setShippingLineFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Shipping Lines</SelectItem>
                {shippingLines.map((s) => (
                  <SelectItem key={s.id} value={s.company_name}>{s.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={heightFilter} onValueChange={setHeightFilter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Heights</SelectItem>
                <SelectItem value="HC">HC (High Cube)</SelectItem>
                <SelectItem value="LC">LC (Low Cube)</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap px-2">
              <input
                type="checkbox"
                checked={includeRetired}
                onChange={(e) => setIncludeRetired(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Include retired
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <HeaderCheckbox allSelected={selection.allSelected} someSelected={selection.someSelected} onToggle={selection.toggleAll} />
                </TableHead>
                <TableHead>Container #</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Shipping Line</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Dwell Time</TableHead>
                <TableHead>Records</TableHead>
                <TableHead className="w-12">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={11} />
              ) : !containers?.length ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No containers found</TableCell></TableRow>
              ) : (
                containers.map((c: any) => (
                  <TableRow key={c.id} className="hover:bg-muted/50" data-state={selection.isSelected(c.id) ? "selected" : undefined}>
                    <TableCell><RowCheckbox checked={selection.isSelected(c.id)} onToggle={() => selection.toggle(c.id)} /></TableCell>
                    <TableCell className="font-mono font-medium cursor-pointer" onClick={() => navigate(`/inventory/${c.id}`)}>{c.container_number}</TableCell>
                    <TableCell>{c.size}'</TableCell>
                    <TableCell>{formatCategory(c.category, c.height_class)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[c.status] ?? ""}>{c.status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>{c.owner ?? "—"}</TableCell>
                    <TableCell>{c.shipping_line ?? "—"}</TableCell>
                    <TableCell>{c.yard_blocks?.name ?? "Unassigned"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {c.gate_in_at ? formatDistanceToNow(new Date(c.gate_in_at), { addSuffix: true }) : "—"}
                    </TableCell>
                    <TableCell>
                      <RecordsBadges status={recordStatus?.[c.id]} ownershipType={c.ownership_type} />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/inventory/${c.id}`)}>
                            <Eye className="mr-2 h-4 w-4" />View Details
                          </DropdownMenuItem>
                          {isOwnerOrAdmin && (
                            <DropdownMenuItem onClick={() => openEdit(c)}>
                              <Pencil className="mr-2 h-4 w-4" />Edit
                            </DropdownMenuItem>
                          )}
                          {isOwnerOrAdmin && (() => {
                            const s = recordStatus?.[c.id];
                            const missing = !s || !s.has_appointment || !s.has_eir || (c.ownership_type === "depot_owned" && !s.has_pinv);
                            if (!missing) return null;
                            return (
                              <DropdownMenuItem onClick={() => setBackfillTarget(c)}>
                                <ReceiptText className="mr-2 h-4 w-4" />Backfill gate records / invoice
                              </DropdownMenuItem>
                            );
                          })()}
                          {isOwnerOrAdmin && !REVERSIBLE_TERMINAL.includes(c.status) && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>Change Status</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {allStatuses
                                  .filter(s => s !== c.status && !REVERSIBLE_TERMINAL.includes(s))
                                  .map(s => (
                                    <DropdownMenuItem
                                      key={s}
                                      onClick={() => setReasonState({ kind: "status_change", id: c.id, container: c.container_number, status: s })}
                                      className="capitalize"
                                    >
                                      {s.replace("_", " ")}
                                    </DropdownMenuItem>
                                  ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )}
                          {isOwnerOrAdmin && REVERSIBLE_TERMINAL.includes(c.status) && (
                            <DropdownMenuItem
                              onClick={() => setReasonState({ kind: "reverse", id: c.id, container: c.container_number, from: c.status })}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />Reverse to Available
                            </DropdownMenuItem>
                          )}
                          {isOwnerOrAdmin && <DropdownMenuSeparator />}
                          {isOwnerOrAdmin && (
                            <DropdownMenuItem onClick={() => openMove(c)}>
                              <Move className="mr-2 h-4 w-4" />Move / Reposition
                            </DropdownMenuItem>
                          )}
                          {isOwnerOrAdmin && !c.gate_out_at && !REVERSIBLE_TERMINAL.includes(c.status) && (
                            <DropdownMenuItem
                              onClick={() => setReasonState({ kind: "gate_out", id: c.id, container: c.container_number })}
                            >
                              <ArrowRightFromLine className="mr-2 h-4 w-4" />Gate Out
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => navigate("/inspections")}>
                            <ClipboardCheck className="mr-2 h-4 w-4" />Create Inspection
                          </DropdownMenuItem>
                        </DropdownMenuContent>

                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Container Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Container</DialogTitle></DialogHeader>
          {editTarget && (
            <form onSubmit={(e) => {
              e.preventDefault();
              const { id, weight_kg, tare_weight_kg, category, reason, ...rest } = editTarget;
              if (category === "dry" && !rest.height_class) {
                toast({ title: "Height class is required for dry containers", variant: "destructive" });
                return;
              }
              if (!reason || reason.trim().length < 5) {
                toast({ title: "Reason is required (min 5 characters)", variant: "destructive" });
                return;
              }
              updateMutation.mutate({
                id,
                reason,
                ...rest,
                height_class: category === "dry" ? rest.height_class : null,
                weight_kg: weight_kg ? parseFloat(weight_kg) : null,
                tare_weight_kg: tare_weight_kg ? parseFloat(tare_weight_kg) : null,
              });
            }} className="space-y-4">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Category: </span>
                <span className="font-medium">{formatCategory(editTarget.category, editTarget.height_class)}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editTarget.status} onValueChange={(v) => setEditTarget((t: any) => ({ ...t, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allStatuses.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ISO Type</Label>
                  <Input value={editTarget.iso_type} onChange={(e) => setEditTarget((t: any) => ({ ...t, iso_type: e.target.value }))} />
                </div>
              </div>
              {editTarget.category === "dry" && (
                <div className="space-y-2">
                  <Label>Height Class *</Label>
                  <Select value={editTarget.height_class || "LC"} onValueChange={(v) => setEditTarget((t: any) => ({ ...t, height_class: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{HEIGHT_CLASS_LABELS[h]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Owner</Label>
                  <Input value={editTarget.owner} onChange={(e) => setEditTarget((t: any) => ({ ...t, owner: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Shipping Line</Label>
                  <Input value={editTarget.shipping_line} onChange={(e) => setEditTarget((t: any) => ({ ...t, shipping_line: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Weight (kg)</Label>
                  <Input type="number" value={editTarget.weight_kg} onChange={(e) => setEditTarget((t: any) => ({ ...t, weight_kg: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Tare Weight (kg)</Label>
                  <Input type="number" value={editTarget.tare_weight_kg} onChange={(e) => setEditTarget((t: any) => ({ ...t, tare_weight_kg: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={editTarget.notes} onChange={(e) => setEditTarget((t: any) => ({ ...t, notes: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Reason for change <span className="text-destructive">*</span></Label>
                <Textarea
                  value={editTarget.reason ?? ""}
                  onChange={(e) => setEditTarget((t: any) => ({ ...t, reason: e.target.value }))}
                  placeholder="Explain why this container is being edited (audit trail)"
                  rows={2}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Move Container Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Move / Reposition Container</DialogTitle></DialogHeader>
          {editTarget && (
            <form onSubmit={(e) => {
              e.preventDefault();
              const reason = (editTarget.reason ?? "").trim();
              if (reason.length < 5) {
                toast({ title: "Reason is required (min 5 characters)", variant: "destructive" });
                return;
              }
              updateMutation.mutate({
                id: editTarget.id,
                reason: `Move: ${reason}`,
                block_id: editTarget.block_id || null,
                bay: editTarget.bay ? parseInt(editTarget.bay) : null,
                row: editTarget.row ? parseInt(editTarget.row) : null,
                tier: editTarget.tier ? parseInt(editTarget.tier) : null,
              });
            }} className="space-y-4">
              <div className="space-y-2">
                <Label>Yard Block</Label>
                <Select value={editTarget.block_id} onValueChange={(v) => setEditTarget((t: any) => ({ ...t, block_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select block" /></SelectTrigger>
                  <SelectContent>
                    {yardBlocks?.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.block_type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Bay</Label>
                  <Input type="number" min="1" value={editTarget.bay} onChange={(e) => setEditTarget((t: any) => ({ ...t, bay: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Row</Label>
                  <Input type="number" min="1" value={editTarget.row} onChange={(e) => setEditTarget((t: any) => ({ ...t, row: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Tier</Label>
                  <Input type="number" min="1" value={editTarget.tier} onChange={(e) => setEditTarget((t: any) => ({ ...t, tier: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Reason for move <span className="text-destructive">*</span></Label>
                <Textarea
                  value={editTarget.reason ?? ""}
                  onChange={(e) => setEditTarget((t: any) => ({ ...t, reason: e.target.value }))}
                  placeholder="e.g. Restacking for outbound schedule"
                  rows={2}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Moving..." : "Move Container"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={!!reasonState}
        onOpenChange={(o) => { if (!o) setReasonState(null); }}
        title={
          reasonState?.kind === "reverse" ? `Reverse ${reasonState.container} to Available`
          : reasonState?.kind === "gate_out" ? `Gate Out ${reasonState.container}`
          : reasonState?.kind === "status_change" ? `Change status to ${reasonState.status.replace("_", " ")}`
          : ""
        }
        description={
          reasonState?.kind === "reverse"
            ? `This container is currently ${reasonState.from.replace("_", " ")}. A reversal will return it to Available and be logged to the audit trail.`
            : "This action will be recorded in the container audit trail."
        }
        confirmLabel={reasonState?.kind === "reverse" ? "Reverse" : "Confirm"}
        loading={changeStatus.isPending || gateOutMutation.isPending || reverseStatus.isPending}
        onConfirm={(reason) => {
          if (!reasonState) return;
          if (reasonState.kind === "status_change") {
            changeStatus.mutate({ id: reasonState.id, status: reasonState.status, reason });
          } else if (reasonState.kind === "gate_out") {
            gateOutMutation.mutate({ id: reasonState.id, reason });
          } else if (reasonState.kind === "reverse") {
            reverseStatus.mutate({ id: reasonState.id, reason });
          }
        }}
      />

      <BackfillDialog
        target={backfillTarget}
        status={backfillTarget ? recordStatus?.[backfillTarget.id] : undefined}
        loading={backfillOne.isPending}
        onClose={() => setBackfillTarget(null)}
        onSubmit={(input) => backfillOne.mutate(input)}
      />
    </div>
  );
}

function RecordsBadges({
  status,
  ownershipType,
}: {
  status?: ContainerRecordStatus;
  ownershipType?: string | null;
}) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const cls = (ok: boolean) =>
    ok
      ? "bg-success/15 text-success border-success/30"
      : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <div className="flex gap-1 flex-wrap">
      <Badge variant="outline" className={`text-[10px] ${cls(status.has_appointment)}`}>
        {status.has_appointment ? "✓" : "✗"} Appt
      </Badge>
      <Badge variant="outline" className={`text-[10px] ${cls(status.has_eir)}`}>
        {status.has_eir ? "✓" : "✗"} EIR
      </Badge>
      {ownershipType === "depot_owned" && (
        <Badge variant="outline" className={`text-[10px] ${cls(status.has_pinv)}`}>
          {status.has_pinv ? "✓" : "✗"} PINV
        </Badge>
      )}
    </div>
  );
}

function BackfillDialog({
  target,
  status,
  loading,
  onClose,
  onSubmit,
}: {
  target: any | null;
  status?: ContainerRecordStatus;
  loading: boolean;
  onClose: () => void;
  onSubmit: (input: Parameters<typeof backfillContainerRecords>[0]) => void;
}) {
  const orgCurrency = getOrgCurrency() || "USD";
  const [transporter, setTransporter] = useState("");
  const [truck, setTruck] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverIdNumber, setDriverIdNumber] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [pickupDepotId, setPickupDepotId] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<"shipper_owned" | "depot_owned">("shipper_owned");
  const [seller, setSeller] = useState("");
  const [price, setPrice] = useState<string>("");
  const [currency, setCurrency] = useState(orgCurrency);
  const [transportVendor, setTransportVendor] = useState("");
  const [transportCost, setTransportCost] = useState("");
  const [offloadVendor, setOffloadVendor] = useState("");
  const [offloadCost, setOffloadCost] = useState("");
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-active-backfill"],
    enabled: !!target,
    queryFn: async () =>
      (await supabase.from("suppliers").select("id,name,currency").eq("is_active", true).order("name")).data ?? [],
  });
  const { data: depotList } = useQuery({
    queryKey: ["depots-backfill-pick"],
    enabled: !!target,
    queryFn: async () => (await supabase.from("depots").select("id,name").order("name")).data ?? [],
  });

  const [initFor, setInitFor] = useState<string | null>(null);
  if (target && target.id !== initFor) {
    setInitFor(target.id);
    setTransporter(target.transporter ?? "");
    setTruck(target.truck_registration ?? "");
    setDriverName(target.driver_name ?? "");
    setDriverPhone(target.driver_phone ?? "");
    setDriverIdNumber(target.driver_id_number ?? "");
    setPickupLocation(target.pickup_location ?? "");
    setPickupDepotId(target.pickup_depot_id ?? null);
    setOwnership((target.ownership_type as any) ?? "shipper_owned");
    setSeller("");
    setPrice("");
    setCurrency(target.acquisition_currency ?? orgCurrency);
    setTransportVendor(target.transport_vendor ?? target.transporter ?? "");
    setTransportCost(target.transport_cost ? String(target.transport_cost) : "");
    setOffloadVendor(target.offloading_vendor ?? "");
    setOffloadCost(target.offloading_cost ? String(target.offloading_cost) : "");
  }

  if (!target) return null;

  const needsInvoice = ownership === "depot_owned" && status && !status.has_pinv;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setInitFor(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Backfill records — {target.container_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {status && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="font-medium mb-1">Current state</div>
              <div>Gate appointment: {status.has_appointment ? "✓ present" : "✗ missing"}</div>
              <div>EIR gate-in: {status.has_eir ? "✓ present" : "✗ missing"}</div>
              <div>Supplier invoice (PINV): {status.has_pinv ? "✓ present" : ownership === "depot_owned" ? "✗ missing" : "not applicable"}</div>
              <div>Transport invoice: {status.has_transport_invoice ? "✓ present" : "✗ missing"}</div>
              <div>Crane / offloading invoice: {status.has_offloading_invoice ? "✓ present" : "✗ missing"}</div>
            </div>
          )}

          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-sm font-semibold">Ownership</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOwnership("shipper_owned")}
                className={`rounded-md border p-2 text-sm text-left ${ownership === "shipper_owned" ? "border-primary bg-primary/5" : "border-input"}`}
              >
                <div className="font-medium">Shipper-owned</div>
                <div className="text-xs text-muted-foreground">No supplier invoice</div>
              </button>
              <button
                type="button"
                onClick={() => setOwnership("depot_owned")}
                className={`rounded-md border p-2 text-sm text-left ${ownership === "depot_owned" ? "border-primary bg-primary/5" : "border-input"}`}
              >
                <div className="font-medium">Depot-owned (purchased)</div>
                <div className="text-xs text-muted-foreground">Seller will be invoiced</div>
              </button>
            </div>
          </div>

          {needsInvoice && (
            <div className="space-y-3 rounded-md border p-3 bg-muted/30">
              <Label className="text-sm font-semibold">Seller & purchase</Label>
              <div className="space-y-2">
                <Label className="text-xs">Seller *</Label>
                <Select
                  value={seller || undefined}
                  onValueChange={(v) => {
                    setSeller(v);
                    const s = (suppliers ?? []).find((x: any) => x.name === v);
                    if (s?.currency) setCurrency(s.currency);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select seller / supplier" /></SelectTrigger>
                  <SelectContent>
                    {(suppliers ?? []).map((s: any) => (
                      <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={seller}
                  onChange={(e) => setSeller(e.target.value)}
                  placeholder="…or type seller name"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label className="text-xs">Purchase Price *</Label>
                  <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Currency *</Label>
                  <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={4} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">A PINV will be issued to the seller and posted to accounts payable.</p>
            </div>
          )}

          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-sm font-semibold">Transport / Delivery (optional overrides)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Transporter</Label>
                <Input value={transporter} onChange={(e) => setTransporter(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Truck plate</Label>
                <Input value={truck} onChange={(e) => setTruck(e.target.value.toUpperCase())} className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Driver name</Label>
                <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Driver phone</Label>
                <Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Driver ID / License #</Label>
                <Input value={driverIdNumber} onChange={(e) => setDriverIdNumber(e.target.value)} placeholder="National ID or licence #" />
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-sm font-semibold">Pickup Location</Label>
            <Select
              value={pickupDepotId || undefined}
              onValueChange={(v) => {
                if (v === "__other__") { setPickupDepotId(null); setPickupLocation(""); return; }
                const d = (depotList ?? []).find((x: any) => x.id === v);
                setPickupDepotId(v);
                setPickupLocation(d?.name ?? "");
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select pickup depot / yard" /></SelectTrigger>
              <SelectContent>
                {(depotList ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                <SelectItem value="__other__">Other (type manually)</SelectItem>
              </SelectContent>
            </Select>
            <Input value={pickupLocation} onChange={(e) => { setPickupLocation(e.target.value); setPickupDepotId(null); }} placeholder="…or type pickup location" />
          </div>

          <div className="space-y-3 rounded-md border p-3 bg-muted/30">
            <div>
              <Label className="text-sm font-semibold">Transport & offloading costs</Label>
              <p className="text-xs text-muted-foreground">Each raises its own purchase invoice to the vendor. Already-invoiced services are skipped.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Transport vendor</Label>
                <Input value={transportVendor} onChange={(e) => setTransportVendor(e.target.value)} placeholder="Transporter / haulier" disabled={status?.has_transport_invoice} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cost</Label>
                <Input type="number" step="0.01" min="0" value={transportCost} onChange={(e) => setTransportCost(e.target.value)} placeholder="0.00" disabled={status?.has_transport_invoice} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Crane / offloading vendor</Label>
                <Input value={offloadVendor} onChange={(e) => setOffloadVendor(e.target.value)} placeholder="Crane contractor" disabled={status?.has_offloading_invoice} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cost</Label>
                <Input type="number" step="0.01" min="0" value={offloadCost} onChange={(e) => setOffloadCost(e.target.value)} placeholder="0.00" disabled={status?.has_offloading_invoice} />
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={loading || (needsInvoice && (!seller.trim() || !(Number(price) > 0) || !currency.trim()))}
            onClick={() =>
              onSubmit({
                container: {
                  id: target.id,
                  container_number: target.container_number,
                  owner: target.owner,
                  shipping_line: target.shipping_line,
                  ownership_type: ownership,
                  transporter: target.transporter,
                  truck_registration: target.truck_registration,
                  driver_name: target.driver_name,
                  driver_phone: target.driver_phone,
                },
                transporter: transporter || null,
                truck_registration: truck || null,
                driver_name: driverName || null,
                driver_phone: driverPhone || null,
                driver_id_number: driverIdNumber || null,
                pickup_location: pickupLocation || null,
                pickup_depot_id: pickupDepotId || null,
                seller_name: seller || null,
                purchase_price: price ? Number(price) : null,
                purchase_currency: currency || null,
                transport_vendor: transportVendor || null,
                transport_cost: transportCost ? Number(transportCost) : null,
                offloading_vendor: offloadVendor || null,
                offloading_cost: offloadCost ? Number(offloadCost) : null,
                acquisition_currency: currency || null,
              } as any)
            }
          >
            {loading ? "Backfilling…" : "Run backfill"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type CustomerOption = { id: string; company_name: string; customer_type: string };

function AddContainerDialog({
  open, onOpenChange, onSubmit, loading, owners, shippingLines,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (form: any) => void; loading: boolean;
  owners: CustomerOption[]; shippingLines: CustomerOption[];
}) {
  const depotName = getPrintDepot()?.name ?? "Depot";
  const orgCurrency = getOrgCurrency() || "USD";
  const acqDefaults = getAcquisitionDefaults();
  const [form, setForm] = useState({
    container_number: "", size: "20" as const, category: "dry" as const, status: "available" as const,
    owner: "", shipping_line: "", is_empty: true, height_class: "LC" as "HC" | "LC" | "",
    ownership_type: "shipper_owned" as "shipper_owned" | "depot_owned",
    transporter: "", truck_registration: "", driver_name: "", driver_phone: "", driver_id_number: "",
    pickup_location: "", pickup_depot_id: null as string | null,
    seller_name: "", purchase_price: "" as string | number, purchase_currency: orgCurrency,
    transport_cost: (acqDefaults.transportRate20 ?? acqDefaults.transportCost ?? "") as string | number,
    transport_vendor: acqDefaults.transportVendor,
    offloading_cost: (acqDefaults.offloadingCost ?? "") as string | number,
    offloading_vendor: acqDefaults.offloadingVendor,
    acquisition_currency: orgCurrency,
    override_reason: "",
  });
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-active-pick"],
    enabled: open,
    queryFn: async () => (await supabase.from("suppliers").select("id,name,currency").eq("is_active", true).order("name")).data ?? [],
  });
  const [sellerMode, setSellerMode] = useState<"select" | "other">("select");
  const [ownerMode, setOwnerMode] = useState<"select" | "other">("select");
  const [shippingMode, setShippingMode] = useState<"select" | "other">("select");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const err = (k: string) => errors[k];
  const normDefault = (v: any) => (v === null || v === undefined || v === "" ? "" : String(v).trim());
  const overridesDefaults =
    normDefault(form.transport_vendor) !== normDefault(acqDefaults.transportVendor) ||
    normDefault(form.transport_cost) !== normDefault(acqDefaults.transportCost) ||
    normDefault(form.offloading_vendor) !== normDefault(acqDefaults.offloadingVendor) ||
    normDefault(form.offloading_cost) !== normDefault(acqDefaults.offloadingCost);
  const set = (k: string, v: any) => {
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
    setForm((f) => {
      const next = { ...f, [k]: v } as any;
      if (k === "category") next.height_class = v === "dry" ? (f.height_class || "LC") : "";
      if (k === "size") {
        // Pre-fill the transport cost from the size-matched standard rate.
        const rate = String(v) === "40" || String(v) === "45" ? acqDefaults.transportRate40 : acqDefaults.transportRate20;
        if (rate) next.transport_cost = rate;
      }
      if (k === "ownership_type" && v === "depot_owned") { next.owner = ""; next.shipping_line = ""; }
      return next;
    });
  };

  const { data: trucks } = useQuery({
    queryKey: ["trucks-drivers-pick"],
    enabled: open,
    queryFn: async () => (await supabase.from("trucks_drivers").select("id,truck_plate,driver_name,driver_phone,driver_license,company").eq("is_active", true).order("truck_plate")).data ?? [],
  });

  const { data: depotList } = useQuery({
    queryKey: ["depots-pick"],
    enabled: open,
    queryFn: async () => (await supabase.from("depots").select("id,name").order("name")).data ?? [],
  });

  const [pickupMode, setPickupMode] = useState<"select" | "other">("select");
  const handlePickupChange = (v: string) => {
    if (v === "__other__") { setPickupMode("other"); setForm((f) => ({ ...f, pickup_depot_id: null, pickup_location: "" })); return; }
    const d = (depotList ?? []).find((x: any) => x.id === v);
    setPickupMode("select");
    setForm((f) => ({ ...f, pickup_depot_id: v, pickup_location: d?.name ?? "" }));
    setErrors((e) => { const n = { ...e }; delete n.pickup_location; return n; });
  };

  const handleOwnerChange = (v: string) => {
    if (v === "__other__") { setOwnerMode("other"); set("owner", ""); } else { setOwnerMode("select"); set("owner", v); }
  };
  const handleShippingChange = (v: string) => {
    if (v === "__other__") { setShippingMode("other"); set("shipping_line", ""); } else { setShippingMode("select"); set("shipping_line", v); }
  };

  const handleTruckPick = (v: string) => {
    if (v === "__other__") { set("truck_registration", ""); return; }
    const t = (trucks ?? []).find((x: any) => x.id === v);
    if (!t) return;
    setErrors({});
    setForm((f) => ({
      ...f,
      truck_registration: t.truck_plate ?? "",
      driver_name: t.driver_name ?? f.driver_name,
      driver_phone: t.driver_phone ?? f.driver_phone,
      driver_id_number: t.driver_license ?? f.driver_id_number,
      transporter: t.company ?? f.transporter,
    }));
  };

  const selectedTruckId = (trucks ?? []).find((t: any) => t.truck_plate === form.truck_registration)?.id;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setErrors({}); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add Container</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Container</DialogTitle></DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = addContainerSchema.safeParse(form);
            if (!parsed.success) {
              const map: Record<string, string> = {};
              for (const issue of parsed.error.issues) {
                const key = issue.path.join(".") || "_";
                if (!map[key]) map[key] = issue.message;
              }
              setErrors(map);
              return;
            }
            const payload: any = { ...parsed.data };
            if (payload.category !== "dry") payload.height_class = null;
            if (!payload.height_class) payload.height_class = null;
            if (payload.ownership_type === "depot_owned") {
              payload.owner = depotName;
              payload.shipping_line = null;
            }
            ["transporter","truck_registration","driver_name","driver_phone","driver_id_number","owner","shipping_line","seller_name","purchase_currency","pickup_location","transport_vendor","offloading_vendor"].forEach((k) => { if (!payload[k]) payload[k] = null; });
            payload.transport_cost = Number(payload.transport_cost ?? 0) || 0;
            payload.offloading_cost = Number(payload.offloading_cost ?? 0) || 0;
            payload.acquisition_currency = (payload.acquisition_currency || orgCurrency || "USD").toUpperCase();
            if (!payload.pickup_depot_id) payload.pickup_depot_id = null;
            payload.is_empty = form.is_empty;
            payload.status = form.status;
            setErrors({});
            onSubmit(payload);
          }}
          className="space-y-4"
        >

          <div className="space-y-2">
            <Label>Container Number</Label>
            <Input placeholder="MSCU1234567" value={form.container_number} onChange={(e) => set("container_number", e.target.value.toUpperCase())} className="font-mono" aria-invalid={!!err("container_number")} />
            {err("container_number") && <p className="text-xs text-destructive">{err("container_number")}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Size</Label>
              <Select value={form.size} onValueChange={(v) => set("size", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20'</SelectItem>
                  <SelectItem value="40">40'</SelectItem>
                  <SelectItem value="45">45'</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dry">Dry</SelectItem>
                  <SelectItem value="reefer">Reefer</SelectItem>
                  <SelectItem value="tank">Tank</SelectItem>
                  <SelectItem value="flat_rack">Flat Rack</SelectItem>
                  <SelectItem value="open_top">Open Top</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.category === "dry" && (
            <div className="space-y-2">
              <Label>Height Class *</Label>
              <Select value={form.height_class || "LC"} onValueChange={(v) => set("height_class", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HEIGHT_CLASSES.map((h) => <SelectItem key={h} value={h}>{HEIGHT_CLASS_LABELS[h]}</SelectItem>)}
                </SelectContent>
              </Select>
              {err("height_class") && <p className="text-xs text-destructive">{err("height_class")}</p>}
            </div>
          )}


          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-sm font-semibold">Ownership</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set("ownership_type", "shipper_owned")}
                className={`rounded-md border p-2 text-sm text-left ${form.ownership_type === "shipper_owned" ? "border-primary bg-primary/5" : "border-input"}`}
              >
                <div className="font-medium">Shipper-owned</div>
                <div className="text-xs text-muted-foreground">Belongs to an owner / shipping line</div>
              </button>
              <button
                type="button"
                onClick={() => set("ownership_type", "depot_owned")}
                className={`rounded-md border p-2 text-sm text-left ${form.ownership_type === "depot_owned" ? "border-primary bg-primary/5" : "border-input"}`}
              >
                <div className="font-medium">Purchased by {depotName}</div>
                <div className="text-xs text-muted-foreground">Depot stock — seller will be invoiced</div>
              </button>
            </div>
          </div>

          {form.ownership_type === "shipper_owned" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Owner</Label>
                {ownerMode === "select" ? (
                  <Select value={form.owner || undefined} onValueChange={handleOwnerChange}>
                    <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                    <SelectContent>
                      {owners.map((o) => <SelectItem key={o.id} value={o.company_name}>{o.company_name}</SelectItem>)}
                      <SelectItem value="__other__">Other (type manually)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-1">
                    <Input value={form.owner} onChange={(e) => set("owner", e.target.value)} placeholder="Type owner name" className="flex-1" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setOwnerMode("select"); set("owner", ""); }}>✕</Button>
                  </div>
                )}
                {err("owner") && <p className="text-xs text-destructive">{err("owner")}</p>}
              </div>
              <div className="space-y-2">
                <Label>Shipping Line</Label>

                {shippingMode === "select" ? (
                  <Select value={form.shipping_line || undefined} onValueChange={handleShippingChange}>
                    <SelectTrigger><SelectValue placeholder="Select shipping line" /></SelectTrigger>
                    <SelectContent>
                      {shippingLines.map((s) => <SelectItem key={s.id} value={s.company_name}>{s.company_name}</SelectItem>)}
                      <SelectItem value="__other__">Other (type manually)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-1">
                    <Input value={form.shipping_line} onChange={(e) => set("shipping_line", e.target.value)} placeholder="Type shipping line" className="flex-1" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setShippingMode("select"); set("shipping_line", ""); }}>✕</Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {form.ownership_type === "depot_owned" && (
            <div className="space-y-3 rounded-md border p-3 bg-muted/30">
              <Label className="text-sm font-semibold">Seller (invoices {depotName})</Label>
              <div className="space-y-2">
                <Label className="text-xs">Seller *</Label>
                {sellerMode === "select" ? (
                  <Select
                    value={form.seller_name || undefined}
                    onValueChange={(v) => {
                      if (v === "__other__") { setSellerMode("other"); set("seller_name", ""); return; }
                      const s = (suppliers ?? []).find((x: any) => x.name === v);
                      set("seller_name", v);
                      if (s?.currency) set("purchase_currency", s.currency);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select seller / supplier" /></SelectTrigger>
                    <SelectContent>
                      {(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                      <SelectItem value="__other__">Other (type manually)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-1">
                    <Input value={form.seller_name} onChange={(e) => set("seller_name", e.target.value)} placeholder="Seller name" className="flex-1" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setSellerMode("select"); set("seller_name", ""); }}>✕</Button>
                  </div>
                )}
                {err("seller_name") && <p className="text-xs text-destructive">{err("seller_name")}</p>}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label className="text-xs">Purchase Price *</Label>
                  <Input type="number" step="0.01" min="0" value={form.purchase_price as any} onChange={(e) => set("purchase_price", e.target.value)} placeholder="0.00" aria-invalid={!!err("purchase_price")} />
                  {err("purchase_price") && <p className="text-xs text-destructive">{err("purchase_price")}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Currency *</Label>
                  <Input value={form.purchase_currency} onChange={(e) => set("purchase_currency", e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={4} />
                  {err("purchase_currency") && <p className="text-xs text-destructive">{err("purchase_currency")}</p>}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">A supplier invoice (PINV) will be issued to the seller and posted to accounts payable.</p>
            </div>
          )}

          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-sm font-semibold">Transport / Delivery</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Truck (registered)</Label>
                <Select value={selectedTruckId || undefined} onValueChange={handleTruckPick}>
                  <SelectTrigger><SelectValue placeholder="Pick registered truck" /></SelectTrigger>
                  <SelectContent>
                    {(trucks ?? []).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.truck_plate} — {t.driver_name}</SelectItem>
                    ))}
                    <SelectItem value="__other__">Other (type manually)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Truck Registration *</Label>
                <Input value={form.truck_registration} onChange={(e) => set("truck_registration", e.target.value.toUpperCase())} placeholder="KDA 123X" className="font-mono" aria-invalid={!!err("truck_registration")} />
                {err("truck_registration") && <p className="text-xs text-destructive">{err("truck_registration")}</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Transporter / Company *</Label>
                <Input value={form.transporter} onChange={(e) => set("transporter", e.target.value)} placeholder="Carrier name" aria-invalid={!!err("transporter")} />
                {err("transporter") && <p className="text-xs text-destructive">{err("transporter")}</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Driver Name *</Label>
                <Input value={form.driver_name} onChange={(e) => set("driver_name", e.target.value)} placeholder="Full name" aria-invalid={!!err("driver_name")} />
                {err("driver_name") && <p className="text-xs text-destructive">{err("driver_name")}</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Driver Phone *</Label>
                <Input value={form.driver_phone} onChange={(e) => set("driver_phone", e.target.value)} placeholder="+254…" aria-invalid={!!err("driver_phone")} />
                {err("driver_phone") && <p className="text-xs text-destructive">{err("driver_phone")}</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Driver ID / License # *</Label>
                <Input value={form.driver_id_number} onChange={(e) => set("driver_id_number", e.target.value)} placeholder="National ID or licence #" aria-invalid={!!err("driver_id_number")} />
                {err("driver_id_number") && <p className="text-xs text-destructive">{err("driver_id_number")}</p>}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-sm font-semibold">Pickup Location *</Label>
            <p className="text-xs text-muted-foreground">Where was this container picked up from?</p>
            {pickupMode === "select" ? (
              <Select value={form.pickup_depot_id || undefined} onValueChange={handlePickupChange}>
                <SelectTrigger><SelectValue placeholder="Select pickup depot / yard" /></SelectTrigger>
                <SelectContent>
                  {(depotList ?? []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  <SelectItem value="__other__">Other (type manually)</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex gap-1">
                <Input value={form.pickup_location} onChange={(e) => set("pickup_location", e.target.value)} placeholder="e.g. Mombasa Port, ICD Nairobi" className="flex-1" aria-invalid={!!err("pickup_location")} />
                <Button type="button" variant="ghost" size="sm" onClick={() => { setPickupMode("select"); setForm((f) => ({ ...f, pickup_location: "", pickup_depot_id: null })); }}>✕</Button>
              </div>
            )}
            {err("pickup_location") && <p className="text-xs text-destructive">{err("pickup_location")}</p>}
          </div>

          <div className="space-y-3 rounded-md border p-3 bg-muted/30">
            <div>
              <Label className="text-sm font-semibold">Transport & offloading costs (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Each cost entered raises its own purchase invoice to the vendor. Together with the seller invoice these make up the container acquisition cost.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Transport vendor</Label>
                <SupplierCombobox
                  value={form.transport_vendor}
                  onChange={(name) => set("transport_vendor", name)}
                  placeholder="Select registered transporter"
                  extraOptions={form.transporter ? [form.transporter] : []}
                  invalid={!!err("transport_vendor")}
                />
                {err("transport_vendor") && <p className="text-xs text-destructive">{err("transport_vendor")}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Transport cost</Label>
                <Input type="number" step="0.01" min="0" value={form.transport_cost as any} onChange={(e) => set("transport_cost", e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Crane / offloading vendor</Label>
                <Select value={form.offloading_vendor || undefined} onValueChange={(v) => set("offloading_vendor", v)}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {(suppliers ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  value={form.offloading_vendor}
                  onChange={(e) => set("offloading_vendor", e.target.value)}
                  placeholder="…or type vendor name"
                  aria-invalid={!!err("offloading_vendor")}
                />
                {err("offloading_vendor") && <p className="text-xs text-destructive">{err("offloading_vendor")}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Offloading cost</Label>
                <Input type="number" step="0.01" min="0" value={form.offloading_cost as any} onChange={(e) => set("offloading_cost", e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1 max-w-[8rem]">
                <Label className="text-xs">Currency</Label>
                <Input value={form.acquisition_currency} onChange={(e) => set("acquisition_currency", e.target.value.toUpperCase())} className="font-mono uppercase" maxLength={4} />
              </div>
              {overridesDefaults && (
                <div className="space-y-1 flex-1 min-w-[12rem]">
                  <Label className="text-xs">Reason for overriding defaults</Label>
                  <Input value={form.override_reason} onChange={(e) => set("override_reason", e.target.value)} placeholder="e.g. regular crane unavailable" />
                </div>
              )}
            </div>
            {overridesDefaults && (
              <p className="text-xs text-amber-600">
                Differs from the organization defaults — the change will be recorded in the audit trail.
              </p>
            )}
          </div>


          <Button type="submit" className="w-full" disabled={loading}>{loading ? "Adding..." : "Add Container"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

