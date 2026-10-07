import { supabase } from "@/integrations/supabase/client";
import { acquireContainerFromOwner } from "@/lib/container-acquisition";
import { recordContainerServiceInvoice } from "@/lib/container-service-costs";
import { getOrgCurrency } from "@/lib/app-settings";

export type ContainerRecordStatus = {
  container_id: string;
  container_number: string;
  has_appointment: boolean;
  has_eir: boolean;
  has_pinv: boolean;
  has_transport_invoice: boolean;
  has_offloading_invoice: boolean;
};

/**
 * Fetch the presence of gate-in appointment, EIR gate-in and purchase
 * supplier-invoice for a set of containers. Used to render "records"
 * badges and to gate the backfill flow.
 */
export async function fetchContainerRecordStatus(
  containers: Array<{ id: string; container_number: string }>,
): Promise<Record<string, ContainerRecordStatus>> {
  const map: Record<string, ContainerRecordStatus> = {};
  if (!containers.length) return map;
  const ids = containers.map((c) => c.id);
  const numbers = containers.map((c) => c.container_number);

  const [appts, eirs, pinvs, svcInvs] = await Promise.all([
    supabase.from("gate_appointments").select("container_number").in("container_number", numbers),
    supabase.from("eir_records").select("container_id").in("container_id", ids).eq("eir_type", "gate_in"),
    supabase
      .from("supplier_invoices")
      .select("reference")
      .eq("reason", "purchase")
      .in("reference", numbers),
    supabase
      .from("supplier_invoices")
      .select("container_id, reason")
      .in("container_id", ids)
      .in("reason", ["acquisition_transport", "acquisition_crane_offloading"]),
  ]);

  const apptSet = new Set((appts.data ?? []).map((r: any) => r.container_number));
  const eirSet = new Set((eirs.data ?? []).map((r: any) => r.container_id));
  const pinvSet = new Set((pinvs.data ?? []).map((r: any) => r.reference));
  const transportSet = new Set(
    (svcInvs.data ?? []).filter((r: any) => r.reason === "acquisition_transport").map((r: any) => r.container_id),
  );
  const offloadSet = new Set(
    (svcInvs.data ?? []).filter((r: any) => r.reason === "acquisition_crane_offloading").map((r: any) => r.container_id),
  );

  for (const c of containers) {
    map[c.id] = {
      container_id: c.id,
      container_number: c.container_number,
      has_appointment: apptSet.has(c.container_number),
      has_eir: eirSet.has(c.id),
      has_pinv: pinvSet.has(c.container_number),
      has_transport_invoice: transportSet.has(c.id),
      has_offloading_invoice: offloadSet.has(c.id),
    };
  }
  return map;
}

export type BackfillInput = {
  container: {
    id: string;
    container_number: string;
    owner?: string | null;
    shipping_line?: string | null;
    ownership_type?: string | null;
    transporter?: string | null;
    truck_registration?: string | null;
    driver_name?: string | null;
    driver_phone?: string | null;
    driver_id_number?: string | null;
    pickup_location?: string | null;
    pickup_depot_id?: string | null;
  };
  /** Overrides — used when the container row lacks transport info. */
  transporter?: string | null;
  truck_registration?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_id_number?: string | null;
  pickup_location?: string | null;
  pickup_depot_id?: string | null;
  /** For depot-owned invoice backfill. */
  seller_name?: string | null;
  purchase_price?: number | null;
  purchase_currency?: string | null;
  /** Acquisition service costs — each raises its own purchase invoice. */
  transport_vendor?: string | null;
  transport_cost?: number | null;
  offloading_vendor?: string | null;
  offloading_cost?: number | null;
  acquisition_currency?: string | null;
};

export type BackfillResult = {
  container_number: string;
  appointment: "created" | "skipped" | "error";
  eir: "created" | "skipped" | "error";
  invoice: "created" | "skipped" | "error" | "not_applicable";
  transport_invoice: "created" | "skipped" | "error";
  offloading_invoice: "created" | "skipped" | "error";
  errors: string[];
};

/**
 * Idempotently create the gate-in appointment, EIR gate-in and (for
 * depot-owned) supplier invoice that the new "Add container" flow now
 * generates automatically. Safe to call multiple times.
 */
