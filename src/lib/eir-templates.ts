import * as QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { format } from "date-fns";
import { getAppSettings } from "@/lib/app-settings";
import { toPrintableImageUrl } from "@/lib/print-assets";

function depotBrand(depot?: { name?: string; location?: string | null; code?: string; logo_url?: string | null } | null) {
  const s = getAppSettings();
  const wd = s.workingDepotBrand;
  return {
    name: depot?.name || wd?.name || s.organizationName || "Container Depot",
    location: depot?.location || wd?.location || s.organizationAddress || "",
    code: depot?.code || wd?.code || "",
    logo_url: depot?.logo_url || wd?.logoUrl || s.organizationLogoUrl || "",
  };
}

async function withPrintableLogo(data: EirPrintData): Promise<EirPrintData> {
  const brand = depotBrand(data.depot);
  const logoUrl = await toPrintableImageUrl(brand.logo_url);
  return {
    ...data,
    depot: {
      name: brand.name,
      code: brand.code,
      location: brand.location,
      logo_url: logoUrl || null,
    },
  };
}

export type EirTemplateType = "standard" | "compact" | "detailed" | "minimal" | "branded";

export interface EirPrintData {
  eir_number: string;
  eir_type: "gate_in" | "gate_out";
  completed_at: string | null;
  created_at: string;
  condition_grade: string;
  cargo_status: string;
  seal_number: string | null;
  damage_description: string | null;
  inspector_notes: string | null;
  release_purpose?: string | null;
  released_by_name?: string | null;
  released_by_role?: string | null;
  // Transport details captured directly on the EIR (preferred over appointment).
  truck_plate?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  transporter_company?: string | null;
  // Movement context for the new gate-in arrival / repat-out purposes.
  origin_location?: string | null;
  nominated_depot?: string | null;
  // Indemnity captured against the transporter for damages-in-transit.
  transporter_indemnity_signed?: boolean | null;
  transporter_indemnity_signed_at?: string | null;
  transporter_indemnity_signer?: string | null;
  photos?: string[];
  // Ownership frozen on the EIR record at issue time (depot for depot-owned units).
  owner_at_issue?: string | null;
  new_owner?: string | null;
  acquisition_supplier?: string | null;
  // Actual purchase price of the unit and the reference (standard) rate for its
  // size, frozen on the gate-in EIR.
  purchase_price_snapshot?: number | null;
  reference_rate?: number | null;
  purchase_currency?: string | null;
  /** FX rate applied when the purchase currency differs from the reference currency. */
  fx_rate_snapshot?: number | null;
  gate_fee_amount?: number | null;
  gate_fee_currency?: string | null;
  approval_status?: string | null;
  container?: {
    container_number: string;
    size: string;
    iso_type: string | null;
    category: string;
    owner: string | null;
    shipping_line: string | null;
    tare_weight_kg: number | null;
    weight_kg: number | null;
    is_empty: boolean;
    status?: string;
  } | null;
  appointment?: {
    appointment_number: string;
    shipping_line: string | null;
    truck_plate: string | null;
    driver_name: string | null;
    driver_license: string | null;
  } | null;
  depot?: {
    name: string;
    code: string;
    location: string | null;
    logo_url?: string | null;
  } | null;
  buyer?: {
    label?: string; // "Buyer" (default), "Consignee", etc.
    name: string;
    contact?: string | null;
    kra_pin?: string | null;
    tax_id?: string | null;
    address?: string | null;
    original_owner?: string | null;
    acquisition_supplier?: string | null;
  } | null;
  lease?: {
    lease_number: string;
    lessee_name: string;
    lease_type?: string | null;
    currency: string;
    per_diem: string | number;
    free_days_pickup?: number | null;
    free_days_redelivery?: number | null;
    on_hire_at?: string | null;
    status?: string | null;
    invoice_number?: string | null;
    invoice_status?: string | null;
    invoice_total?: string | number | null;
  } | null;
}

async function generateQrDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, { width: 120, margin: 1 });
}

function generateBarcodeDataUrl(data: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, data, {
    format: "CODE128",
    width: 1.5,
    height: 40,
    displayValue: true,
    fontSize: 10,
    margin: 2,
  });
  return canvas.toDataURL("image/png");
}

const dateStr = (d: string | null) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy HH:mm"); } catch { return d; }
};

const v = (s: string | null | undefined) => s ?? "—";

