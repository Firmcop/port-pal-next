import { useState, useRef, useEffect } from "react";
import { getDefaultCurrency } from "@/lib/finance-format";
import { getPrintDepot } from "@/lib/app-settings";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Printer, Share2, Upload, Image as ImageIcon, Pencil, Trash2, FileText } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ApprovalTimeline } from "@/components/approvals/ApprovalTimeline";
import { EirApprovalCell } from "@/components/approvals/EirApprovalCell";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { generateEirPrint, templateLabels, templateDescriptions, type EirTemplateType, type EirPrintData } from "@/lib/eir-templates";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { acquireContainerFromOwner } from "@/lib/container-acquisition";
import { useOrgCurrency } from "@/hooks/use-org-currency";
import { HEIGHT_CLASSES, HEIGHT_CLASS_LABELS, requiresHeightClass } from "@/lib/container-constants";
import { uploadContainerPhoto, signContainerPhoto, signContainerPhotos } from "@/lib/containerPhotos";

const gradeColors: Record<string, string> = {
  A: "bg-success/15 text-success border-success/30",
  B: "bg-info/15 text-info border-info/30",
  C: "bg-warning/15 text-warning border-warning/30",
  D: "bg-destructive/15 text-destructive border-destructive/30",
};

async function generateEirNumber(prefix: string = "EIR"): Promise<string> {
  const { data, error } = await supabase.rpc("next_eir_number" as any, { prefix });
  if (error || !data) {
    const d = new Date();
    return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  }
  return data as unknown as string;
}

