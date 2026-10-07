import * as QRCode from "qrcode";
import { getAppSettings, getOrgCurrency, symbolForCurrency } from "@/lib/app-settings";
import { logoOrNameHtml, toPrintableImageUrl } from "@/lib/print-assets";

/**
 * Resolve depot branding for a document, falling back in order to:
 *   1. the depot record attached to this document
 *   2. the user's currently selected "working depot" (from app-settings)
 *   3. organization-level branding (name, logo, address, tax id)
 * This keeps every generated document in sync with Settings, even when the
 * source record lacks a depot reference.
 */
function depotBrand(depot?: { name?: string; location?: string | null; code?: string; logo_url?: string | null; tax_id?: string | null } | null) {
  const s = getAppSettings();
  const wd = s.workingDepotBrand;
  return {
    name: depot?.name || wd?.name || s.organizationName || "Container Depot",
    location: depot?.location || wd?.location || s.organizationAddress || "",
    code: depot?.code || wd?.code || "",
    logo_url: depot?.logo_url || wd?.logoUrl || s.organizationLogoUrl || "",
    tax_id: depot?.tax_id || wd?.taxId || s.organizationTaxId || "",
  };
}
import JsBarcode from "jsbarcode";
import { format } from "date-fns";

const dateStr = (d: string | null) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy HH:mm"); } catch { return d; }
};
const v = (s: string | null | undefined) => s ?? "—";

async function generateQrDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, { width: 120, margin: 1 });
}

function generateBarcodeDataUrl(data: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, data, { format: "CODE128", width: 1.5, height: 40, displayValue: true, fontSize: 10, margin: 2 });
  return canvas.toDataURL("image/png");
}

async function generateDocHash(raw: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 24).toUpperCase();
}