// Generate SHA-256 hash for document integrity
async function generateDocHash(data: EirPrintData): Promise<string> {
  const raw = `${data.eir_number}|${data.eir_type}|${data.container?.container_number ?? ""}|${data.condition_grade}|${data.cargo_status}|${data.completed_at ?? data.created_at}|${data.released_by_name ?? ""}|${data.buyer?.name ?? ""}|${data.lease?.lease_number ?? ""}|${data.lease?.invoice_number ?? ""}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 24).toUpperCase();
}

function releasePurposeLabel(p: string | null | undefined): string {
  const map: Record<string, string> = {
    sold_unit: "Sold Unit",
    lease_unit: "Lease Unit",
    repositioning: "Repositioning",
    repair: "Repair Return",
    other: "Other",
  };
  return p ? (map[p] ?? p) : "—";
}

function commonStyles(fontSize = "11px") {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: ${fontSize}; color: #000; padding: 15mm; position: relative; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-weight: bold; }
    .title { text-align: center; font-size: 16px; font-weight: bold; margin-bottom: 4px; text-transform: uppercase; }
    .subtitle { text-align: center; font-size: 12px; color: #444; margin-bottom: 10px; }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .codes { display: flex; gap: 12px; align-items: center; }
    .codes img { display: block; }
    .label { font-weight: bold; font-size: 9px; color: #555; text-transform: uppercase; }
    .section-title { background: #333; color: #fff; padding: 3px 6px; font-weight: bold; font-size: 10px; text-transform: uppercase; }
    .grade-box { display: inline-block; padding: 2px 10px; font-weight: bold; font-size: 14px; border: 2px solid #000; }
    .remarks { min-height: 40px; white-space: pre-wrap; }
    .footer { margin-top: 15px; display: flex; justify-content: space-between; font-size: 9px; }
    .sig-line { border-top: 1px solid #000; width: 180px; text-align: center; padding-top: 3px; margin-top: 30px; }
    .watermark {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 60px; font-weight: bold; color: rgba(0,0,0,0.04); white-space: nowrap;
      pointer-events: none; z-index: 0; letter-spacing: 8px;
    }
    .doc-security { margin-top: 12px; padding: 6px 8px; border: 1px dashed #999; font-size: 8px; color: #666; }
    .doc-security .hash { font-family: monospace; font-size: 9px; letter-spacing: 1px; color: #333; }
    .photo-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .photo-grid img { width: 100px; height: 75px; object-fit: cover; border: 1px solid #ccc; }
    @media print {
      body { padding: 10mm; }
      @page { size: A4; margin: 10mm; }
    }
  `;
}

function watermarkHtml() {
  return `<div class="watermark">OFFICIAL DOCUMENT</div>`;
}

function headerBlock(d: EirPrintData, qr: string, barcode: string, showDepot = true) {
  const eirLabel = d.eir_type === "gate_in" ? "INWARD (EIR)" : "OUTWARD (EIR)";
  const _brand = depotBrand(d.depot);
  const depotName = showDepot ? _brand.name : "CONTAINER DEPOT";
  const depotLoc = showDepot && _brand.location ? `<div class="subtitle">${_brand.location}</div>` : "";
  const logoHtml = _brand.logo_url ? `<img src="${_brand.logo_url}" style="max-height:50px;width:auto;margin-bottom:4px;" />` : "";
  return `
    <div class="header-row">
      <div>
        ${logoHtml || `<div style="font-size:14px;font-weight:bold;">${depotName}</div>`}
        ${depotLoc}
      </div>
      <div class="codes">
        <img src="${qr}" width="90" height="90" />
        <img src="${barcode}" height="50" />
      </div>
    </div>
    <div class="title">${eirLabel}</div>
    <table style="margin-bottom:10px;">
      <tr>
        <td class="label" style="width:15%;">EIR No.</td>
        <td style="font-weight:bold;font-size:13px;">${d.eir_number}</td>
        <td class="label" style="width:15%;">Date</td>
        <td>${dateStr(d.completed_at ?? d.created_at)}</td>
      </tr>
    </table>
  `;
}

function containerSection(d: EirPrintData) {
  const c = d.container;
  return `
    <div class="section-title">Container Details</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Container No.</td>
        <td style="font-weight:bold;font-family:monospace;font-size:13px;">${v(c?.container_number)}</td>
        <td class="label" style="width:12%;">Size</td>
        <td>${v(c?.size)}ft</td>
        <td class="label" style="width:12%;">Type</td>
        <td>${v(c?.iso_type)}</td>
      </tr>
      <tr>
        <td class="label">Category</td>
        <td>${v(c?.category)}</td>
        <td class="label">Owner</td>
        <td>${v(c?.owner)}</td>
        <td class="label">Shipping Line</td>
        <td>${v(c?.shipping_line)}</td>
      </tr>
      <tr>
        <td class="label">Tare (kg)</td>
        <td>${c?.tare_weight_kg ?? "—"}</td>
        <td class="label">Gross (kg)</td>
        <td>${c?.weight_kg ?? "—"}</td>
        <td class="label">Cargo</td>
        <td style="font-weight:bold;">${d.cargo_status.toUpperCase()}</td>
      </tr>
    </table>
  `;
}