function ShareDialog({ record, open, onOpenChange }: { record: any; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const containerNum = record?.containers?.container_number ?? "N/A";
  const eirNum = record?.eir_number ?? "";
  const eirType = record?.eir_type === "gate_in" ? "Gate In" : "Gate Out";
  const summary = `EIR ${eirNum} — ${eirType} — Container: ${containerNum} — Grade: ${record?.condition_grade ?? "N/A"} — Cargo: ${record?.cargo_status ?? "N/A"}`;

  const share = async (channel: string, contact: string) => {
    if (!contact) { toast({ title: "No contact info", variant: "destructive" }); return; }
    const encoded = encodeURIComponent(summary);
    if (channel === "whatsapp") {
      const phone = contact.replace(/[^0-9+]/g, "");
      window.open(`https://wa.me/${phone}?text=${encoded}`, "_blank");
    } else if (channel === "email") {
      window.open(`mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent(`EIR ${eirNum}`)}body=${encoded}`, "_blank");
    } else if (channel === "sms") {
      const phone = contact.replace(/[^0-9+]/g, "");
      window.open(`sms:${phone}?body=${encoded}`, "_blank");
    }
    // Log notification
    await supabase.from("notification_log").insert({
      recipient_name: contact,
      recipient_contact: contact,
      channel,
      message_summary: summary,
      reference_type: "eir_records",
      reference_id: record.id,
      sent_by: user?.id,
    } as any);
    toast({ title: `Shared via ${channel}` });
  };

  const [shareContact, setShareContact] = useState("");
  const [shareChannel, setShareChannel] = useState("whatsapp");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Share EIR</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground mb-2">{summary}</p>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select value={shareChannel} onValueChange={setShareChannel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{shareChannel === "email" ? "Email Address" : "Phone Number"}</Label>
            <Input value={shareContact} onChange={(e) => setShareContact(e.target.value)} placeholder={shareChannel === "email" ? "name@example.com" : "+1234567890"} />
          </div>
          <Button className="w-full" onClick={() => share(shareChannel, shareContact)}>
            <Share2 className="mr-2 h-4 w-4" />Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditEirDialog({ record, open, onOpenChange, onSaved }: { record: any; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    condition_grade: "A",
    cargo_status: "empty",
    seal_number: "",
    damage_description: "",
    inspector_notes: "",
    release_purpose: "",
    truck_plate: "",
    driver_name: "",
    driver_phone: "",
    transporter_company: "",
    origin_location: "",
    nominated_depot: "",
    transporter_indemnity_signed: false,
    transporter_indemnity_signer: "",
  });

  useEffect(() => {
    if (record) {
      setForm({
        condition_grade: record.condition_grade ?? "A",
        cargo_status: record.cargo_status ?? "empty",
        seal_number: record.seal_number ?? "",
        damage_description: record.damage_description ?? "",
        inspector_notes: record.inspector_notes ?? "",
        release_purpose: record.release_purpose ?? "",
        truck_plate: record.truck_plate ?? "",
        driver_name: record.driver_name ?? "",
        driver_phone: record.driver_phone ?? "",
        transporter_company: record.transporter_company ?? "",
        origin_location: record.origin_location ?? "",
        nominated_depot: record.nominated_depot ?? "",
        transporter_indemnity_signed: !!record.transporter_indemnity_signed,
        transporter_indemnity_signer: record.transporter_indemnity_signer ?? "",
      });
    }
  }, [record]);

  if (!record) return null;
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    const payload: any = {
      condition_grade: form.condition_grade,
      cargo_status: form.cargo_status,
      seal_number: form.seal_number || null,
      damage_description: form.damage_description || null,
      inspector_notes: form.inspector_notes || null,
      truck_plate: form.truck_plate || null,
      driver_name: form.driver_name || null,
      driver_phone: form.driver_phone || null,
      transporter_company: form.transporter_company || null,
      origin_location: form.origin_location || null,
      nominated_depot: form.nominated_depot || null,
      transporter_indemnity_signed: !!form.transporter_indemnity_signed,
      transporter_indemnity_signer: form.transporter_indemnity_signed ? (form.transporter_indemnity_signer || null) : null,
      transporter_indemnity_signed_at: form.transporter_indemnity_signed ? new Date().toISOString() : null,
    };
    if (record.eir_type === "gate_out") {
      payload.release_purpose = form.release_purpose || null;
    }
    const { error } = await supabase.from("eir_records").update(payload).eq("id", record.id);
    setSaving(false);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "EIR updated" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit EIR {record.eir_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Condition Grade</Label>
              <Select value={form.condition_grade} onValueChange={(v) => set("condition_grade", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A - Excellent</SelectItem>
                  <SelectItem value="B">B - Good</SelectItem>
                  <SelectItem value="C">C - Fair</SelectItem>
                  <SelectItem value="D">D - Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cargo Status</Label>
              <Select value={form.cargo_status} onValueChange={(v) => set("cargo_status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="empty">Empty</SelectItem>
                  <SelectItem value="laden">Laden</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Seal Number</Label>
            <Input value={form.seal_number} onChange={(e) => set("seal_number", e.target.value)} />
          </div>
          {record.eir_type === "gate_in" && (
            <div className="space-y-2">
              <Label>Arrived From (origin location)</Label>
              <Input
                value={form.origin_location}
                onChange={(e) => set("origin_location", e.target.value)}
                placeholder="Remitting depot / port of arrival"
              />
            </div>
          )}
          {record.eir_type === "gate_out" && (
            <div className="space-y-2">
              <Label>Release Purpose</Label>
              <Select value={form.release_purpose || ""} onValueChange={(v) => set("release_purpose", v)}>
                <SelectTrigger><SelectValue placeholder="Select purpose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sold_unit">Sold Unit</SelectItem>
                  <SelectItem value="lease_unit">Lease Unit</SelectItem>
                  <SelectItem value="repositioning">Repositioning</SelectItem>
                  <SelectItem value="repair">Repair</SelectItem>
                  <SelectItem value="repatriation">Repatriation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {record.eir_type === "gate_out" && form.release_purpose === "repatriation" && (
            <div className="space-y-2">
              <Label>Nominated Depot <span className="text-destructive">*</span></Label>
              <Input
                value={form.nominated_depot}
                onChange={(e) => set("nominated_depot", e.target.value)}
                placeholder="Destination depot / port for repatriation"
              />
            </div>
          )}

          <div className="rounded-md border p-3 space-y-3 bg-muted/20">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transport Details (required for print)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Truck Plate *</Label><Input value={form.truck_plate} onChange={(e) => set("truck_plate", e.target.value.toUpperCase())} /></div>
              <div className="space-y-1"><Label className="text-xs">Driver Name *</Label><Input value={form.driver_name} onChange={(e) => set("driver_name", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Driver Phone</Label><Input value={form.driver_phone} onChange={(e) => set("driver_phone", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Transporter Company</Label><Input value={form.transporter_company} onChange={(e) => set("transporter_company", e.target.value)} /></div>
            </div>
            {record.eir_type === "gate_out" && (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!form.transporter_indemnity_signed}
                  onChange={(e) => set("transporter_indemnity_signed", e.target.checked)}
                />
                <span>
                  <strong>Transporter Indemnity:</strong> the named transporter accepts full liability for any damage
                  or loss occurring in transit between this depot and the delivery point.
                </span>
              </label>
            )}
            {form.transporter_indemnity_signed && (
              <div className="space-y-1"><Label className="text-xs">Signed by (name)</Label><Input value={form.transporter_indemnity_signer} onChange={(e) => set("transporter_indemnity_signer", e.target.value)} placeholder="Driver / transporter representative" /></div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Damage Description</Label>
            <Textarea value={form.damage_description} onChange={(e) => set("damage_description", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Inspector Notes</Label>
            <Textarea value={form.inspector_notes} onChange={(e) => set("inspector_notes", e.target.value)} />
          </div>
          <ApprovalTimeline docType="eir" docId={record.id} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EIRRecords() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [deleteRecord, setDeleteRecord] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<EirTemplateType>("standard");
  const [shareRecord, setShareRecord] = useState<any>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]); // storage paths
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]); // short-lived signed URLs for preview
  const [selectedBuyerId, setSelectedBuyerId] = useState<string>("");
  const [selectedLeaseUnitId, setSelectedLeaseUnitId] = useState<string>("");
  const [selectedLeaseAgreementId, setSelectedLeaseAgreementId] = useState<string>("");
  const [selectedLeaseInvoiceId, setSelectedLeaseInvoiceId] = useState<string>("");
  const { currency: orgCurrency } = useOrgCurrency();
  const [gateInFee, setGateInFee] = useState<{ charge: boolean; amount: string; currency: string; customer: string }>({ charge: false, amount: "", currency: "", customer: "" });
  const [transportCharge, setTransportCharge] = useState<{ charge: boolean; amount: string; currency: string; customer: string }>({ charge: false, amount: "", currency: "", customer: "" });
  const [containerMode, setContainerMode] = useState<"existing" | "new">("existing");
  const [newContainer, setNewContainer] = useState<any>({
    container_number: "", size: "20", category: "dry", height_class: "", iso_type: "",
    owner: "", shipping_line: "", tare_weight_kg: "", weight_kg: "",
  });
  const setNew = (k: string, v: any) => setNewContainer((p: any) => ({ ...p, [k]: v }));
  // Maps EIR id -> buyer chosen at creation time, used when printing this session
  const [eirBuyerMap, setEirBuyerMap] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: records, isLoading } = useQuery({
    queryKey: ["eir-records", search],
    queryFn: async () => {
      let q = supabase
        .from("eir_records")
        .select("*, lease_unit_id, lease_agreement_id, lease_invoice_id, containers(container_number, size, iso_type, category, owner, shipping_line, tare_weight_kg, weight_kg, is_empty, status), gate_appointments(appointment_number, shipping_line, truck_plate, driver_name, driver_license), invoices:invoices!invoices_source_eir_id_fkey(id, invoice_number, status, total_amount, currency)")
        .order("created_at", { ascending: false });
      if (search) q = q.ilike("eir_number", `%${search}%`);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  // Branding follows the header working-depot picker; falls back to org.
  const depot = getPrintDepot();


  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).single();
      return data;
    },
    enabled: !!user?.id,
  });

  const { data: myRole } = useQuery({
    queryKey: ["my-role"],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).limit(1).single();
      return data?.role ?? null;
    },
    enabled: !!user?.id,
  });

  const { data: appointments } = useQuery({
    queryKey: ["appointments-for-eir"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gate_appointments")
        .select("id, appointment_number, container_number, appointment_type")
        .in("status", ["confirmed", "in_progress"])
        .order("scheduled_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: containers } = useQuery({
    queryKey: ["containers-for-eir"],
    queryFn: async () => {
      const { data, error } = await supabase.from("containers").select("id, container_number").order("container_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: buyerCustomers } = useQuery({
    queryKey: ["customers-for-eir-buyer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, company_name, contact_person, phone, email, kra_pin, tax_id, address, customer_type")
        .eq("is_active", true)
        .order("company_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingPhotos(true);
    const paths: string[] = [...photoUrls];
    const previews: string[] = [...photoPreviews];
    for (const file of Array.from(files)) {
      try {
        const path = await uploadContainerPhoto(file, "eir");
        paths.push(path);
        const signed = await signContainerPhoto(path);
        if (signed) previews.push(signed);
      } catch (e: any) {
        toast({ title: "Upload failed", description: e?.message ?? "Upload failed", variant: "destructive" });
      }
    }
    setPhotoUrls(paths);
    setPhotoPreviews(previews);
    setUploadingPhotos(false);
  };

  const createEir = useMutation({
    mutationFn: async (form: any) => {
      let resolvedContainerId: string | undefined = form.container_id || undefined;
      let createdNewContainer = false;
      let createdContainerNumber = "";

      // Gate-in: ensure container exists in inventory (create or refresh)
      if (form.eir_type === "gate_in") {
        if (containerMode === "new" && !newContainer.container_number?.trim()) {
          throw new Error("Container number is required for a new arrival");
        }
        if (containerMode === "new" && requiresHeightClass(newContainer.category) && !newContainer.height_class) {
          throw new Error("Height class (HC or LC) is required for dry containers");
        }
        const rpcPayload: any = {
          container_id: containerMode === "existing" ? (form.container_id || null) : null,
          cargo_status: form.cargo_status,
        };
        if (containerMode === "new") {
          createdContainerNumber = newContainer.container_number.trim().toUpperCase();
          rpcPayload.container_number = createdContainerNumber;
          rpcPayload.size = newContainer.size;
          rpcPayload.category = newContainer.category;
          rpcPayload.height_class = requiresHeightClass(newContainer.category) ? newContainer.height_class : null;
          rpcPayload.iso_type = newContainer.iso_type;
          rpcPayload.owner = newContainer.owner;
          rpcPayload.shipping_line = newContainer.shipping_line;
          rpcPayload.tare_weight_kg = newContainer.tare_weight_kg;
          rpcPayload.weight_kg = newContainer.weight_kg;
        }
        if (containerMode === "new" || form.container_id) {
          const { data: cid, error: cerr } = await supabase.rpc("gate_in_upsert_container" as any, { _payload: rpcPayload });
          if (cerr) throw cerr;
          if (cid) {
            createdNewContainer = containerMode === "new" && !form.container_id;
            resolvedContainerId = cid as unknown as string;
          }
        }
      }

      // Condition photos are optional but recommended

      // Ownership transfer: the attached customer IS the new owner. Freeze both
      // sides of the transfer on the EIR so re-prints never lose the buyer.
      let ownerAtIssue: string | null = null;
      let newOwnerName: string | null = null;
      const transferPurpose = form.eir_type === "gate_out"
        && (form.release_purpose === "sold_unit" || form.release_purpose === "lease_unit");
      if (transferPurpose && selectedBuyerId && resolvedContainerId) {
        const buyerRec = buyerCustomers?.find((b) => b.id === selectedBuyerId);
        const { data: curr } = await supabase.from("containers")
          .select("owner").eq("id", resolvedContainerId).maybeSingle();
        ownerAtIssue = ((curr as any)?.owner as string) || null;
        newOwnerName = buyerRec?.company_name ?? null;
      }

      const payload = {
        ...form,
        ...(newOwnerName
          ? { owner_at_issue: ownerAtIssue, new_owner: newOwnerName, owner_source: "eir_buyer_selection" }
          : {}),

        container_id: resolvedContainerId,
        eir_number: await generateEirNumber("EIR"),
        inspected_by: user?.id,
        completed_at: new Date().toISOString(),
        photos: photoUrls.length ? photoUrls : [],
        released_by_name: profile?.display_name ?? user?.email ?? "",
        released_by_role: myRole ?? "",
        truck_plate: form.truck_plate || null,
        driver_name: form.driver_name || null,
        driver_phone: form.driver_phone || null,
        transporter_company: form.transporter_company || null,
        origin_location: form.origin_location || null,
        nominated_depot: form.nominated_depot || null,
        transporter_indemnity_signed: !!form.transporter_indemnity_signed,
        transporter_indemnity_signer: form.transporter_indemnity_signed ? (form.transporter_indemnity_signer || null) : null,
        transporter_indemnity_signed_at: form.transporter_indemnity_signed ? new Date().toISOString() : null,
      };
      if (!payload.appointment_id) delete payload.appointment_id;
      if (!payload.container_id) delete payload.container_id;
      if (!payload.release_purpose) delete payload.release_purpose;
      if (selectedLeaseUnitId) payload.lease_unit_id = selectedLeaseUnitId;
      if (selectedLeaseAgreementId) payload.lease_agreement_id = selectedLeaseAgreementId;
      if (selectedLeaseInvoiceId) payload.lease_invoice_id = selectedLeaseInvoiceId;
      const { data: inserted, error } = await supabase.from("eir_records").insert(payload).select("id").single();
      if (error) throw error;

      if (form.appointment_id) {
        await supabase.from("gate_appointments").update({ status: "completed" as any }).eq("id", form.appointment_id);
      }

      // Gate-out: sync inventory status (sold / on_lease / in_transit) and stamp gate_out_at
      let gateOutStatus: string | null = null;
      if (form.eir_type === "gate_out" && resolvedContainerId) {
        const goPayload: any = {
          container_id: resolvedContainerId,
          release_purpose: form.release_purpose || null,
          cargo_status: form.cargo_status,
        };
        const { error: goErr } = await supabase.rpc("gate_out_upsert_container" as any, { _payload: goPayload });
        if (goErr) throw goErr;
        gateOutStatus = form.release_purpose === "sold_unit" ? "sold"
                      : form.release_purpose === "lease_unit" ? "on_lease"
                      : (form.release_purpose === "repositioning" || form.release_purpose === "repair") ? "in_transit"
                      : null;

        // Auto-generate acquisition PO to original owner for ad-hoc gate-out sales.
        // Split children already inherit their apportioned acquisition cost from the
        // mother container, so they must never create a second supplier liability.
        if (form.release_purpose === "sold_unit") {
          const { data: c } = await supabase.from("containers")
            .select("acquisition_cost, owner, parent_container_id")
            .eq("id", resolvedContainerId).maybeSingle();
          const amt = Number((c as any)?.acquisition_cost || 0);
          const isSplitChild = !!(c as any)?.parent_container_id;
          if (amt > 0 && !isSplitChild) {
            await acquireContainerFromOwner({
              containerId: resolvedContainerId,
              amount: amt,
              currency: getDefaultCurrency(),
              reason: "gate_out_sale",
              reference: payload.eir_number,
            });
          }
          // Inventory owner follows the sale: the attached customer becomes the owner.
          if (newOwnerName) {
            await supabase.rpc("correct_container_owner" as any, {
              _container_id: resolvedContainerId,
              _new_owner: newOwnerName,
              _reason: `gate_out_sale ${payload.eir_number}`,
            });
          }
        }
      }



      // Optional gate-in fee billing
      let billed = false;
      let transportBilled = false;
      if (form.eir_type === "gate_in" && gateInFee.charge && resolvedContainerId && gateInFee.amount && gateInFee.customer.trim()) {
        const amt = parseFloat(gateInFee.amount);
        if (amt > 0) {
          const { error: billErr } = await supabase.rpc("bill_gate_in" as any, {
            _container_id: resolvedContainerId,
            _customer_name: gateInFee.customer.trim(),
            _amount: amt,
            _currency: gateInFee.currency || orgCurrency || null,
            _source_eir_id: inserted?.id,
          });
          if (billErr) throw billErr;
          billed = true;
        }
      }
      // Optional inbound transport charge billing
      if (form.eir_type === "gate_in" && transportCharge.charge && resolvedContainerId && transportCharge.amount && transportCharge.customer.trim()) {
        const amt = parseFloat(transportCharge.amount);
        if (amt > 0) {
          const { error: trErr } = await supabase.rpc("bill_gate_in" as any, {
            _container_id: resolvedContainerId,
            _customer_name: transportCharge.customer.trim(),
            _amount: amt,
            _currency: transportCharge.currency || orgCurrency || null,
            _source_eir_id: inserted?.id,
            _kind: "inbound_transport",
          });
          if (trErr) throw trErr;
          transportBilled = true;
        }
      }
      return { id: inserted?.id, buyerId: selectedBuyerId, billed, transportBilled, createdNewContainer, createdContainerNumber, gateOutStatus };
    },
    onSuccess: (result) => {
      if (result?.id && result.buyerId) {
        setEirBuyerMap((m) => ({ ...m, [result.id!]: result.buyerId! }));
      }
      queryClient.invalidateQueries({ queryKey: ["eir-records"] });
      queryClient.invalidateQueries({ queryKey: ["gate-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["appointments-for-eir"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      queryClient.invalidateQueries({ queryKey: ["containers-for-eir"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-transactions"] });
      const parts = ["EIR generated"];
      if (result?.createdNewContainer && result.createdContainerNumber) parts.push(`Container ${result.createdContainerNumber} added to inventory`);
      if (result?.gateOutStatus) {
        const label = result.gateOutStatus === "sold" ? "Sold"
                    : result.gateOutStatus === "on_lease" ? "On Lease"
                    : "In Transit";
        parts.push(`inventory marked ${label}`);
      }
      if (result?.billed) parts.push("gate-in fee invoiced");
      if (result?.transportBilled) parts.push("transport charge invoiced to owner");
      toast({ title: parts.join(" · ") });
      setGateInFee({ charge: false, amount: "", currency: "", customer: "" });
      setTransportCharge({ charge: false, amount: "", currency: "", customer: "" });
      setDialogOpen(false);
      setPhotoUrls([]); setPhotoPreviews([]);
      setSelectedBuyerId("");
      setSelectedLeaseUnitId("");
      setSelectedLeaseAgreementId("");
      setSelectedLeaseInvoiceId("");
      setContainerMode("existing");
      setNewContainer({ container_number: "", size: "20", category: "dry", height_class: "", iso_type: "", owner: "", shipping_line: "", tare_weight_kg: "", weight_kg: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [form, setForm] = useState<any>({
    appointment_id: "",
    container_id: "",
    eir_type: "gate_in",
    condition_grade: "A",
    damage_description: "",
    cargo_status: "empty",
    seal_number: "",
    inspector_notes: "",
    release_purpose: "",
    truck_plate: "",
    driver_name: "",
    driver_phone: "",
    transporter_company: "",
    origin_location: "",
    nominated_depot: "",
    transporter_indemnity_signed: false,
    transporter_indemnity_signer: "",
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  // Active on-hire lease units for the currently selected container
  const { data: containerLeaseUnits } = useQuery({
    queryKey: ["lease-units-for-container", form.container_id],
    queryFn: async () => {
      if (!form.container_id) return [];
      const { data, error } = await supabase
        .from("lease_units")
        .select("id, on_hire_at, effective_per_diem, lease_id, lease_agreements!inner(id, lease_number, lessee_name, status)")
        .eq("container_id", form.container_id)
        .eq("status", "on_hire");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!form.container_id,
  });

  // Recent billing runs for the chosen lease (optional invoice attachment)
  const { data: leaseInvoiceOptions } = useQuery({
    queryKey: ["lease-invoices-for-agreement", selectedLeaseAgreementId],
    queryFn: async () => {
      if (!selectedLeaseAgreementId) return [];
      const { data, error } = await supabase
        .from("lease_invoices_run")
        .select("invoice_id, period_start, period_end, total_amount, invoices(invoice_number, status)")
        .eq("lease_id", selectedLeaseAgreementId)
        .not("invoice_id", "is", null)
        .order("generated_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedLeaseAgreementId,
  });

  // Auto-prefill when exactly one on-hire lease unit matches the container
  useEffect(() => {
    if (!form.container_id) return;
    const units = containerLeaseUnits ?? [];
    if (units.length === 1) {
      const u: any = units[0];
      setSelectedLeaseUnitId(u.id);
      setSelectedLeaseAgreementId(u.lease_id ?? u.lease_agreements?.id ?? "");
    }
  }, [containerLeaseUnits, form.container_id]);

  // Auto-prefill gate-in fee + transport charge customer when eir_type=gate_in & container chosen
  useEffect(() => {
    if (form.eir_type !== "gate_in" || !form.container_id) return;
    (async () => {
      const [{ data: feeData }, { data: cont }] = await Promise.all([
        supabase.rpc("lookup_gate_in_fee", { _container_id: form.container_id }),
        supabase.from("containers").select("shipping_line, owner").eq("id", form.container_id).maybeSingle(),
      ]);
      const row: any = Array.isArray(feeData) ? feeData[0] : feeData;
      const amt = row?.amount ? Number(row.amount) : 0;
      const cur = row?.currency || orgCurrency || "";
      const feeCustomer = (cont as any)?.shipping_line || (cont as any)?.owner || "";
      const ownerCustomer = (cont as any)?.owner || (cont as any)?.shipping_line || "";
      setGateInFee((prev) => ({
        charge: amt > 0 && !!feeCustomer,
        amount: amt > 0 ? String(amt) : "",
        currency: cur,
        customer: prev.customer || feeCustomer,
      }));
      setTransportCharge((prev) => ({
        ...prev,
        currency: prev.currency || orgCurrency || "",
        customer: prev.customer || ownerCustomer,
      }));
    })();
  }, [form.eir_type, form.container_id, orgCurrency]);

  const handleAppointmentSelect = (aptId: string) => {
    const apt = appointments?.find((a) => a.id === aptId);
    if (apt) {
      set("appointment_id", aptId);
      set("eir_type", apt.appointment_type as string);
      const c = containers?.find((c) => c.container_number === apt.container_number);
      if (c) {
        setContainerMode("existing");
        set("container_id", c.id);
        setSelectedLeaseUnitId("");
        setSelectedLeaseAgreementId("");
        setSelectedLeaseInvoiceId("");
      } else if (apt.container_number && apt.appointment_type === "gate_in") {
        // New arrival — prefill the inline new-container form
        setContainerMode("new");
        set("container_id", "");
        setNewContainer((p: any) => ({ ...p, container_number: apt.container_number }));
      }
    }
  };

  const handlePrintEir = async (r: any) => {
    const rawPhotos: string[] = Array.isArray(r.photos) ? r.photos.filter((p: any) => typeof p === "string") : [];
    const photos = rawPhotos.length ? await signContainerPhotos(rawPhotos) : [];


    // Try to derive buyer from any linked container_sale (auth-time) or session-mapped buyer (session-time)
    let buyer: EirPrintData["buyer"] = null;
    if (r.release_purpose === "sold_unit" || r.release_purpose === "lease_unit") {
      // Look up linked container_sale by eir_id (set by ContainerSales.markSold)
      const { data: linkedSale } = await supabase
        .from("container_sales")
        .select("buyer_name, buyer_contact, original_owner")
        .eq("eir_id", r.id)
        .maybeSingle();
      if (linkedSale?.buyer_name) {
        buyer = {
          label: r.release_purpose === "lease_unit" ? "Lessee" : "Buyer",
          name: r.new_owner || linkedSale.buyer_name,
          contact: linkedSale.buyer_contact,
          // Ownership is resolved and frozen on the EIR record itself.
          original_owner: r.owner_at_issue || linkedSale.original_owner,
        };
      }
      // Fall back to session-selected buyer (from this run's "Generate EIR" flow)
      const sessionBuyerId = eirBuyerMap[r.id];
      if (!buyer && sessionBuyerId) {
        const c = buyerCustomers?.find((b) => b.id === sessionBuyerId);
        if (c) {
          buyer = {
            label: r.release_purpose === "lease_unit" ? "Lessee" : "Buyer",
            name: r.new_owner || c.company_name,
            contact: c.phone || c.email,
            kra_pin: c.kra_pin,
            tax_id: c.tax_id,
            address: c.address,
            original_owner: r.owner_at_issue ?? null,
          };
        }
      }
      if (!buyer && r.new_owner) {
        // Persisted on the EIR at creation: the attached customer is the new owner.
        const c = buyerCustomers?.find(
          (b) => (b.company_name ?? "").trim().toLowerCase() === String(r.new_owner).trim().toLowerCase()
        );
        buyer = {
          label: r.release_purpose === "lease_unit" ? "Lessee" : "Buyer",
          name: r.new_owner,
          contact: c ? (c.phone || c.email) : undefined,
          kra_pin: c?.kra_pin ?? undefined,
          tax_id: c?.tax_id ?? undefined,
          address: c?.address ?? undefined,
          original_owner: r.owner_at_issue ?? null,
        };
      }

    }

    if (buyer) buyer.acquisition_supplier = r.acquisition_supplier ?? null;

    // Fetch lease context if EIR has a lease unit linked
    let lease: EirPrintData["lease"] = null;
    if (r.lease_unit_id) {
      const { data: leaseRow } = await supabase
        .from("lease_units")
        .select("on_hire_at, effective_per_diem, lease_agreements!inner(lease_number, lessee_name, lease_type, currency, default_per_diem, free_days_pickup, free_days_redelivery, status)")
        .eq("id", r.lease_unit_id)
        .maybeSingle();
      let invoiceRow: any = null;
      if (r.lease_invoice_id) {
        const { data } = await supabase
          .from("invoices")
          .select("invoice_number, status, total_amount")
          .eq("id", r.lease_invoice_id)
          .maybeSingle();
        invoiceRow = data;
      }
      if (leaseRow && (leaseRow as any).lease_agreements) {
        const la: any = (leaseRow as any).lease_agreements;
        lease = {
          lease_number: la.lease_number,
          lessee_name: la.lessee_name,
          lease_type: la.lease_type,
          currency: la.currency,
          per_diem: (leaseRow as any).effective_per_diem ?? la.default_per_diem,
          free_days_pickup: la.free_days_pickup,
          free_days_redelivery: la.free_days_redelivery,
          on_hire_at: (leaseRow as any).on_hire_at,
          status: la.status,
          invoice_number: invoiceRow?.invoice_number ?? null,
          invoice_status: invoiceRow?.status ?? null,
          invoice_total: invoiceRow?.total_amount ?? null,
        };
      }
    }

    const printData: EirPrintData = {
      eir_number: r.eir_number,
      eir_type: r.eir_type,
      completed_at: r.completed_at,
      created_at: r.created_at,
      condition_grade: r.condition_grade,
      cargo_status: r.cargo_status,
      seal_number: r.seal_number,
      damage_description: r.damage_description,
      inspector_notes: r.inspector_notes,
      release_purpose: r.release_purpose,
      released_by_name: r.released_by_name,
      released_by_role: r.released_by_role,
      truck_plate: r.truck_plate ?? null,
      driver_name: r.driver_name ?? null,
      driver_phone: r.driver_phone ?? null,
      transporter_company: r.transporter_company ?? null,
      origin_location: r.origin_location ?? null,
      nominated_depot: r.nominated_depot ?? null,
      transporter_indemnity_signed: r.transporter_indemnity_signed ?? null,
      transporter_indemnity_signer: r.transporter_indemnity_signer ?? null,
      transporter_indemnity_signed_at: r.transporter_indemnity_signed_at ?? null,
      photos,
      // Owner shown on the document is the one frozen on the EIR at issue time
      // (the depot itself once a purchase invoice exists for the unit).
      container: r.containers ? { ...r.containers, owner: r.owner_at_issue || r.containers.owner } : null,
      appointment: r.gate_appointments ?? null,
      depot: depot ?? null,
      buyer,
      lease,
      owner_at_issue: r.owner_at_issue ?? null,
      new_owner: r.new_owner ?? null,
      acquisition_supplier: r.acquisition_supplier ?? null,
      purchase_price_snapshot: r.purchase_price_snapshot ?? null,
      reference_rate: r.reference_rate ?? null,
      purchase_currency: r.purchase_price_currency ?? null,
      fx_rate_snapshot: r.fx_rate_snapshot ?? null,
      gate_fee_amount: r.gate_fee_amount ?? null,
      gate_fee_currency: r.gate_fee_currency ?? null,
      approval_status: r.approval_status ?? null,
    };
    await generateEirPrint(printData, selectedTemplate);
  };

  const printEir = async (r: any) => {
    try {
      await handlePrintEir(r);
    } catch (e: any) {
      toast({
        title: "Cannot print EIR",
        description: e?.message ?? "Something went wrong while generating the EIR.",
        variant: "destructive",
      });
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Equipment Interchange Receipts</h1>
          <p className="text-muted-foreground">{records?.length ?? 0} EIR records</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/docs/EIR_API_Documentation.pdf" download target="_blank" rel="noopener noreferrer">
              <FileText className="mr-1 h-4 w-4" />API Docs (PDF)
            </a>
          </Button>
          <Select value={selectedTemplate} onValueChange={(v) => setSelectedTemplate(v as EirTemplateType)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(templateLabels) as [EirTemplateType, string][]).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" type="button" title="Template formats" aria-label="Template formats">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs space-y-1">
                {(Object.entries(templateDescriptions) as [EirTemplateType, string][]).map(([k, desc]) => (
                  <div key={k}><span className="font-semibold">{templateLabels[k]}:</span> {desc}</div>
                ))}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setPhotoUrls([]); setPhotoPreviews([]); setSelectedBuyerId(""); setSelectedLeaseUnitId(""); setSelectedLeaseAgreementId(""); setSelectedLeaseInvoiceId(""); } }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" />Generate EIR</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Generate Equipment Interchange Receipt</DialogTitle></DialogHeader>
              <form
                onSubmit={(e) => { e.preventDefault(); createEir.mutate(form); }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Link to Appointment</Label>
                  <Select onValueChange={handleAppointmentSelect}>
                    <SelectTrigger><SelectValue placeholder="Select active appointment" /></SelectTrigger>
                    <SelectContent>
                      {appointments?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.appointment_number} — {a.container_number ?? "No container"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>EIR Type</Label>
                    <Select value={form.eir_type} onValueChange={(v) => set("eir_type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gate_in">Gate In</SelectItem>
                        <SelectItem value="gate_out">Gate Out</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Container</Label>
                    {form.eir_type === "gate_in" ? (
                      <div className="flex gap-1 rounded-md border p-0.5 bg-muted/30">
                        <button type="button" onClick={() => { setContainerMode("existing"); }}
                          className={`flex-1 text-xs py-1.5 rounded ${containerMode === "existing" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>
                          Existing
                        </button>
                        <button type="button" onClick={() => { setContainerMode("new"); set("container_id", ""); }}
                          className={`flex-1 text-xs py-1.5 rounded ${containerMode === "new" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>
                          New arrival
                        </button>
                      </div>
                    ) : null}
                    {(form.eir_type !== "gate_in" || containerMode === "existing") && (
                      <Select value={form.container_id} onValueChange={(v) => { set("container_id", v); setSelectedLeaseUnitId(""); setSelectedLeaseAgreementId(""); setSelectedLeaseInvoiceId(""); }}>
                        <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                        <SelectContent>
                          {containers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.container_number}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                {form.eir_type === "gate_in" && containerMode === "new" && (
                  <div className="space-y-3 border rounded-md p-3 bg-muted/30">
                    <p className="text-xs text-muted-foreground">This container will be added to inventory on EIR generation.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Container Number *</Label>
                        <Input className="font-mono" placeholder="MSCU1234567"
                          value={newContainer.container_number}
                          onChange={(e) => setNew("container_number", e.target.value.toUpperCase())} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">ISO Type</Label>
                        <Input value={newContainer.iso_type} onChange={(e) => setNew("iso_type", e.target.value)} placeholder="22G1" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Size</Label>
                        <Select value={newContainer.size} onValueChange={(v) => setNew("size", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["10","20","30","40","45"].map((s) => <SelectItem key={s} value={s}>{s} ft</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Category</Label>
                        <Select value={newContainer.category} onValueChange={(v) => setNew("category", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["dry","reefer","open_top","flat_rack","tank","other"].map((s) =>
                              <SelectItem key={s} value={s} className="capitalize">{s.replace("_"," ")}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {requiresHeightClass(newContainer.category) && (
                        <div className="space-y-1">
                          <Label className="text-xs">Height Class *</Label>
                          <Select value={newContainer.height_class} onValueChange={(v) => setNew("height_class", v)}>
                            <SelectTrigger><SelectValue placeholder="Select HC or LC" /></SelectTrigger>
                            <SelectContent>
                              {HEIGHT_CLASSES.map((h) => (
                                <SelectItem key={h} value={h}>{HEIGHT_CLASS_LABELS[h]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">Owner</Label>
                        <Input value={newContainer.owner} onChange={(e) => setNew("owner", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Shipping Line</Label>
                        <Input value={newContainer.shipping_line} onChange={(e) => setNew("shipping_line", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Tare Weight (kg)</Label>
                        <Input type="number" value={newContainer.tare_weight_kg} onChange={(e) => setNew("tare_weight_kg", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Gross Weight (kg)</Label>
                        <Input type="number" value={newContainer.weight_kg} onChange={(e) => setNew("weight_kg", e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Condition Grade</Label>
                    <Select value={form.condition_grade} onValueChange={(v) => set("condition_grade", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A">A — Excellent</SelectItem>
                        <SelectItem value="B">B — Good</SelectItem>
                        <SelectItem value="C">C — Fair</SelectItem>
                        <SelectItem value="D">D — Poor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Cargo Status</Label>
                    <Select value={form.cargo_status} onValueChange={(v) => set("cargo_status", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="empty">Empty</SelectItem>
                        <SelectItem value="laden">Laden</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Seal Number</Label>
                    <Input value={form.seal_number} onChange={(e) => set("seal_number", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Release Purpose</Label>
                  <Select value={form.release_purpose} onValueChange={(v) => set("release_purpose", v)}>
                    <SelectTrigger><SelectValue placeholder="Select purpose (optional)" /></SelectTrigger>
                    <SelectContent>
                      {form.eir_type === "gate_in" && (
                        <SelectItem value="gate_in_arrival">Gate-In Arrival (from another depot / port)</SelectItem>
                      )}
                      <SelectItem value="sold_unit">Sold Unit</SelectItem>
                      <SelectItem value="lease_unit">Lease Unit</SelectItem>
                      <SelectItem value="repositioning">Repositioning</SelectItem>
                      <SelectItem value="repair">Repair Return</SelectItem>
                      {form.eir_type === "gate_out" && (
                        <SelectItem value="repatriation">Repatriation (gate-out to nominated depot)</SelectItem>
                      )}
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.eir_type === "gate_in" && form.release_purpose === "gate_in_arrival" && (
                  <div className="space-y-2">
                    <Label>Arrived From <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.origin_location}
                      onChange={(e) => set("origin_location", e.target.value)}
                      placeholder="Remitting depot / port of arrival"
                      required
                    />
                  </div>
                )}
                {form.eir_type === "gate_out" && form.release_purpose === "repatriation" && (
                  <div className="space-y-2">
                    <Label>Nominated Depot <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.nominated_depot}
                      onChange={(e) => set("nominated_depot", e.target.value)}
                      placeholder="Destination depot / port for repatriation"
                      required
                    />
                  </div>
                )}

                <div className="rounded-md border p-3 space-y-3 bg-muted/20">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transport Details (required to print EIR)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1"><Label className="text-xs">Truck Plate *</Label><Input value={form.truck_plate} onChange={(e) => set("truck_plate", e.target.value.toUpperCase())} required /></div>
                    <div className="space-y-1"><Label className="text-xs">Driver Name *</Label><Input value={form.driver_name} onChange={(e) => set("driver_name", e.target.value)} required /></div>
                    <div className="space-y-1"><Label className="text-xs">Driver Phone</Label><Input value={form.driver_phone} onChange={(e) => set("driver_phone", e.target.value)} /></div>
                    <div className="space-y-1"><Label className="text-xs">Transporter Company</Label><Input value={form.transporter_company} onChange={(e) => set("transporter_company", e.target.value)} /></div>
                  </div>
                  {form.eir_type === "gate_out" && (
                    <>
                      <label className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={!!form.transporter_indemnity_signed}
                          onChange={(e) => set("transporter_indemnity_signed", e.target.checked)}
                        />
                        <span>
                          <strong>Transporter Indemnity (required for gate-out):</strong> the named transporter accepts
                          full liability for any damage or loss occurring in transit between this depot and the delivery point.
                        </span>
                      </label>
                      {form.transporter_indemnity_signed && (
                        <div className="space-y-1">
                          <Label className="text-xs">Signed by (name) *</Label>
                          <Input value={form.transporter_indemnity_signer} onChange={(e) => set("transporter_indemnity_signer", e.target.value)} placeholder="Driver / transporter representative" required />
                        </div>
                      )}
                    </>
                  )}
                </div>
                {(form.release_purpose === "sold_unit" || form.release_purpose === "lease_unit") && (
                  <div className="space-y-2">
                    <Label>{form.release_purpose === "lease_unit" ? "Lessee" : "Buyer"} / Consignee (optional)</Label>
                    <Select value={selectedBuyerId} onValueChange={setSelectedBuyerId}>
                      <SelectTrigger>
                        <SelectValue placeholder={`Select ${form.release_purpose === "lease_unit" ? "lessee" : "buyer"} from registry`} />
                      </SelectTrigger>
                      <SelectContent>
                        {(buyerCustomers ?? [])
                          .filter((c) =>
                            form.release_purpose === "sold_unit"
                              ? c.customer_type === "buyer"
                              : true
                          )
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.company_name} {c.contact_person ? `— ${c.contact_person}` : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Will appear on the printed EIR receipt.</p>
                  </div>
                )}
                {(containerLeaseUnits?.length ?? 0) > 0 && (form.eir_type === "gate_out" || form.release_purpose === "lease_unit") && (
                  <div className="space-y-2 border rounded p-3 bg-muted/30">
                    <Label className="text-sm font-semibold">Lease Context</Label>
                    <p className="text-xs text-muted-foreground">
                      {containerLeaseUnits!.length === 1
                        ? "Active lease auto-detected for this container."
                        : `${containerLeaseUnits!.length} active leases — select one.`}
                    </p>
                    <Select
                      value={selectedLeaseUnitId}
                      onValueChange={(v) => {
                        setSelectedLeaseUnitId(v);
                        const u: any = containerLeaseUnits!.find((x: any) => x.id === v);
                        setSelectedLeaseAgreementId(u?.lease_id ?? u?.lease_agreements?.id ?? "");
                        setSelectedLeaseInvoiceId("");
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select lease unit" /></SelectTrigger>
                      <SelectContent>
                        {containerLeaseUnits!.map((u: any) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.lease_agreements?.lease_number} — {u.lease_agreements?.lessee_name}
                            {u.on_hire_at ? ` (on-hired ${format(new Date(u.on_hire_at), "PP")})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedLeaseAgreementId && (leaseInvoiceOptions?.length ?? 0) > 0 && (
                      <div className="space-y-1">
                        <Label className="text-xs">Linked Invoice (optional)</Label>
                        <Select value={selectedLeaseInvoiceId || "none"} onValueChange={(v) => setSelectedLeaseInvoiceId(v === "none" ? "" : v)}>
                          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {leaseInvoiceOptions!.map((r: any) => (
                              <SelectItem key={r.invoice_id} value={r.invoice_id}>
                                {r.invoices?.invoice_number ?? "Invoice"} — {format(new Date(r.period_start), "PP")} → {format(new Date(r.period_end), "PP")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Damage Description</Label>
                  <Textarea value={form.damage_description} onChange={(e) => set("damage_description", e.target.value)} placeholder="Describe any damage found..." />
                </div>
                <div className="space-y-2">
                  <Label>Inspector Notes</Label>
                  <Textarea value={form.inspector_notes} onChange={(e) => set("inspector_notes", e.target.value)} />
                </div>

                {/* Photo Upload */}
                <div className="space-y-2">
                  <Label>Condition Photos {form.eir_type === "gate_in" && <span className="text-destructive">*</span>}</Label>
                  {form.eir_type === "gate_in" && (
                    <p className="text-xs text-muted-foreground">Photos are optional but recommended as proof of condition.</p>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoUpload(e.target.files)} />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhotos}>
                      <Upload className="mr-1 h-4 w-4" />{uploadingPhotos ? "Uploading..." : "Upload Photos"}
                    </Button>
                    <span className="text-xs text-muted-foreground">{photoUrls.length} photo(s)</span>
                  </div>
                  {photoPreviews.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {photoPreviews.map((url, i) => (
                        <img key={i} src={url} className="w-16 h-12 object-cover rounded border" alt={`Photo ${i + 1}`} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/30">
                  <strong>Issued by:</strong> {profile?.display_name ?? user?.email ?? "—"} ({myRole ?? "—"})
                </div>


                {form.eir_type === "gate_in" && form.container_id && (
                  <div className="space-y-3 rounded-md border p-3 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Checkbox id="eir_charge_fee" checked={gateInFee.charge} onCheckedChange={(v) => setGateInFee((p) => ({ ...p, charge: !!v }))} />
                      <Label htmlFor="eir_charge_fee" className="font-medium cursor-pointer">Charge gate-in fee</Label>
                    </div>
                    {gateInFee.charge && (
                      <>
                        <div className="space-y-2">
                          <Label>Bill to (shipping line / owner)</Label>
                          <Input value={gateInFee.customer} onChange={(e) => setGateInFee((p) => ({ ...p, customer: e.target.value }))} placeholder="Customer name" required />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label>Amount</Label>
                            <Input type="number" step="0.01" min="0" value={gateInFee.amount} onChange={(e) => setGateInFee((p) => ({ ...p, amount: e.target.value }))} required />
                          </div>
                          <div className="space-y-2">
                            <Label>Currency</Label>
                            <Input value={gateInFee.currency} onChange={(e) => setGateInFee((p) => ({ ...p, currency: e.target.value }))} />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">A draft invoice will be created on the customer.</p>
                      </>
                    )}
                  </div>
                )}

                {form.eir_type === "gate_in" && (form.container_id || (containerMode === "new" && newContainer.container_number)) && (
                  <div className="space-y-3 rounded-md border p-3 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Checkbox id="eir_charge_transport" checked={transportCharge.charge} onCheckedChange={(v) => setTransportCharge((p) => ({ ...p, charge: !!v, currency: p.currency || orgCurrency || "", customer: p.customer || newContainer.owner || "" }))} />
                      <Label htmlFor="eir_charge_transport" className="font-medium cursor-pointer">Charge inbound transport (to owner)</Label>
                    </div>
                    {transportCharge.charge && (
                      <>
                        <div className="space-y-2">
                          <Label>Bill to (container owner)</Label>
                          <Input value={transportCharge.customer} onChange={(e) => setTransportCharge((p) => ({ ...p, customer: e.target.value }))} placeholder="Owner / line name" required />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label>Amount</Label>
                            <Input type="number" step="0.01" min="0" value={transportCharge.amount} onChange={(e) => setTransportCharge((p) => ({ ...p, amount: e.target.value }))} required />
                          </div>
                          <div className="space-y-2">
                            <Label>Currency</Label>
                            <Input value={transportCharge.currency} onChange={(e) => setTransportCharge((p) => ({ ...p, currency: e.target.value }))} placeholder={orgCurrency || ""} />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">A draft transport invoice will be created on the owner.</p>
                      </>
                    )}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={createEir.isPending}>Generate EIR</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search EIR number..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>EIR #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Release</TableHead>
                <TableHead>Gate Fee</TableHead>
                <TableHead>Owner approval</TableHead>
                <TableHead>Photos</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton columns={11} />
              ) : !records?.length ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No EIR records</TableCell></TableRow>
              ) : (
                records.map((r: any) => {
                  const photoCount = Array.isArray(r.photos) ? r.photos.filter((p: any) => typeof p === "string" && p.length > 0).length : 0;
                  const inv = Array.isArray(r.invoices) ? r.invoices[0] : r.invoices;
                  const tone =
                    !inv ? "bg-muted text-muted-foreground" :
                    inv.status === "paid" ? "bg-success/15 text-success border-success/30" :
                    inv.status === "sent" ? "bg-info/15 text-info border-info/30" :
                    inv.status === "draft" ? "bg-warning/15 text-warning border-warning/30" :
                    "bg-destructive/15 text-destructive border-destructive/30";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm font-medium">{r.eir_number}</TableCell>
                      <TableCell className="capitalize">{r.eir_type.replace("_", " ")}</TableCell>
                      <TableCell className="font-mono text-sm">{r.containers?.container_number ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={gradeColors[r.condition_grade] ?? ""}>
                          {r.condition_grade}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">{r.cargo_status}</TableCell>
                      <TableCell className="text-sm">{r.release_purpose ? r.release_purpose.replace("_", " ") : "—"}</TableCell>
                      <TableCell>
                        {r.eir_type === "gate_in" ? (
                          inv ? (
                            <a href="/billing/invoices" className={`inline-flex px-2 py-0.5 rounded border text-xs capitalize ${tone}`} title={`${inv.invoice_number} — ${inv.currency} ${inv.total_amount}`}>
                              {inv.status === "sent" ? "Issued" : inv.status === "cancelled" ? "Voided" : inv.status === "credited" ? "Refunded" : inv.status}
                            </a>
                          ) : r.gate_fee_amount ? (
                            <span className="text-xs font-mono" title="Fee captured from tariff; invoice pending">
                              {r.gate_fee_currency ?? ""} {Number(r.gate_fee_amount).toLocaleString()}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">Unbilled</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell><EirApprovalCell eir={r} /></TableCell>
                      <TableCell>
                        {photoCount > 0 ? (
                          <Badge variant="secondary" className="gap-1"><ImageIcon className="h-3 w-3" />{photoCount}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "PPp")}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => printEir(r)} title="Print EIR">
                            <Printer className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setShareRecord(r)} title="Share EIR">
                            <Share2 className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditRecord(r)} title="Edit EIR">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {myRole === "admin" && (
                            <Button size="sm" variant="ghost" onClick={() => setDeleteRecord(r)} title="Delete EIR" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ShareDialog record={shareRecord} open={!!shareRecord} onOpenChange={(o) => { if (!o) setShareRecord(null); }} />
      <EditEirDialog
        record={editRecord}
        open={!!editRecord}
        onOpenChange={(o) => { if (!o) setEditRecord(null); }}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["eir-records"] })}
      />
      <AlertDialog open={!!deleteRecord} onOpenChange={(o) => { if (!o) setDeleteRecord(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete EIR {deleteRecord?.eir_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the EIR record. Linked invoices, ledger entries and container status are not reversed automatically. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteRecord) return;
                setDeleting(true);
                const { error } = await supabase.from("eir_records").delete().eq("id", deleteRecord.id);
                setDeleting(false);
                if (error) {
                  toast({ title: "Delete failed", description: error.message, variant: "destructive" });
                  return;
                }
                toast({ title: "EIR deleted" });
                setDeleteRecord(null);
                queryClient.invalidateQueries({ queryKey: ["eir-records"] });
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