function docStyles() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; padding: 15mm; position: relative; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; font-weight: bold; font-size: 10px; text-transform: uppercase; color: #444; }
    .title { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 2px; }
    .subtitle { text-align: center; font-size: 11px; color: #666; margin-bottom: 12px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; border-bottom: 3px solid #1e3a5f; padding-bottom: 10px; }
    .header h1 { font-size: 16px; color: #1e3a5f; margin: 0; }
    .header .loc { font-size: 9px; color: #666; }
    .codes { display: flex; gap: 8px; align-items: center; }
    .label { font-weight: bold; font-size: 9px; color: #555; text-transform: uppercase; }
    .section { background: #1e3a5f; color: #fff; padding: 4px 8px; font-weight: bold; font-size: 10px; text-transform: uppercase; margin-top: 10px; margin-bottom: 0; }
    .amount { font-family: monospace; font-weight: bold; }
    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 60px; font-weight: bold; color: rgba(0,0,0,0.04); pointer-events: none; z-index: 0; letter-spacing: 8px; white-space: nowrap; }
    .paid-stamp { position: fixed; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 72px; font-weight: bold; color: rgba(34,197,94,0.15); border: 6px solid rgba(34,197,94,0.15); padding: 10px 30px; border-radius: 12px; pointer-events: none; z-index: 0; }
    .security { margin-top: 15px; padding: 6px 8px; border: 1px dashed #999; font-size: 8px; color: #666; }
    .security .hash { font-family: monospace; font-size: 9px; letter-spacing: 1px; color: #333; }
    .sig-line { border-top: 1px solid #000; width: 180px; text-align: center; padding-top: 3px; margin-top: 35px; font-size: 9px; }
    .footer-sigs { display: flex; justify-content: space-between; margin-top: 20px; }
    .grade-box { display: inline-block; padding: 2px 12px; font-weight: bold; font-size: 16px; border: 2px solid; }
    .photo-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .photo-grid img { width: 100px; height: 75px; object-fit: cover; border: 1px solid #ccc; }
    .total-row td { font-weight: bold; font-size: 13px; background: #f0f4f8; border-top: 2px solid #1e3a5f; }
    @media print { body { padding: 10mm; } @page { size: A4; margin: 10mm; } }
  `;
}

function openPrintWindow(html: string) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

async function printableBrand(depot?: { name?: string; location?: string | null; code?: string; logo_url?: string | null; tax_id?: string | null } | null) {
  const brand = depotBrand(depot);
  return { ...brand, printableLogoUrl: await toPrintableImageUrl(brand.logo_url) };
}

// ═══════════════════════════════════════════════════
// INVOICE TEMPLATE
// ═══════════════════════════════════════════════════
export interface InvoicePrintData {
  invoice_number: string;
  status: string;
  customer_name: string;
  customer_reference?: string | null;
  container_number?: string | null;
  container_numbers?: string[] | null;
  invoice_type: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  notes?: string | null;
  issued_at?: string | null;
  due_at?: string | null;
  created_at: string;
  line_items?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    charge_type: string;
    period_from?: string | null;
    period_to?: string | null;
  }>;
  depot?: { name: string; location?: string | null; code?: string; logo_url?: string | null } | null;
  bank_account?: {
    bank_name?: string | null;
    account_name?: string | null;
    account_number?: string | null;
    branch?: string | null;
    swift_bic?: string | null;
    iban?: string | null;
    currency?: string | null;
  } | null;
  payments?: Array<{
    paid_at: string;
    amount: number;
    method?: string | null;
    reference?: string | null;
  }>;
  amount_paid?: number;
  balance_due?: number;
}

export async function printInvoice(data: InvoicePrintData) {
  const qr = await generateQrDataUrl(JSON.stringify({
    inv: data.invoice_number, amount: data.total_amount, currency: data.currency, status: data.status,
  }));
  const barcode = generateBarcodeDataUrl(data.invoice_number);
  const hash = await generateDocHash(`${data.invoice_number}|${data.total_amount}|${data.customer_name}|${data.status}`);
  const curr = symbolForCurrency(data.currency || getOrgCurrency());
  const brand = await printableBrand(data.depot);

  const lineItemsHtml = data.line_items?.length ? data.line_items.map(li => `
    <tr>
      <td>${li.description}</td>
      <td style="text-align:center;">${li.quantity}</td>
      <td style="text-align:right;" class="amount">${curr}${Number(li.unit_price).toFixed(2)}</td>
      <td style="text-align:right;" class="amount">${curr}${Number(li.total_price).toFixed(2)}</td>
    </tr>
  `).join("") : `<tr><td colspan="4">${data.invoice_type} charge — ${curr}${data.subtotal.toFixed(2)}</td></tr>`;

  const html = `<html><head><style>${docStyles()}</style></head><body>
    <div class="watermark">INVOICE</div>
    ${data.status === "paid" ? '<div class="paid-stamp">PAID</div>' : ""}
    <div class="header">
      <div>
        ${logoOrNameHtml(brand, brand.printableLogoUrl)}
        <div class="loc">${brand.location}</div>
      </div>
      <div class="codes"><img src="${qr}" width="90" height="90"/><img src="${barcode}" height="45"/></div>
    </div>
    <div class="title">INVOICE</div>
    <div class="subtitle">${data.invoice_number} · <span style="background:#111;color:#fff;padding:2px 8px;border-radius:4px;font-family:monospace;">${(data.currency || getOrgCurrency()).toUpperCase()}</span></div>
    <table style="margin-bottom:12px;">
      <tr>
        <td class="label" style="width:15%;">Invoice No.</td>
        <td style="font-weight:bold;font-size:13px;">${data.invoice_number}</td>
        <td class="label" style="width:12%;">Date</td>
        <td>${dateStr(data.issued_at ?? data.created_at)}</td>
        <td class="label" style="width:12%;">Status</td>
        <td style="font-weight:bold;text-transform:uppercase;">${data.status}</td>
      </tr>
    </table>
    <div class="section">Bill To</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Customer</td>
        <td style="font-weight:bold;">${data.customer_name}</td>
        <td class="label" style="width:15%;">Reference</td>
        <td>${v(data.customer_reference)}</td>
      </tr>
      <tr>
        <td class="label">${(data.container_numbers?.length ?? 0) > 1 ? "Containers" : "Container"}</td>
        <td style="font-family:monospace;">${data.container_numbers?.length ? data.container_numbers.join(", ") : v(data.container_number)}</td>
        <td class="label">Charge Type</td>
        <td style="text-transform:capitalize;">${data.invoice_type.replace("_", " ")}</td>
      </tr>
      ${data.due_at ? `<tr><td class="label">Due Date</td><td colspan="3" style="font-weight:bold;color:#c00;">${dateStr(data.due_at)}</td></tr>` : ""}
    </table>
    <div class="section" style="margin-top:12px;">Line Items</div>
    <table>
      <tr><th>Description</th><th style="width:10%;text-align:center;">Qty</th><th style="width:15%;text-align:right;">Unit Price</th><th style="width:15%;text-align:right;">Total</th></tr>
      ${lineItemsHtml}
    </table>
    <table style="width:50%;margin-left:auto;margin-top:8px;">
      <tr><td class="label">Subtotal</td><td style="text-align:right;" class="amount">${curr}${data.subtotal.toFixed(2)}</td></tr>
      <tr><td class="label">Tax (${data.tax_rate}%)</td><td style="text-align:right;" class="amount">${curr}${data.tax_amount.toFixed(2)}</td></tr>
      <tr class="total-row"><td>TOTAL — ${(data.currency || getOrgCurrency()).toUpperCase()}</td><td style="text-align:right;font-size:16px;font-weight:bold;">${curr}${data.total_amount.toFixed(2)}</td></tr>
      ${typeof data.amount_paid === "number" && data.amount_paid > 0 ? `
        <tr><td class="label">Amount Paid</td><td style="text-align:right;" class="amount">-${curr}${data.amount_paid.toFixed(2)}</td></tr>
        <tr class="total-row"><td>BALANCE DUE</td><td style="text-align:right;font-size:15px;font-weight:bold;color:${(data.balance_due ?? 0) > 0 ? "#c00" : "#080"};">${curr}${(data.balance_due ?? 0).toFixed(2)}</td></tr>
      ` : ""}
    </table>
    <div style="text-align:right;margin-top:4px;font-size:10px;color:#666;">All amounts in ${(data.currency || getOrgCurrency()).toUpperCase()}.</div>
    ${data.payments && data.payments.length ? `
      <div class="section" style="margin-top:12px;">Payments Received</div>
      <table>
        <tr><th style="width:20%;">Date</th><th>Method</th><th>Reference</th><th style="width:20%;text-align:right;">Amount</th></tr>
        ${data.payments.map(p => `
          <tr>
            <td>${dateStr(p.paid_at)}</td>
            <td style="text-transform:capitalize;">${(p.method ?? "").replace("_", " ")}</td>
            <td>${v(p.reference)}</td>
            <td style="text-align:right;" class="amount">${curr}${Number(p.amount).toFixed(2)}</td>
          </tr>
        `).join("")}
      </table>
    ` : ""}
    ${data.bank_account && (data.bank_account.account_number || data.bank_account.iban) ? `
      <div class="section" style="margin-top:12px;">Payment Instructions</div>
      <table>
        ${data.bank_account.bank_name ? `<tr><td class="label" style="width:20%;">Bank</td><td>${data.bank_account.bank_name}</td></tr>` : ""}
        ${data.bank_account.account_name ? `<tr><td class="label">Account Name</td><td>${data.bank_account.account_name}</td></tr>` : ""}
        ${data.bank_account.account_number ? `<tr><td class="label">Account Number</td><td style="font-family:monospace;">${data.bank_account.account_number}</td></tr>` : ""}
        ${data.bank_account.iban ? `<tr><td class="label">IBAN</td><td style="font-family:monospace;">${data.bank_account.iban}</td></tr>` : ""}
        ${data.bank_account.swift_bic ? `<tr><td class="label">SWIFT / BIC</td><td style="font-family:monospace;">${data.bank_account.swift_bic}</td></tr>` : ""}
        ${data.bank_account.branch ? `<tr><td class="label">Branch</td><td>${data.bank_account.branch}</td></tr>` : ""}
        ${data.bank_account.currency ? `<tr><td class="label">Currency</td><td>${data.bank_account.currency.toUpperCase()}</td></tr>` : ""}
      </table>
      <div style="font-size:10px;color:#666;margin-top:4px;">Please quote invoice number <strong>${data.invoice_number}</strong> as payment reference.</div>
    ` : ""}
    ${data.notes ? `<div style="margin-top:10px;"><span class="label">Notes: </span>${data.notes}</div>` : ""}
    <div class="footer-sigs">
      <div><div class="sig-line">Prepared By</div></div>
      <div><div class="sig-line">Authorized By</div></div>
    </div>
    <div class="security">
      <strong>DOCUMENT VERIFICATION</strong> | Hash: <span class="hash">${hash}</span> | Generated: ${dateStr(data.created_at)}
      <br/>⚠ VOID IF ALTERED — Verify via QR code scan.
    </div>
  </body></html>`;

  openPrintWindow(html);
}

// ═══════════════════════════════════════════════════
// PAYMENT RECEIPT TEMPLATE
// ═══════════════════════════════════════════════════
export interface PaymentReceiptData {
  payment_number: string;
  amount: number;
  payment_method: string;
  reference_number?: string | null;
  paid_at: string;
  notes?: string | null;
  invoice_number?: string | null;
  customer_name?: string | null;
  invoice_total?: number | null;
  currency?: string;
  depot?: { name: string; location?: string | null } | null;
}

const methodLabels: Record<string, string> = {
  bank_transfer: "Bank Transfer", cash: "Cash", cheque: "Cheque", credit_card: "Credit Card", other: "Other",
};

export async function printReceipt(data: PaymentReceiptData) {
  const qr = await generateQrDataUrl(JSON.stringify({
    receipt: data.payment_number, amount: data.amount, invoice: data.invoice_number,
  }));
  const barcode = generateBarcodeDataUrl(data.payment_number);
  const hash = await generateDocHash(`${data.payment_number}|${data.amount}|${data.invoice_number ?? ""}`);
  const curr = symbolForCurrency(data.currency || getOrgCurrency());
  const balance = data.invoice_total ? Math.max(0, data.invoice_total - data.amount) : null;
  const brand = await printableBrand(data.depot);

  const html = `<html><head><style>${docStyles()}</style></head><body>
    <div class="paid-stamp">PAID</div>
    <div class="header">
      <div>
        ${logoOrNameHtml(brand, brand.printableLogoUrl)}
        <div class="loc">${brand.location}</div>
      </div>
      <div class="codes"><img src="${qr}" width="90" height="90"/><img src="${barcode}" height="45"/></div>
    </div>
    <div class="title">PAYMENT RECEIPT</div>
    <div class="subtitle">${data.payment_number}</div>
    <table style="margin-bottom:12px;">
      <tr>
        <td class="label" style="width:15%;">Receipt No.</td>
        <td style="font-weight:bold;font-size:13px;">${data.payment_number}</td>
        <td class="label" style="width:15%;">Date</td>
        <td>${dateStr(data.paid_at)}</td>
      </tr>
      <tr>
        <td class="label">Customer</td>
        <td style="font-weight:bold;">${v(data.customer_name)}</td>
        <td class="label">Invoice Ref</td>
        <td class="amount">${v(data.invoice_number)}</td>
      </tr>
    </table>
    <div class="section">Payment Details</div>
    <table>
      <tr>
        <td class="label" style="width:20%;">Amount Paid</td>
        <td style="font-size:18px;font-weight:bold;color:#16a34a;" class="amount">${curr}${data.amount.toFixed(2)}</td>
      </tr>
      <tr>
        <td class="label">Payment Method</td>
        <td>${methodLabels[data.payment_method] ?? data.payment_method}</td>
      </tr>
      ${data.reference_number ? `<tr><td class="label">Reference #</td><td class="amount">${data.reference_number}</td></tr>` : ""}
      ${balance !== null ? `<tr><td class="label">Balance Remaining</td><td class="amount">${curr}${balance.toFixed(2)}</td></tr>` : ""}
    </table>
    ${data.notes ? `<div style="margin-top:10px;"><span class="label">Notes: </span>${data.notes}</div>` : ""}
    <div class="footer-sigs">
      <div><div class="sig-line">Received By</div></div>
      <div><div class="sig-line">Customer Signature</div></div>
    </div>
    <div class="security">
      <strong>DOCUMENT VERIFICATION</strong> | Hash: <span class="hash">${hash}</span> | Generated: ${dateStr(data.paid_at)}
      <br/>⚠ VOID IF ALTERED — Verify via QR code scan.
    </div>
  </body></html>`;

  openPrintWindow(html);
}

// ═══════════════════════════════════════════════════
// VENDOR PAYMENT VOUCHER TEMPLATE
// ═══════════════════════════════════════════════════
export interface VendorPaymentVoucherData {
  payment_number: string;
  amount: number;
  payment_method: string;
  reference_number?: string | null;
  paid_at: string;
  notes?: string | null;
  po_number?: string | null;
  supplier_name?: string | null;
  po_total?: number | null;
  conversion_number?: string | null;
  currency?: string;
  depot?: { name: string; location?: string | null } | null;
}

export async function printVendorReceipt(data: VendorPaymentVoucherData) {
  const qr = await generateQrDataUrl(JSON.stringify({
    voucher: data.payment_number, amount: data.amount, po: data.po_number,
  }));
  const barcode = generateBarcodeDataUrl(data.payment_number);
  const hash = await generateDocHash(`${data.payment_number}|${data.amount}|${data.po_number ?? ""}`);
  const curr = symbolForCurrency(data.currency || getOrgCurrency());
  const brand = await printableBrand(data.depot);

  const html = `<html><head><style>${docStyles()}</style></head><body>
    <div class="watermark">PAYMENT VOUCHER</div>
    <div class="paid-stamp">PAID</div>
    <div class="header">
      <div>
        ${logoOrNameHtml(brand, brand.printableLogoUrl)}
        <div class="loc">${brand.location}</div>
      </div>
      <div class="codes"><img src="${qr}" width="90" height="90"/><img src="${barcode}" height="45"/></div>
    </div>
    <div class="title">PAYMENT VOUCHER</div>
    <div class="subtitle">${data.payment_number}</div>
    <table style="margin-bottom:12px;">
      <tr>
        <td class="label" style="width:15%;">Voucher No.</td>
        <td style="font-weight:bold;font-size:13px;">${data.payment_number}</td>
        <td class="label" style="width:15%;">Date</td>
        <td>${dateStr(data.paid_at)}</td>
      </tr>
      <tr>
        <td class="label">Supplier</td>
        <td style="font-weight:bold;">${v(data.supplier_name)}</td>
        <td class="label">PO Ref</td>
        <td class="amount">${v(data.po_number)}</td>
      </tr>
      ${data.conversion_number ? `<tr><td class="label">Job Ref</td><td colspan="3">${data.conversion_number}</td></tr>` : ""}
    </table>
    <div class="section">Payment Details</div>
    <table>
      <tr>
        <td class="label" style="width:20%;">Amount Paid</td>
        <td style="font-size:18px;font-weight:bold;color:#dc2626;" class="amount">${curr}${data.amount.toFixed(2)}</td>
      </tr>
      <tr>
        <td class="label">Payment Method</td>
        <td>${methodLabels[data.payment_method] ?? data.payment_method}</td>
      </tr>
      ${data.reference_number ? `<tr><td class="label">Reference #</td><td class="amount">${data.reference_number}</td></tr>` : ""}
      ${data.po_total !== null && data.po_total !== undefined ? `<tr><td class="label">PO Total</td><td class="amount">${curr}${Number(data.po_total).toFixed(2)}</td></tr>` : ""}
    </table>
    ${data.notes ? `<div style="margin-top:10px;"><span class="label">Notes: </span>${data.notes}</div>` : ""}
    <div class="footer-sigs">
      <div><div class="sig-line">Prepared By</div></div>
      <div><div class="sig-line">Authorized By</div></div>
      <div><div class="sig-line">Supplier Acknowledgement</div></div>
    </div>
    <div class="security">
      <strong>DOCUMENT VERIFICATION</strong> | Hash: <span class="hash">${hash}</span> | Generated: ${dateStr(data.paid_at)}
      <br/>⚠ VOID IF ALTERED — Verify via QR code scan.
    </div>
  </body></html>`;

  openPrintWindow(html);
}

// ═══════════════════════════════════════════════════
// INSPECTION REPORT TEMPLATE
// ═══════════════════════════════════════════════════
export interface InspectionReportData {
  inspection_number: string;
  inspection_type: string;
  condition_grade: string;
  requires_repair: boolean;
  findings?: string | null;
  inspector_notes?: string | null;
  photos?: string[];
  created_at: string;
  container_number?: string | null;
  container_size?: string | null;
  container_category?: string | null;
  container_owner?: string | null;
  depot?: { name: string; location?: string | null } | null;
}

const typeLabels: Record<string, string> = {
  gate_in: "Gate In", periodic: "Periodic", pre_delivery: "Pre-Delivery", damage: "Damage",
};

export async function printInspectionReport(data: InspectionReportData) {
  const qr = await generateQrDataUrl(JSON.stringify({
    inspection: data.inspection_number, grade: data.condition_grade, container: data.container_number,
  }));
  const barcode = generateBarcodeDataUrl(data.inspection_number);
  const hash = await generateDocHash(`${data.inspection_number}|${data.condition_grade}|${data.container_number ?? ""}`);

  const gradeColors: Record<string, string> = { A: "#22c55e", B: "#3b82f6", C: "#eab308", D: "#ef4444" };
  const gradeLabels: Record<string, string> = { A: "Excellent", B: "Good", C: "Fair", D: "Poor" };
  const gc = gradeColors[data.condition_grade] ?? "#000";
  const brand = await printableBrand(data.depot);

  const photosHtml = data.photos?.length ? `
    <div class="section" style="margin-top:10px;">Condition Photos</div>
    <div class="photo-grid">${data.photos.map(url => `<img src="${url}" />`).join("")}</div>
  ` : "";

  const html = `<html><head><style>${docStyles()}</style></head><body>
    <div class="watermark">INSPECTION REPORT</div>
    <div class="header">
      <div>
        ${logoOrNameHtml(brand, brand.printableLogoUrl)}
        <div class="loc">${brand.location}</div>
      </div>
      <div class="codes"><img src="${qr}" width="90" height="90"/><img src="${barcode}" height="45"/></div>
    </div>
    <div class="title">INSPECTION REPORT</div>
    <div class="subtitle">${data.inspection_number}</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Report No.</td>
        <td style="font-weight:bold;">${data.inspection_number}</td>
        <td class="label" style="width:12%;">Date</td>
        <td>${dateStr(data.created_at)}</td>
        <td class="label" style="width:12%;">Type</td>
        <td>${typeLabels[data.inspection_type] ?? data.inspection_type}</td>
      </tr>
    </table>
    <div class="section" style="margin-top:10px;">Container Details</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Container</td>
        <td style="font-family:monospace;font-weight:bold;font-size:13px;">${v(data.container_number)}</td>
        <td class="label" style="width:12%;">Size</td>
        <td>${v(data.container_size)}ft</td>
        <td class="label" style="width:12%;">Category</td>
        <td style="text-transform:capitalize;">${v(data.container_category)}</td>
      </tr>
      <tr>
        <td class="label">Owner</td>
        <td colspan="5">${v(data.container_owner)}</td>
      </tr>
    </table>
    <div class="section" style="margin-top:10px;">Condition Assessment</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Grade</td>
        <td style="width:20%;"><span class="grade-box" style="border-color:${gc};color:${gc};">${data.condition_grade}</span> <span style="font-size:12px;margin-left:8px;">${gradeLabels[data.condition_grade] ?? ""}</span></td>
        <td class="label" style="width:15%;">Repair Needed</td>
        <td style="font-weight:bold;color:${data.requires_repair ? "#dc2626" : "#16a34a"};">${data.requires_repair ? "YES" : "NO"}</td>
      </tr>
    </table>
    <div class="section" style="margin-top:10px;">Findings</div>
    <table><tr><td style="min-height:50px;white-space:pre-wrap;">${v(data.findings)}</td></tr></table>
    ${data.inspector_notes ? `
      <div class="section" style="margin-top:10px;">Inspector Notes</div>
      <table><tr><td style="min-height:40px;white-space:pre-wrap;">${data.inspector_notes}</td></tr></table>
    ` : ""}
    ${photosHtml}
    <div class="footer-sigs">
      <div><div class="sig-line">Inspector Signature</div></div>
      <div><div class="sig-line">Supervisor Signature</div></div>
    </div>
    <div class="security">
      <strong>DOCUMENT VERIFICATION</strong> | Hash: <span class="hash">${hash}</span> | Generated: ${dateStr(data.created_at)}
      <br/>⚠ VOID IF ALTERED — Verify via QR code scan.
    </div>
  </body></html>`;

  openPrintWindow(html);
}

// ═══════════════════════════════════════════════════
// DAMAGE ESTIMATE TEMPLATE
// ═══════════════════════════════════════════════════
export interface DamageEstimatePrintData {
  estimate_number: string;
  description: string;
  repair_type: string;
  approval_status: string;
  labor_hours: number;
  labor_cost: number;
  material_cost: number;
  total_cost: number;
  currency: string;
  created_at: string;
  approved_at?: string | null;
  rejection_reason?: string | null;
  container_number?: string | null;
  inspection_number?: string | null;
  line_items?: Array<{ description: string; quantity: number; unit_cost: number; total_cost: number; part_number?: string | null }>;
  depot?: { name: string; location?: string | null } | null;
}

export async function printDamageEstimate(data: DamageEstimatePrintData) {
  const qr = await generateQrDataUrl(JSON.stringify({
    estimate: data.estimate_number, total: data.total_cost, status: data.approval_status,
  }));
  const barcode = generateBarcodeDataUrl(data.estimate_number);
  const hash = await generateDocHash(`${data.estimate_number}|${data.total_cost}|${data.approval_status}`);
  const curr = symbolForCurrency(data.currency || getOrgCurrency());

  const statusColors: Record<string, string> = {
    pending: "#eab308", approved: "#22c55e", rejected: "#ef4444", revised: "#3b82f6",
  };
  const sc = statusColors[data.approval_status] ?? "#000";
  const brand = await printableBrand(data.depot);

  const lineItemsHtml = data.line_items?.length ? data.line_items.map(li => `
    <tr>
      <td>${li.part_number ?? "—"}</td>
      <td>${li.description}</td>
      <td style="text-align:center;">${li.quantity}</td>
      <td style="text-align:right;" class="amount">${curr}${Number(li.unit_cost).toFixed(2)}</td>
      <td style="text-align:right;" class="amount">${curr}${Number(li.total_cost).toFixed(2)}</td>
    </tr>
  `).join("") : "";

  const html = `<html><head><style>${docStyles()}
    .approval-stamp { position: fixed; top: 35%; right: 60px; transform: rotate(-15deg); font-size: 36px; font-weight: bold; padding: 8px 24px; border-radius: 8px; border: 4px solid; opacity: 0.2; pointer-events: none; z-index: 0; text-transform: uppercase; }
  </style></head><body>
    <div class="watermark">DAMAGE ESTIMATE</div>
    <div class="approval-stamp" style="color:${sc};border-color:${sc};">${data.approval_status}</div>
    <div class="header">
      <div>
        ${logoOrNameHtml(brand, brand.printableLogoUrl)}
        <div class="loc">${brand.location}</div>
      </div>
      <div class="codes"><img src="${qr}" width="90" height="90"/><img src="${barcode}" height="45"/></div>
    </div>
    <div class="title">DAMAGE ESTIMATE</div>
    <div class="subtitle">${data.estimate_number}</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Estimate No.</td>
        <td style="font-weight:bold;">${data.estimate_number}</td>
        <td class="label" style="width:12%;">Date</td>
        <td>${dateStr(data.created_at)}</td>
        <td class="label" style="width:12%;">Status</td>
        <td style="font-weight:bold;color:${sc};text-transform:uppercase;">${data.approval_status}</td>
      </tr>
      <tr>
        <td class="label">Container</td>
        <td style="font-family:monospace;font-weight:bold;">${v(data.container_number)}</td>
        <td class="label">Inspection Ref</td>
        <td>${v(data.inspection_number)}</td>
        <td class="label">Repair Type</td>
        <td style="text-transform:capitalize;">${data.repair_type}</td>
      </tr>
    </table>
    <div class="section" style="margin-top:10px;">Damage Description</div>
    <table><tr><td style="min-height:40px;white-space:pre-wrap;">${data.description}</td></tr></table>
    ${data.line_items?.length ? `
      <div class="section" style="margin-top:10px;">Repair Parts & Materials</div>
      <table>
        <tr><th>Part #</th><th>Description</th><th style="width:8%;text-align:center;">Qty</th><th style="width:12%;text-align:right;">Unit Cost</th><th style="width:12%;text-align:right;">Total</th></tr>
        ${lineItemsHtml}
      </table>
    ` : ""}
    <div class="section" style="margin-top:10px;">Cost Summary</div>
    <table style="width:50%;margin-left:auto;">
      <tr><td class="label">Labor (${data.labor_hours}h)</td><td style="text-align:right;" class="amount">${curr}${data.labor_cost.toFixed(2)}</td></tr>
      <tr><td class="label">Materials</td><td style="text-align:right;" class="amount">${curr}${data.material_cost.toFixed(2)}</td></tr>
      <tr class="total-row"><td>TOTAL ESTIMATE</td><td style="text-align:right;font-size:14px;">${curr}${data.total_cost.toFixed(2)}</td></tr>
    </table>
    ${data.rejection_reason ? `<div style="margin-top:8px;color:#dc2626;"><span class="label">Rejection Reason: </span>${data.rejection_reason}</div>` : ""}
    ${data.approved_at ? `<div style="margin-top:4px;"><span class="label">Approved: </span>${dateStr(data.approved_at)}</div>` : ""}
    <div class="footer-sigs">
      <div><div class="sig-line">Prepared By</div></div>
      <div><div class="sig-line">Approved By</div></div>
      <div><div class="sig-line">Customer Acceptance</div></div>
    </div>
    <div class="security">
      <strong>DOCUMENT VERIFICATION</strong> | Hash: <span class="hash">${hash}</span> | Generated: ${dateStr(data.created_at)}
      <br/>⚠ VOID IF ALTERED — Verify via QR code scan.
    </div>
  </body></html>`;

  openPrintWindow(html);
}

// ═══════════════════════════════════════════════════
// SALE RECEIPT TEMPLATE
// ═══════════════════════════════════════════════════
export interface SaleReceiptData {
  sale_number: string;
  container_number: string;
  container_size?: string;
  container_category?: string;
  buyer_name: string;
  buyer_contact?: string | null;
  original_owner?: string | null;
  entry_price: number;
  markup_percentage: number;
  selling_price: number;
  sold_at: string;
  notes?: string | null;
  currency?: string;
  depot?: { name: string; location?: string | null; logo_url?: string | null } | null;
}

export async function printSaleReceipt(data: SaleReceiptData) {
  const qr = await generateQrDataUrl(JSON.stringify({
    sale: data.sale_number, amount: data.selling_price, buyer: data.buyer_name,
  }));
  const barcode = generateBarcodeDataUrl(data.sale_number);
  const hash = await generateDocHash(`${data.sale_number}|${data.selling_price}|${data.buyer_name}`);
  const curr = symbolForCurrency(data.currency || getOrgCurrency());
  const brand = await printableBrand(data.depot);

  const html = `<html><head><style>${docStyles()}</style></head><body>
    <div class="watermark">SALE RECEIPT</div>
    <div class="paid-stamp">SOLD</div>
    <div class="header">
      <div>
        ${logoOrNameHtml(brand, brand.printableLogoUrl)}
        <div class="loc">${brand.location}</div>
      </div>
      <div class="codes"><img src="${qr}" width="90" height="90"/><img src="${barcode}" height="45"/></div>
    </div>
    <div class="title">CONTAINER SALE RECEIPT</div>
    <div class="subtitle">${data.sale_number}</div>
    <table style="margin-bottom:12px;">
      <tr>
        <td class="label" style="width:15%;">Sale No.</td>
        <td style="font-weight:bold;font-size:13px;">${data.sale_number}</td>
        <td class="label" style="width:15%;">Date</td>
        <td>${dateStr(data.sold_at)}</td>
      </tr>
    </table>
    <div class="section">Seller</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Company</td>
        <td style="font-weight:bold;">${brand.name}</td>
        <td class="label" style="width:15%;">Location</td>
        <td>${(brand.location || "—")}</td>
      </tr>
    </table>
    <div class="section">Buyer</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Name</td>
        <td style="font-weight:bold;">${data.buyer_name}</td>
        <td class="label" style="width:15%;">Contact</td>
        <td>${v(data.buyer_contact)}</td>
      </tr>
    </table>
    <div class="section">Container Details</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Container #</td>
        <td style="font-weight:bold;font-size:13px;">${data.container_number}</td>
        <td class="label" style="width:12%;">Size</td>
        <td>${data.container_size ?? "—"}ft</td>
        <td class="label" style="width:12%;">Type</td>
        <td style="text-transform:capitalize;">${data.container_category ?? "—"}</td>
      </tr>
      <tr>
        <td class="label">Previous Owner</td>
        <td colspan="5">${v(data.original_owner)}</td>
      </tr>
    </table>
    <div class="section">Sale Summary</div>
    <table>
      <tr>
        <td class="label" style="width:20%;">Sale Price</td>
        <td style="font-size:18px;font-weight:bold;color:#16a34a;" class="amount">${curr}${data.selling_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </table>
    ${data.notes ? `<div style="margin-top:10px;"><span class="label">Notes: </span>${data.notes}</div>` : ""}
    <div class="footer-sigs">
      <div><div class="sig-line">Seller Signature</div></div>
      <div><div class="sig-line">Buyer Signature</div></div>
    </div>
    <div class="security">
      <strong>DOCUMENT VERIFICATION</strong> | Hash: <span class="hash">${hash}</span> | Generated: ${dateStr(data.sold_at)}
      <br/>⚠ VOID IF ALTERED — Verify via QR code scan.
    </div>
  </body></html>`;

  openPrintWindow(html);
}

// ═══════════════════════════════════════════════════
// QUOTE TEMPLATE
// ═══════════════════════════════════════════════════
export interface QuotePrintData {
  quote_number: string;
  status: string;
  created_at: string;
  valid_until?: string | null;
  notes?: string | null;
  customer?: { company_name?: string | null; tax_id?: string | null; email?: string | null; phone?: string | null } | null;
  organization?: { name?: string | null; tax_id?: string | null; address?: string | null; logo_url?: string | null } | null;
  issuer_name?: string | null;
  sections: Array<{
    id: string;
    title: string;
    kind: string;
    items: Array<{
      description: string;
      unit?: string | null;
      quantity: number;
      unit_price: number;
      discount_pct: number;
      tax_pct: number;
      total_price: number;
    }>;
  }>;
  visuals?: Array<{
    id?: string;
    section_id?: string | null;
    kind: string;
    image_url: string;
    caption?: string | null;
  }>;
}


export async function printQuote(data: QuotePrintData) {
  const subtotalGross = data.sections.flatMap(s => s.items)
    .reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
  const totalDiscount = data.sections.flatMap(s => s.items)
    .reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0) * (Number(it.discount_pct || 0) / 100), 0);
  const totalTax = data.sections.flatMap(s => s.items).reduce((s, it) => {
    const net = Number(it.quantity || 0) * Number(it.unit_price || 0) * (1 - Number(it.discount_pct || 0) / 100);
    return s + net * (Number(it.tax_pct || 0) / 100);
  }, 0);
  const grandTotal = data.sections.flatMap(s => s.items).reduce((s, it) => s + Number(it.total_price || 0), 0);

  const qr = await generateQrDataUrl(JSON.stringify({ q: data.quote_number, total: grandTotal }));
  const hash = await generateDocHash(JSON.stringify({ n: data.quote_number, t: grandTotal, c: data.created_at }));
  const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const brand = await printableBrand({
    name: data.organization?.name ?? undefined,
    location: data.organization?.address ?? null,
    logo_url: data.organization?.logo_url ?? null,
    tax_id: data.organization?.tax_id ?? null,
  });

  const visuals = data.visuals ?? [];
  const coverVisual = visuals.find(v => v.kind === "cover") ?? visuals.find(v => v.kind === "render" && !v.section_id);
  const visualsBySection = new Map<string, typeof visuals>();
  for (const vis of visuals) {
    if (!vis.section_id) continue;
    const arr = visualsBySection.get(vis.section_id) ?? [];
    arr.push(vis);
    visualsBySection.set(vis.section_id, arr);
  }
  const appendixVisuals = visuals.filter(v => v.kind !== "cover");

  const sectionTables = data.sections.map((sec) => {
    const subtotal = sec.items.reduce((s, it) => s + Number(it.total_price || 0), 0);
    const sectionVisuals = visualsBySection.get(sec.id) ?? [];
    const banner = sectionVisuals.length
      ? `<div style="margin:14px 0 6px"><img src="${sectionVisuals[0].image_url}" style="width:100%;max-height:170px;object-fit:cover;border-radius:6px"/></div>`
      : "";
    const rows = sec.items.length ? sec.items.map(it => `
      <tr>
        <td>${v(it.description)}</td>
        <td>${v(it.unit ?? "")}</td>
        <td style="text-align:right">${Number(it.quantity).toLocaleString()}</td>
        <td style="text-align:right" class="amount">${fmt(it.unit_price)}</td>
        <td style="text-align:right">${Number(it.discount_pct || 0)}%</td>
        <td style="text-align:right">${Number(it.tax_pct || 0)}%</td>
        <td style="text-align:right" class="amount">${fmt(it.total_price)}</td>
      </tr>
    `).join("") : `<tr><td colspan="7" style="text-align:center;color:#888">No items</td></tr>`;

    return `
      ${banner}
      <div class="section">${v(sec.title)}</div>

      <table>
        <thead>
          <tr>
            <th>Description</th><th>Unit</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Unit Price</th>
            <th style="text-align:right">Disc %</th>
            <th style="text-align:right">Tax %</th>
            <th style="text-align:right">Line Total</th>
          </tr>
        </thead>
        <tbody>${rows}
          <tr>
            <td colspan="6" style="text-align:right;font-weight:bold;background:#f5f5f5">Section Subtotal</td>
            <td style="text-align:right;font-weight:bold;background:#f5f5f5" class="amount">${fmt(subtotal)}</td>
          </tr>
        </tbody>
      </table>
    `;
  }).join("");

  const sectionSummaryRows = data.sections.map(sec => {
    const subtotal = sec.items.reduce((s, it) => s + Number(it.total_price || 0), 0);
    return `<tr><td>${v(sec.title)}</td><td style="text-align:right" class="amount">${fmt(subtotal)}</td></tr>`;
  }).join("");

  const coverPage = coverVisual ? `
<div style="page-break-after:always;position:relative;height:96vh;background:#0f172a;color:#fff;border-radius:8px;overflow:hidden">
  <img src="${coverVisual.image_url}" style="width:100%;height:100%;object-fit:cover;opacity:0.85"/>
  <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.0) 50%,rgba(0,0,0,0.75) 100%)"></div>
  <div style="position:absolute;left:32px;right:32px;bottom:32px">
    <div style="font-size:12px;letter-spacing:3px;opacity:0.85">QUOTATION</div>
    <div style="font-size:38px;font-weight:800;margin-top:4px">${v(data.quote_number)}</div>
    <div style="font-size:14px;margin-top:8px;opacity:0.9">Prepared for <strong>${v(data.customer?.company_name)}</strong></div>
    <div style="font-size:14px;opacity:0.85">${v(data.organization?.name)} · ${dateStr(data.created_at)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:14px">Total: ${fmt(grandTotal)}</div>
  </div>
</div>` : "";

  const appendixHtml = appendixVisuals.length ? `
<div style="page-break-before:always"></div>
<div class="title" style="margin-top:8px">Renders &amp; Plans</div>
<div class="subtitle">Appendix · ${appendixVisuals.length} visual${appendixVisuals.length>1?"s":""}</div>
${appendixVisuals.map(av => `
  <div style="margin:12px 0;page-break-inside:avoid">
    <img src="${av.image_url}" style="width:100%;max-height:520px;object-fit:contain;border:1px solid #e5e7eb;border-radius:6px"/>
    <div style="font-size:11px;color:#475569;margin-top:4px">
      <span style="text-transform:uppercase;letter-spacing:1px;font-weight:700;color:#0f172a">${av.kind.replace("_"," ")}</span>
      ${av.caption ? ` · ${v(av.caption)}` : ""}
    </div>
  </div>`).join("")}` : "";

  const html = `
<!doctype html><html><head><meta charset="utf-8"><title>Quote ${data.quote_number}</title>
<style>${docStyles()}</style></head>
<body>
${coverPage}
<div class="watermark">QUOTATION</div>
<div class="header">
  <div>
    ${logoOrNameHtml(brand, brand.printableLogoUrl)}
    <div class="loc">${v(brand.location)}</div>
    ${brand.tax_id ? `<div class="loc">Tax ID: ${brand.tax_id}</div>` : ""}
  </div>
  <div class="codes">
    <img src="${qr}" width="90" height="90" alt="qr" />
  </div>
</div>
<div class="title">Quotation</div>
<div class="subtitle">${data.quote_number} · ${dateStr(data.created_at)} · Status: ${v(data.status)}</div>


<table style="margin-bottom:8px">
  <tr>
    <td style="width:50%;border:none;vertical-align:top">
      <div class="label">Bill To</div>
      <div style="font-weight:bold;font-size:12px">${v(data.customer?.company_name)}</div>
      ${data.customer?.tax_id ? `<div>Tax ID: ${data.customer.tax_id}</div>` : ""}
      ${data.customer?.email ? `<div>${data.customer.email}</div>` : ""}
      ${data.customer?.phone ? `<div>${data.customer.phone}</div>` : ""}
    </td>
    <td style="width:50%;border:none;vertical-align:top">
      <div class="label">Validity</div>
      <div>Valid until: <strong>${data.valid_until ? dateStr(data.valid_until) : "—"}</strong></div>
      ${data.notes ? `<div style="margin-top:6px"><span class="label">Notes</span><br/>${v(data.notes)}</div>` : ""}
    </td>
  </tr>
</table>

${sectionTables}

<div class="section">Summary</div>
<table>
  <thead><tr><th>Section</th><th style="text-align:right;width:30%">Subtotal</th></tr></thead>
  <tbody>
    ${sectionSummaryRows}
    <tr><td style="text-align:right">Subtotal (gross)</td><td style="text-align:right" class="amount">${fmt(subtotalGross)}</td></tr>
    <tr><td style="text-align:right">Total Discount</td><td style="text-align:right" class="amount">−${fmt(totalDiscount)}</td></tr>
    <tr><td style="text-align:right">Total Tax</td><td style="text-align:right" class="amount">${fmt(totalTax)}</td></tr>
    <tr class="total-row"><td style="text-align:right">GRAND TOTAL</td><td style="text-align:right" class="amount">${fmt(grandTotal)}</td></tr>
  </tbody>
</table>

<div class="footer-sigs">
  <div class="sig-line">Prepared by${data.issuer_name ? ` — ${data.issuer_name}` : ""}</div>
  <div class="sig-line">Customer Acceptance</div>
</div>

<div class="security">
  Document hash: <span class="hash">${hash}</span> · Generated ${dateStr(new Date().toISOString())}
</div>

${appendixHtml}

</body></html>`;

  openPrintWindow(html);
}

// ═══════════════════════════════════════════════════
// PURCHASE ORDER TEMPLATE
// ═══════════════════════════════════════════════════
export interface PurchaseOrderPrintData {
  po_number: string;
  status: string;
  created_at: string;
  total_cost: number;
  currency?: string;
  notes?: string | null;
  conversion_number?: string | null;
  supplier?: {
    name: string;
    contact_person?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  } | null;
  line_items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total_cost: number;
  }>;
  depot?: { name: string; location?: string | null; code?: string; logo_url?: string | null } | null;
  issuer_name?: string | null;
}

export async function printPurchaseOrder(data: PurchaseOrderPrintData) {
  const qr = await generateQrDataUrl(JSON.stringify({
    po: data.po_number, total: data.total_cost, supplier: data.supplier?.name,
  }));
  const barcode = generateBarcodeDataUrl(data.po_number);
  const hash = await generateDocHash(`${data.po_number}|${data.total_cost}|${data.supplier?.name ?? ""}`);
  const curr = symbolForCurrency(data.currency || getOrgCurrency());
  const fmt = (n: number) => `${curr}${Number(n || 0).toFixed(2)}`;
  const brand = await printableBrand(data.depot);

  const itemsHtml = data.line_items.map((li, i) => `
    <tr>
      <td style="width:32px;text-align:center">${i + 1}</td>
      <td>${v(li.description)}</td>
      <td style="text-align:right" class="amount">${Number(li.quantity).toLocaleString()}</td>
      <td style="text-align:right" class="amount">${fmt(li.unit_price)}</td>
      <td style="text-align:right" class="amount">${fmt(li.total_cost)}</td>
    </tr>`).join("");

  const subtotal = data.line_items.reduce((s, li) => s + Number(li.total_cost || 0), 0);

  const html = `<html><head><style>${docStyles()}</style></head><body>
    <div class="watermark">PURCHASE ORDER</div>
    <div class="header">
      <div>
        ${logoOrNameHtml(brand, brand.printableLogoUrl, "max-height:50px;margin-bottom:4px")}
        <div class="loc">${brand.location}</div>
      </div>
      <div class="codes"><img src="${qr}" width="90" height="90"/><img src="${barcode}" height="45"/></div>
    </div>
    <div class="title">PURCHASE ORDER</div>
    <div class="subtitle">${data.po_number} · ${data.status.toUpperCase()}</div>

    <table style="margin-bottom:10px;">
      <tr>
        <td class="label" style="width:15%;">PO No.</td>
        <td style="font-weight:bold;">${data.po_number}</td>
        <td class="label" style="width:12%;">Date</td>
        <td>${dateStr(data.created_at)}</td>
      </tr>
      <tr>
        <td class="label">Status</td>
        <td style="text-transform:uppercase;font-weight:bold;">${data.status}</td>
        <td class="label">Job Ref</td>
        <td>${v(data.conversion_number)}</td>
      </tr>
    </table>

    <div class="section">Supplier</div>
    <table>
      <tr>
        <td class="label" style="width:15%;">Name</td>
        <td style="font-weight:bold;">${v(data.supplier?.name)}</td>
        <td class="label" style="width:15%;">Contact</td>
        <td>${v(data.supplier?.contact_person)}</td>
      </tr>
      <tr>
        <td class="label">Phone</td>
        <td>${v(data.supplier?.phone)}</td>
        <td class="label">Email</td>
        <td>${v(data.supplier?.email)}</td>
      </tr>
      ${data.supplier?.address ? `<tr><td class="label">Address</td><td colspan="3">${data.supplier.address}</td></tr>` : ""}
    </table>

    <div class="section">Line Items</div>
    <table>
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Description</th>
          <th style="text-align:right;width:80px">Qty</th>
          <th style="text-align:right;width:110px">Unit Price</th>
          <th style="text-align:right;width:120px">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml || `<tr><td colspan="5" style="text-align:center;color:#888;">No line items</td></tr>`}
        <tr class="total-row">
          <td colspan="4" style="text-align:right">GRAND TOTAL</td>
          <td style="text-align:right" class="amount">${fmt(data.total_cost || subtotal)}</td>
        </tr>
      </tbody>
    </table>

    ${data.notes ? `<div style="margin-top:10px;"><span class="label">Notes: </span>${data.notes}</div>` : ""}

    <div class="footer-sigs">
      <div><div class="sig-line">Prepared By${data.issuer_name ? ` — ${data.issuer_name}` : ""}</div></div>
      <div><div class="sig-line">Authorized By</div></div>
      <div><div class="sig-line">Supplier Acknowledgement</div></div>
    </div>

    <div class="security">
      <strong>DOCUMENT VERIFICATION</strong> | Hash: <span class="hash">${hash}</span> | Generated: ${dateStr(new Date().toISOString())}
      <br/>⚠ VOID IF ALTERED — Verify via QR code scan.
    </div>
  </body></html>`;

  openPrintWindow(html);
}