function approvalBanner(d: EirPrintData) {
  if (d.approval_status === "pending") {
    return `<div style="margin:6px 0;padding:6px;border:1px dashed #b45309;color:#b45309;font-weight:bold;text-align:center;">AWAITING OWNER APPROVAL</div>`;
  }
  if (d.approval_status === "rejected") {
    return `<div style="margin:6px 0;padding:6px;border:1px dashed #b91c1c;color:#b91c1c;font-weight:bold;text-align:center;">REJECTED BY OWNER</div>`;
  }
  if (d.approval_status === "approved") {
    return `<div style="margin:6px 0;padding:4px;color:#047857;font-weight:bold;text-align:center;">APPROVED BY OWNER</div>`;
  }
  return "";
}

function acquisitionCostSection(d: EirPrintData) {
  const price = d.purchase_price_snapshot;
  if (price == null && d.gate_fee_amount == null) return "";
  if (price == null) {
    const gf = Number(d.gate_fee_amount);
    return `
    <div class="section-title" style="margin-top:8px;">Charges</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Gate Fee</td>
        <td style="font-family:monospace;font-weight:bold;">${d.gate_fee_currency ?? ""} ${gf.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      </tr>
    </table>
  `;
  }
  const ref = d.reference_rate;
  const cur = d.purchase_currency ?? "";
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const diff = ref == null ? null : Number(price) - Number(ref);
  const diffLabel = diff == null
    ? "—"
    : Math.abs(diff) < 0.01
      ? "At standard rate"
      : `${cur} ${fmt(Math.abs(diff))} ${diff < 0 ? "discount" : "over rate"}`;
  return `
    <div class="section-title" style="margin-top:8px;">Acquisition Cost</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Purchase Price</td>
        <td style="font-family:monospace;font-weight:bold;">${cur} ${fmt(Number(price))}</td>
        <td class="label" style="width:18%;">Standard (EIR) Rate</td>
        <td style="font-family:monospace;">${ref == null ? "—" : `${cur} ${fmt(Number(ref))}`}</td>
      </tr>
      <tr>
        <td class="label">Variance</td>
        <td style="font-weight:bold;">${diffLabel}</td>
        <td class="label">Conversion Rate</td>
        <td style="font-family:monospace;">${d.fx_rate_snapshot == null || Number(d.fx_rate_snapshot) === 1 ? "—" : Number(d.fx_rate_snapshot)}</td>
      </tr>
      <tr>
        <td class="label">Gate Fee</td>
        <td style="font-family:monospace;">${d.gate_fee_amount == null ? "—" : `${d.gate_fee_currency ?? cur} ${fmt(Number(d.gate_fee_amount))}`}</td>
        <td class="label">Total This Unit</td>
        <td style="font-family:monospace;font-weight:bold;">${cur} ${fmt(Number(price) + Number(d.gate_fee_amount ?? 0))}</td>
      </tr>
    </table>
  `;
}

function transportSection(d: EirPrintData) {
  const a = d.appointment;
  // Prefer values captured directly on the EIR; fall back to the linked appointment.
  const plate = d.truck_plate ?? a?.truck_plate ?? null;
  const driver = d.driver_name ?? a?.driver_name ?? null;
  const phone = d.driver_phone ?? null;
  const carrier = d.transporter_company ?? a?.shipping_line ?? null;
  const showIndemnity = d.eir_type === "gate_out";
  const indemnityLine = d.transporter_indemnity_signed
    ? `SIGNED${d.transporter_indemnity_signer ? ` — ${d.transporter_indemnity_signer}` : ""}${d.transporter_indemnity_signed_at ? ` on ${new Date(d.transporter_indemnity_signed_at).toLocaleString()}` : ""}`
    : "NOT SIGNED";
  return `
    <div class="section-title" style="margin-top:8px;">Transport Details</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Appointment</td>
        <td>${v(a?.appointment_number)}</td>
        <td class="label" style="width:15%;">Carrier/Transporter</td>
        <td>${v(carrier)}</td>
      </tr>
      <tr>
        <td class="label">Vehicle/Plate</td>
        <td style="font-weight:bold;">${v(plate)}</td>
        <td class="label">Driver</td>
        <td style="font-weight:bold;">${v(driver)}</td>
      </tr>
      <tr>
        <td class="label">Driver Phone</td>
        <td>${v(phone ?? a?.driver_license)}</td>
        <td class="label">Seal No.</td>
        <td style="font-weight:bold;">${v(d.seal_number)}</td>
      </tr>
      ${d.origin_location ? `<tr><td class="label">Arrived From</td><td colspan="3">${v(d.origin_location)}</td></tr>` : ""}
      ${d.nominated_depot ? `<tr><td class="label">Nominated Depot</td><td colspan="3" style="font-weight:bold;">${v(d.nominated_depot)}</td></tr>` : ""}
      ${showIndemnity ? `<tr><td class="label">Transporter Indemnity</td><td colspan="3" style="font-weight:bold;">${indemnityLine} — transporter accepts liability for any damage or loss in transit.</td></tr>` : ""}
    </table>
  `;
}