export async function backfillContainerRecords(input: BackfillInput): Promise<BackfillResult> {
  const c = input.container;
  const out: BackfillResult = {
    container_number: c.container_number,
    appointment: "skipped",
    eir: "skipped",
    invoice: "not_applicable",
    transport_invoice: "skipped",
    offloading_invoice: "skipped",
    errors: [],
  };

  const transporter = input.transporter ?? c.transporter ?? null;
  const truck = input.truck_registration ?? c.truck_registration ?? null;
  const driverName = input.driver_name ?? c.driver_name ?? null;
  const driverPhone = input.driver_phone ?? c.driver_phone ?? null;
  const driverIdNumber = input.driver_id_number ?? c.driver_id_number ?? null;
  const pickupLocation = input.pickup_location ?? c.pickup_location ?? null;
  const pickupDepotId = input.pickup_depot_id ?? c.pickup_depot_id ?? null;
  const ownership = c.ownership_type ?? "shipper_owned";
  const shippingOrOwner = c.shipping_line ?? c.owner ?? null;

  // 0) Persist any missing pickup/driver-ID metadata back onto the container row
  const containerPatch: Record<string, any> = {};
  if (!c.pickup_location && pickupLocation) containerPatch.pickup_location = pickupLocation;
  if (!c.pickup_depot_id && pickupDepotId) containerPatch.pickup_depot_id = pickupDepotId;
  if (!c.driver_id_number && driverIdNumber) containerPatch.driver_id_number = driverIdNumber;
  if (!c.transporter && transporter) containerPatch.transporter = transporter;
  if (!c.truck_registration && truck) containerPatch.truck_registration = truck;
  if (!c.driver_name && driverName) containerPatch.driver_name = driverName;
  if (!c.driver_phone && driverPhone) containerPatch.driver_phone = driverPhone;
  if (Object.keys(containerPatch).length) {
    await supabase.from("containers").update(containerPatch as any).eq("id", c.id);
  }

  const transportParts = [
    transporter && `Transporter: ${transporter}`,
    truck && `Truck: ${truck}`,
    driverName && `Driver: ${driverName}`,
    driverIdNumber && `Driver ID: ${driverIdNumber}`,
    driverPhone && `Phone: ${driverPhone}`,
    pickupLocation && `Picked up from: ${pickupLocation}`,
    `Ownership: ${ownership === "depot_owned" ? "Depot-owned" : "Shipper-owned"}`,
    input.seller_name && `Seller: ${input.seller_name}`,
  ]
    .filter(Boolean)
    .join(" | ");

  // 1) Gate appointment — check first
  const { data: existingAppt } = await supabase
    .from("gate_appointments")
    .select("id")
    .eq("container_number", c.container_number)
    .limit(1)
    .maybeSingle();

  let apptId: string | null = existingAppt?.id ?? null;
  if (!existingAppt) {
    const apptNumber = `APT-BF-${Date.now().toString(36).toUpperCase()}`;
    const { data: appt, error: apptErr } = await supabase
      .from("gate_appointments")
      .insert({
        appointment_number: apptNumber,
        appointment_type: "gate_in",
        scheduled_at: new Date().toISOString(),
        container_number: c.container_number,
        container_id: c.id,
        truck_plate: truck,
        driver_name: driverName,
        shipping_line: shippingOrOwner,
        status: "completed" as any,
        notes: `Backfilled from existing container. ${transportParts}`,
      } as any)
      .select("id")
      .single();
    if (apptErr) {
      out.appointment = "error";
      out.errors.push(`Appointment: ${apptErr.message}`);
    } else {
      apptId = appt?.id ?? null;
      out.appointment = "created";
    }
  }

  // 2) EIR gate-in
  const { data: existingEir } = await supabase
    .from("eir_records")
    .select("id")
    .eq("container_id", c.id)
    .eq("eir_type", "gate_in")
    .limit(1)
    .maybeSingle();

  if (!existingEir) {
    const { data: eirNumData } = await supabase.rpc("next_eir_number" as any, { prefix: "EIR" });
    const eirNumber = (eirNumData as unknown as string) ?? `EIR-${Date.now()}`;
    const { error: eirErr } = await supabase.from("eir_records").insert({
      eir_number: eirNumber,
      appointment_id: apptId,
      container_id: c.id,
      eir_type: "gate_in",
      condition_grade: "A",
      cargo_status: "empty",
      transporter_company: transporter,
      truck_plate: truck,
      driver_name: driverName,
      driver_phone: driverPhone,
      driver_id_number: driverIdNumber,
      origin_location: pickupLocation,
      pickup_depot_id: pickupDepotId,
      release_purpose: ownership === "depot_owned" ? "depot_purchase" : "storage",
      inspector_notes: `Backfilled. ${transportParts}`,
      completed_at: new Date().toISOString(),
    } as any);
    if (eirErr) {
      out.eir = "error";
      out.errors.push(`EIR: ${eirErr.message}`);
    } else {
      out.eir = "created";
    }
  }

  // 3) Supplier invoice for depot-owned purchases
  if (ownership === "depot_owned") {
    const { data: existingPinv } = await supabase
      .from("supplier_invoices")
      .select("id")
      .eq("reason", "purchase")
      .eq("reference", c.container_number)
      .limit(1)
      .maybeSingle();

    if (existingPinv) {
      out.invoice = "skipped";
    } else {
      const price = Number(input.purchase_price ?? 0);
      const seller = input.seller_name?.trim() ?? "";
      const currency = (input.purchase_currency || getOrgCurrency() || "USD").toUpperCase();
      if (!seller || !(price > 0)) {
        out.invoice = "skipped";
        out.errors.push("Invoice: seller and purchase price required to backfill supplier invoice.");
      } else {
        try {
          const poId = await acquireContainerFromOwner({
            containerId: c.id,
            amount: price,
            currency,
            reason: "purchase" as any,
            reference: c.container_number,
            expectedOwner: seller,
          });
          out.invoice = poId ? "created" : "skipped";
        } catch (e: any) {
          out.invoice = "error";
          out.errors.push(`Invoice: ${e.message ?? String(e)}`);
        }
      }
    }
  }

  // 4) Acquisition service invoices — transport and crane / offloading.
  // The RPC is idempotent per container + service kind, so re-running is safe.
  const acqCurrency = (
    input.acquisition_currency || input.purchase_currency || getOrgCurrency() || "USD"
  ).toUpperCase();

  const services: Array<{
    kind: "transport" | "crane_offloading";
    vendor: string | null | undefined;
    amount: number | null | undefined;
    slot: "transport_invoice" | "offloading_invoice";
    label: string;
  }> = [
    {
      kind: "transport",
      vendor: input.transport_vendor ?? transporter,
      amount: input.transport_cost,
      slot: "transport_invoice",
      label: "Transport invoice",
    },
    {
      kind: "crane_offloading",
      vendor: input.offloading_vendor,
      amount: input.offloading_cost,
      slot: "offloading_invoice",
      label: "Offloading invoice",
    },
  ];

  for (const svc of services) {
    if (!(Number(svc.amount ?? 0) > 0)) continue;
    if (!svc.vendor?.trim()) {
      out.errors.push(`${svc.label}: vendor required to raise the invoice.`);
      continue;
    }
    try {
      const poId = await recordContainerServiceInvoice({
        containerId: c.id,
        vendorName: svc.vendor,
        amount: Number(svc.amount),
        currency: acqCurrency,
        serviceKind: svc.kind,
        reference: c.container_number,
      });
      out[svc.slot] = poId ? "created" : "skipped";
    } catch (e: any) {
      out[svc.slot] = "error";
      out.errors.push(`${svc.label}: ${e.message ?? String(e)}`);
    }
  }

  // Persist the captured acquisition costs on the container row
  const costPatch: Record<string, any> = {};
  if (Number(input.transport_cost ?? 0) > 0) {
    costPatch.transport_cost = Number(input.transport_cost);
    costPatch.transport_vendor = (input.transport_vendor ?? transporter) || null;
  }
  if (Number(input.offloading_cost ?? 0) > 0) {
    costPatch.offloading_cost = Number(input.offloading_cost);
    costPatch.offloading_vendor = input.offloading_vendor || null;
  }
  if (Object.keys(costPatch).length) {
    costPatch.acquisition_currency = acqCurrency;
    await supabase.from("containers").update(costPatch as any).eq("id", c.id);
  }

  return out;
}