function releaseSection(d: EirPrintData) {
  return `
    <div class="section-title" style="margin-top:8px;">Release & Accountability</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Release Purpose</td>
        <td style="font-weight:bold;">${releasePurposeLabel(d.release_purpose)}</td>
        <td class="label" style="width:15%;">Released By</td>
        <td>${v(d.released_by_name)}</td>
      </tr>
      <tr>
        <td class="label">Role</td>
        <td>${v(d.released_by_role)}</td>
        <td class="label">Container Status</td>
        <td>${v(d.container?.status)}</td>
      </tr>
    </table>
  `;
}

function buyerSection(d: EirPrintData) {
  const b = d.buyer;
  if (!b || !b.name) return "";
  const label = b.label ?? "Buyer";
  const taxLine = b.kra_pin || b.tax_id;
  return `
    <div class="section-title" style="margin-top:8px;">${label} / Consignee Details</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">${label} Name</td>
        <td style="font-weight:bold;">${v(b.name)}</td>
        <td class="label" style="width:15%;">Contact</td>
        <td>${v(b.contact)}</td>
      </tr>
      <tr>
        <td class="label">${b.kra_pin ? "KRA PIN" : "Tax ID"}</td>
        <td>${v(taxLine)}</td>
        <td class="label">Original Owner</td>
        <td>${v(b.original_owner)}</td>
      </tr>
      ${b.acquisition_supplier ? `<tr><td class="label">Acquired From</td><td colspan="3">${v(b.acquisition_supplier)}</td></tr>` : ""}
      ${b.address ? `<tr><td class="label">Address</td><td colspan="3">${v(b.address)}</td></tr>` : ""}
    </table>
  `;
}

function leaseSection(d: EirPrintData) {
  const l = d.lease;
  if (!l || !l.lease_number) return "";
  const perDiem = typeof l.per_diem === "number" ? l.per_diem.toFixed(2) : String(l.per_diem ?? "—");
  const invoiceTotal = l.invoice_total != null
    ? (typeof l.invoice_total === "number" ? l.invoice_total.toFixed(2) : String(l.invoice_total))
    : null;
  return `
    <div class="section-title" style="margin-top:8px;">Lease Context (Controlling Agreement)</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Lease No.</td>
        <td style="font-weight:bold;font-family:monospace;">${v(l.lease_number)}</td>
        <td class="label" style="width:15%;">Lessee</td>
        <td>${v(l.lessee_name)}</td>
      </tr>
      <tr>
        <td class="label">Per Diem</td>
        <td style="font-family:monospace;">${l.currency ?? ""} ${perDiem}</td>
        <td class="label">Free Days (Pickup / Redel.)</td>
        <td>${l.free_days_pickup ?? "—"} / ${l.free_days_redelivery ?? "—"}</td>
      </tr>
      <tr>
        <td class="label">On-Hire</td>
        <td>${l.on_hire_at ? dateStr(l.on_hire_at) : "—"}</td>
        <td class="label">Lease Status</td>
        <td>${v(l.status)}</td>
      </tr>
      ${l.invoice_number ? `<tr>
        <td class="label">Invoice No.</td>
        <td style="font-family:monospace;font-weight:bold;">${v(l.invoice_number)}</td>
        <td class="label">Invoice Total / Status</td>
        <td>${invoiceTotal ? `${l.currency ?? ""} ${invoiceTotal}` : "—"} ${l.invoice_status ? `(${l.invoice_status})` : ""}</td>
      </tr>` : ""}
    </table>
  `;
}

function conditionSection(d: EirPrintData) {
  const gradeColors: Record<string, string> = {
    A: "#22c55e", B: "#3b82f6", C: "#eab308", D: "#ef4444",
  };
  const color = gradeColors[d.condition_grade] ?? "#000";
  return `
    <div class="section-title" style="margin-top:8px;">Condition Assessment</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Condition Grade</td>
        <td style="width:15%;"><span class="grade-box" style="border-color:${color};color:${color};">${d.condition_grade}</span></td>
        <td class="label" style="width:15%;">Grade Key</td>
        <td style="font-size:9px;">A=Excellent &nbsp; B=Good &nbsp; C=Fair &nbsp; D=Poor</td>
      </tr>
    </table>
  `;
}

function remarksSection(d: EirPrintData) {
  return `
    <div class="section-title" style="margin-top:8px;">Remarks &amp; Damage</div>
    <table>
      <tr>
        <td class="label" style="width:18%;">Damage</td>
        <td class="remarks">${v(d.damage_description)}</td>
      </tr>
      <tr>
        <td class="label">Inspector Notes</td>
        <td class="remarks">${v(d.inspector_notes)}</td>
      </tr>
    </table>
  `;
}

function photosSection(d: EirPrintData) {
  if (!d.photos?.length) return "";
  return `
    <div class="section-title" style="margin-top:8px;">Condition Photos</div>
    <div class="photo-grid">
      ${d.photos.map(url => `<img src="${url}" />`).join("")}
    </div>
  `;
}

function signatureBlock(d: EirPrintData) {
  return `
    <div class="footer">
      <div>
        <div class="sig-line">Driver Signature</div>
      </div>
      <div>
        <div class="sig-line">Inspector Signature</div>
        ${d.released_by_name ? `<div style="font-size:8px;text-align:center;margin-top:2px;">${d.released_by_name} (${d.released_by_role ?? "—"})</div>` : ""}
      </div>
      <div>
        <div class="sig-line">Authorized By</div>
      </div>
    </div>
  `;
}

function securityFooter(hash: string, d: EirPrintData) {
  return `
    <div class="doc-security">
      <strong>DOCUMENT VERIFICATION</strong> &nbsp;|&nbsp;
      Hash: <span class="hash">${hash}</span> &nbsp;|&nbsp;
      Issued: ${dateStr(d.completed_at ?? d.created_at)} &nbsp;|&nbsp;
      ${d.released_by_name ? `By: ${d.released_by_name} (${d.released_by_role ?? ""})` : "System Generated"}
      <br/>⚠ VOID IF ALTERED — This document is digitally verifiable via QR code scan.
    </div>
  `;
}

// ── Template 1: Standard ──────────────────────────
function standardTemplate(d: EirPrintData, qr: string, barcode: string, hash: string) {
  return `
    <html><head><style>${commonStyles()}</style></head><body>
      ${watermarkHtml()}
      ${headerBlock(d, qr, barcode)}
      ${containerSection(d)}
      ${approvalBanner(d)}
      ${acquisitionCostSection(d)}
      ${transportSection(d)}
      ${releaseSection(d)}
      ${buyerSection(d)}
      ${leaseSection(d)}
      ${conditionSection(d)}
      ${remarksSection(d)}
      ${photosSection(d)}
      ${signatureBlock(d)}
      ${securityFooter(hash, d)}
    </body></html>
  `;
}

// ── Template 2: Compact ───────────────────────────
function compactTemplate(d: EirPrintData, qr: string, barcode: string, hash: string) {
  const eirLabel = d.eir_type === "gate_in" ? "INWARD (EIR)" : "OUTWARD (EIR)";
  const c = d.container;
  const a = d.appointment;
  return `
    <html><head><style>
      ${commonStyles("9px")}
      td, th { padding: 2px 4px; }
      .title { font-size: 13px; margin-bottom: 2px; }
      .section-title { font-size: 8px; padding: 2px 4px; }
      .sig-line { width: 140px; margin-top: 20px; }
    </style></head><body>
      ${watermarkHtml()}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-weight:bold;">${depotBrand(d.depot).name}</div>
        <div class="codes" style="gap:6px;"><img src="${qr}" width="60" height="60"/><img src="${barcode}" height="30"/></div>
      </div>
      <div class="title">${eirLabel}</div>
      <table style="margin-bottom:4px;">
        <tr>
          <td class="label">EIR No.</td><td style="font-weight:bold;">${d.eir_number}</td>
          <td class="label">Date</td><td>${dateStr(d.completed_at ?? d.created_at)}</td>
          <td class="label">Container</td><td style="font-family:monospace;font-weight:bold;">${v(c?.container_number)}</td>
        </tr>
        <tr>
          <td class="label">Size</td><td>${v(c?.size)}ft</td>
          <td class="label">Type</td><td>${v(c?.iso_type)}</td>
          <td class="label">Category</td><td>${v(c?.category)}</td>
        </tr>
        <tr>
          <td class="label">Cargo</td><td>${d.cargo_status.toUpperCase()}</td>
          <td class="label">Seal</td><td>${v(d.seal_number)}</td>
          <td class="label">Grade</td><td style="font-weight:bold;">${d.condition_grade}</td>
        </tr>
        <tr>
          <td class="label">Vehicle</td><td>${v(a?.truck_plate)}</td>
          <td class="label">Driver</td><td>${v(a?.driver_name)}</td>
          <td class="label">Release</td><td style="font-weight:bold;">${releasePurposeLabel(d.release_purpose)}</td>
        </tr>
        <tr>
          <td class="label">Released By</td><td>${v(d.released_by_name)}</td>
          <td class="label">Role</td><td>${v(d.released_by_role)}</td>
          <td class="label">Licence</td><td>${v(a?.driver_license)}</td>
        </tr>
        ${d.buyer?.name ? `<tr>
          <td class="label">${d.buyer.label ?? "Buyer"}</td><td style="font-weight:bold;">${v(d.buyer.name)}</td>
          <td class="label">Contact</td><td>${v(d.buyer.contact)}</td>
          <td class="label">Orig. Owner</td><td>${v(d.buyer.original_owner)}</td>
        </tr>` : ""}
      </table>
      <table><tr><td class="label" style="width:12%;">Remarks</td><td style="min-height:25px;">${v(d.damage_description)} ${d.inspector_notes ? " | " + d.inspector_notes : ""}</td></tr></table>
      ${photosSection(d)}
      ${signatureBlock(d)}
      ${securityFooter(hash, d)}
    </body></html>
  `;
}

// ── Template 3: Detailed ──────────────────────────
function detailedTemplate(d: EirPrintData, qr: string, barcode: string, hash: string) {
  return `
    <html><head><style>${commonStyles()}</style></head><body>
      ${watermarkHtml()}
      ${headerBlock(d, qr, barcode)}
      ${containerSection(d)}
      ${approvalBanner(d)}
      ${acquisitionCostSection(d)}
      ${transportSection(d)}
      ${releaseSection(d)}
      ${buyerSection(d)}
      ${leaseSection(d)}
      <div class="section-title" style="margin-top:8px;">Reefer / Ventilation Details</div>
      <table>
        <tr>
          <td class="label" style="width:18%;">Temperature Set</td><td>—</td>
          <td class="label" style="width:15%;">Actual Temp</td><td>—</td>
        </tr>
        <tr>
          <td class="label">Ventilation</td><td>—</td>
          <td class="label">Humidity %</td><td>—</td>
        </tr>
        <tr>
          <td class="label">Reefer Hours</td><td>—</td>
          <td class="label">Power Status</td><td>—</td>
        </tr>
      </table>
      ${conditionSection(d)}
      <div class="section-title" style="margin-top:8px;">Detailed Damage Report</div>
      <table>
        <tr><th style="width:25%;">Component</th><th>Description</th><th style="width:15%;">Severity</th></tr>
        <tr><td>Panels</td><td>${d.damage_description ?? "No damage reported"}</td><td>${d.condition_grade === "A" ? "None" : d.condition_grade}</td></tr>
        <tr><td>Floor</td><td>—</td><td>—</td></tr>
        <tr><td>Doors</td><td>—</td><td>—</td></tr>
        <tr><td>Roof</td><td>—</td><td>—</td></tr>
      </table>
      <div class="section-title" style="margin-top:8px;">Inspector Notes</div>
      <table><tr><td class="remarks" style="min-height:60px;">${v(d.inspector_notes)}</td></tr></table>
      ${photosSection(d)}
      ${signatureBlock(d)}
      ${securityFooter(hash, d)}
    </body></html>
  `;
}

// ── Template 4: Minimal ───────────────────────────
function minimalTemplate(d: EirPrintData, qr: string, barcode: string, hash: string) {
  const eirLabel = d.eir_type === "gate_in" ? "INWARD (EIR)" : "OUTWARD (EIR)";
  const c = d.container;
  const a = d.appointment;
  return `
    <html><head><style>
      * { margin: 0; padding: 0; }
      body { font-family: 'Courier New', monospace; font-size: 11px; padding: 10mm; position: relative; }
      .line { border-bottom: 1px dashed #999; padding: 2px 0; display: flex; }
      .lbl { width: 160px; font-weight: bold; }
      .title { text-align: center; font-size: 14px; font-weight: bold; margin: 8px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 4px; }
      .codes { text-align: center; margin: 6px 0; }
      .codes img { margin: 0 6px; }
      .sep { border-top: 1px solid #000; margin: 6px 0; }
      .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 50px; font-weight: bold; color: rgba(0,0,0,0.04); pointer-events: none; z-index: 0; }
      .doc-security { margin-top: 12px; padding: 4px; border: 1px dashed #999; font-size: 8px; color: #666; }
      .doc-security .hash { font-size: 9px; color: #333; }
      @media print { @page { size: A4; margin: 10mm; } }
    </style></head><body>
      <div class="watermark">OFFICIAL DOCUMENT</div>
      <div style="text-align:center;font-weight:bold;">${depotBrand(d.depot).name}</div>
      <div class="title">${eirLabel}</div>
      <div class="codes"><img src="${qr}" width="80" height="80"/><br/><img src="${barcode}" height="35"/></div>
      <div class="sep"></div>
      <div class="line"><span class="lbl">EIR Number:</span><span>${d.eir_number}</span></div>
      <div class="line"><span class="lbl">Date:</span><span>${dateStr(d.completed_at ?? d.created_at)}</span></div>
      <div class="line"><span class="lbl">Container:</span><span>${v(c?.container_number)}</span></div>
      <div class="line"><span class="lbl">Size / Type:</span><span>${v(c?.size)}ft / ${v(c?.iso_type)}</span></div>
      <div class="line"><span class="lbl">Category:</span><span>${v(c?.category)}</span></div>
      <div class="line"><span class="lbl">Cargo Status:</span><span>${d.cargo_status.toUpperCase()}</span></div>
      <div class="line"><span class="lbl">Seal Number:</span><span>${v(d.seal_number)}</span></div>
      <div class="line"><span class="lbl">Condition Grade:</span><span>${d.condition_grade}</span></div>
      <div class="sep"></div>
      <div class="line"><span class="lbl">Release Purpose:</span><span style="font-weight:bold;">${releasePurposeLabel(d.release_purpose)}</span></div>
      <div class="line"><span class="lbl">Released By:</span><span>${v(d.released_by_name)} (${v(d.released_by_role)})</span></div>
      ${d.buyer?.name ? `
      <div class="line"><span class="lbl">${d.buyer.label ?? "Buyer"}:</span><span style="font-weight:bold;">${v(d.buyer.name)}</span></div>
      ${d.buyer.contact ? `<div class="line"><span class="lbl">${d.buyer.label ?? "Buyer"} Contact:</span><span>${v(d.buyer.contact)}</span></div>` : ""}
      ${d.buyer.original_owner ? `<div class="line"><span class="lbl">Original Owner:</span><span>${v(d.buyer.original_owner)}</span></div>` : ""}
      ` : ""}
      <div class="sep"></div>
      <div class="line"><span class="lbl">Vehicle:</span><span>${v(a?.truck_plate)}</span></div>
      <div class="line"><span class="lbl">Driver:</span><span>${v(a?.driver_name)}</span></div>
      <div class="line"><span class="lbl">Driver ID:</span><span>${v(a?.driver_license)}</span></div>
      <div class="line"><span class="lbl">Agent/Carrier:</span><span>${v(a?.shipping_line)}</span></div>
      <div class="sep"></div>
      <div class="line"><span class="lbl">Damage:</span><span>${v(d.damage_description)}</span></div>
      <div class="line"><span class="lbl">Notes:</span><span>${v(d.inspector_notes)}</span></div>
      <div class="sep"></div>
      <div style="display:flex;justify-content:space-between;margin-top:30px;">
        <div style="border-top:1px solid #000;width:140px;text-align:center;padding-top:2px;">Driver</div>
        <div style="border-top:1px solid #000;width:140px;text-align:center;padding-top:2px;">Inspector</div>
        <div style="border-top:1px solid #000;width:140px;text-align:center;padding-top:2px;">Authorized By</div>
      </div>
      ${securityFooter(hash, d)}
    </body></html>
  `;
}

// ── Template 5: Branded ───────────────────────────
function brandedTemplate(d: EirPrintData, qr: string, barcode: string, hash: string) {
  const eirLabel = d.eir_type === "gate_in" ? "INWARD (EIR)" : "OUTWARD (EIR)";
  return `
    <html><head><style>
      ${commonStyles()}
      .brand-header { background: linear-gradient(135deg, #1e3a5f, #2563eb); color: #fff; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin: -15mm -15mm 12px -15mm; }
      .brand-header h1 { font-size: 20px; margin: 0; }
      .brand-header .loc { font-size: 10px; opacity: 0.85; }
      .brand-codes { background: #fff; padding: 6px; border-radius: 4px; display: flex; gap: 8px; align-items: center; }
      .section-title { background: #1e3a5f; }
      .brand-footer { background: #f1f5f9; border-top: 3px solid #1e3a5f; padding: 8px 12px; margin: 20px -15mm -15mm -15mm; font-size: 9px; color: #555; text-align: center; }
      @media print { 
        .brand-header { margin: -10mm -10mm 12px -10mm; }
        .brand-footer { margin: 20px -10mm -10mm -10mm; }
      }
    </style></head><body>
      ${watermarkHtml()}
      <div class="brand-header">
        <div>
          ${depotBrand(d.depot).logo_url ? `<img src="${depotBrand(d.depot).logo_url}" style="max-height:54px;width:auto;margin-bottom:4px;background:#fff;padding:4px;border-radius:4px" />` : `<h1>${depotBrand(d.depot).name}</h1>`}
          <div class="loc">${depotBrand(d.depot).location} ${d.depot?.code ? `| Code: ${d.depot.code}` : ""}</div>
        </div>
        <div class="brand-codes">
          <img src="${qr}" width="80" height="80"/>
          <img src="${barcode}" height="40"/>
        </div>
      </div>
      <div class="title" style="border:2px solid #1e3a5f;padding:6px;margin-bottom:10px;">${eirLabel}</div>
      <table style="margin-bottom:8px;">
        <tr>
          <td class="label" style="width:15%;background:#e2e8f0;">EIR No.</td>
          <td style="font-weight:bold;font-size:13px;">${d.eir_number}</td>
          <td class="label" style="width:15%;background:#e2e8f0;">Date</td>
          <td>${dateStr(d.completed_at ?? d.created_at)}</td>
        </tr>
      </table>
      ${containerSection(d)}
      ${approvalBanner(d)}
      ${acquisitionCostSection(d)}
      ${transportSection(d)}
      ${releaseSection(d)}
      ${buyerSection(d)}
      ${leaseSection(d)}
      ${conditionSection(d)}
      ${remarksSection(d)}
      ${photosSection(d)}
      ${signatureBlock(d)}
      ${securityFooter(hash, d)}
      <div class="brand-footer">
        This is a system-generated Equipment Interchange Receipt. &nbsp;|&nbsp; ${d.eir_number} &nbsp;|&nbsp; ${dateStr(d.completed_at ?? d.created_at)}
        &nbsp;|&nbsp; ⚠ VOID IF ALTERED
      </div>
    </body></html>
  `;
}

const templateMap: Record<EirTemplateType, (d: EirPrintData, qr: string, bc: string, hash: string) => string> = {
  standard: standardTemplate,
  compact: compactTemplate,
  detailed: detailedTemplate,
  minimal: minimalTemplate,
  branded: brandedTemplate,
};

export const templateLabels: Record<EirTemplateType, string> = {
  standard: "Standard",
  compact: "Compact",
  detailed: "Detailed (Reefer)",
  minimal: "Minimal (Thermal)",
  branded: "Branded",
};

export const templateDescriptions: Record<EirTemplateType, string> = {
  standard: "A4 portrait — depot letterhead, container & condition block, signatures, QR & barcode. Use for most gate-in/gate-out hand-offs.",
  compact: "A4 single-column condensed — fits two EIRs per page when duplexed. Use for high-volume archival printing.",
  detailed: "A4 portrait with reefer/genset, ISO-type, pre-trip inspection and cargo lines. Use for reefer or hazardous cargo.",
  minimal: "80mm thermal-printer slip — gate-house dot-matrix or thermal printers. No photos or signatures.",
  branded: "Marketing-grade A4 with depot logo, color accents and disclaimers. Use for external/customer-facing copies.",
};

export class EirPrintValidationError extends Error {
  constructor(message: string) { super(message); this.name = "EirPrintValidationError"; }
}

/** Guard: refuse to print an EIR without transport details, and require the
 *  transporter indemnity for gate-out (damage-in-transit liability). */
export function assertEirPrintable(d: EirPrintData): void {
  const plate = (d.truck_plate ?? d.appointment?.truck_plate ?? "").trim();
  const driver = (d.driver_name ?? d.appointment?.driver_name ?? "").trim();
  if (!plate || !driver) {
    throw new EirPrintValidationError(
      "Transport details are required before printing an EIR. Add truck plate and driver name, then retry.",
    );
  }
  if (d.eir_type === "gate_out" && !d.transporter_indemnity_signed) {
    throw new EirPrintValidationError(
      "The transporter must sign the damage-in-transit indemnity before this gate-out EIR can be printed.",
    );
  }
}

export async function generateEirPrint(data: EirPrintData, template: EirTemplateType = "standard") {
  assertEirPrintable(data);
  const printData = await withPrintableLogo(data);
  const qrPayload = JSON.stringify({
    eir: printData.eir_number,
    container: printData.container?.container_number ?? "",
    release_purpose: releasePurposeLabel(printData.release_purpose),
    released_by: printData.released_by_name ?? "",
    role: printData.released_by_role ?? "",
    condition: printData.condition_grade,
    status: printData.container?.status ?? "",
    statement: printData.release_purpose
      ? `This container was released to ${printData.appointment?.shipping_line ?? printData.container?.owner ?? "N/A"} as ${releasePurposeLabel(printData.release_purpose)}`
      : `Container ${printData.eir_type === "gate_in" ? "received" : "released"} — ${printData.eir_number}`,
  });
  const qrDataUrl = await generateQrDataUrl(qrPayload);
  const barcodeDataUrl = generateBarcodeDataUrl(printData.eir_number);
  const hash = await generateDocHash(printData);

  const html = templateMap[template](printData, qrDataUrl, barcodeDataUrl, hash);

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) throw new EirPrintValidationError("Pop-up blocked — allow pop-ups for this site, then print again.");

  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}
