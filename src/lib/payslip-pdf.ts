import { format } from "date-fns";
import { getAppSettings, symbolForCurrency as symbolFor } from "@/lib/app-settings";
import { toPrintableImageUrl } from "@/lib/print-assets";

type Line = { line_type: "earning" | "deduction" | "contribution"; label: string; amount: number };

export interface PayslipPdfSettings {
  logo_url?: string | null;
  header_address?: string | null;
  footer_text?: string | null;
  signature_block_text?: string | null;
  currency_code?: string;
  currency_symbol?: string;
  currency_position?: "before" | "after";
  decimal_places?: number;
  accent_color?: string;
}

export interface PayslipPdfData {
  reference: string;
  status: string;
  pay_date: string;
  period_start: string;
  period_end: string;
  description?: string | null;
  gross_pay: number;
  total_deductions: number;
  total_contributions: number;
  net_pay: number;
  employee: { name: string; code?: string | null; email?: string | null; division?: string | null; tax_id?: string | null };
  organization?: { name?: string | null; logo_url?: string | null; address?: string | null; tax_id?: string | null };
  lines: Line[];
  approval?: { approver?: string | null; approved_at?: string | null; comment?: string | null } | null;
  settings?: PayslipPdfSettings;
  language?: string;
}

const DEFAULTS: Required<PayslipPdfSettings> = {
  logo_url: "",
  header_address: "",
  footer_text: "",
  signature_block_text: "",
  currency_code: "USD",
  currency_symbol: "$",
  currency_position: "before",
  decimal_places: 2,
  accent_color: "#1e3a5f",
};

function resolveSettings(s?: PayslipPdfSettings): Required<PayslipPdfSettings> {
  const app = getAppSettings();
  const merged = { ...DEFAULTS, ...(s ?? {}) } as Required<PayslipPdfSettings>;
  // Always prefer the org-wide settings when the caller hasn't explicitly
  // overridden them — this guarantees Default Currency / decimals changes in
  // Settings propagate instantly to every generated payslip.
  if (!s?.currency_code) {
    merged.currency_code = app.currency;
    merged.currency_symbol = symbolFor(app.currency);
  } else if (!s?.currency_symbol) {
    merged.currency_symbol = symbolFor(merged.currency_code);
  }
  if (s?.currency_position == null) merged.currency_position = app.currencyPosition;
  if (s?.decimal_places == null) merged.decimal_places = app.decimalPlaces;
  return merged;
}

function makeFmt(s: Required<PayslipPdfSettings>) {
  return (n: number) => {
    const v = Number(n ?? 0).toFixed(s.decimal_places);
    return s.currency_position === "before" ? `${s.currency_symbol}${v}` : `${v} ${s.currency_symbol}`;
  };
}

export function buildPayslipHtml(d: PayslipPdfData): string {
  const s = resolveSettings(d.settings);
  const fmt = makeFmt(s);
  const accent = s.accent_color;
  const earnings = d.lines.filter((l) => l.line_type === "earning");
  const deductions = d.lines.filter((l) => l.line_type === "deduction");
  const contributions = d.lines.filter((l) => l.line_type === "contribution");
  const dir = (d.language === "ar") ? "rtl" : "ltr";

  const renderLines = (rows: Line[]) =>
    rows.length === 0
      ? `<tr><td colspan="2" style="text-align:center;color:#999">—</td></tr>`
      : rows.map((l) => `<tr><td>${escape(l.label)}</td><td class="amt">${fmt(Number(l.amount))}</td></tr>`).join("");

  const statusUpper = (d.status || "").toUpperCase();
  const watermark = d.status === "draft"
    ? `<div class="wm">DRAFT</div>`
    : d.status === "void"
      ? `<div class="wm" style="color:rgba(220,38,38,.15)">VOID</div>`
      : d.status === "paid"
        ? `<div class="paid-stamp">PAID</div>`
        : "";

  const approvalBlock = d.approval && d.approval.approved_at
    ? `<div class="approval">Approved by ${escape(d.approval.approver ?? "—")} on ${format(new Date(d.approval.approved_at), "dd MMM yyyy HH:mm")}${d.approval.comment ? ` — “${escape(d.approval.comment)}”` : ""}</div>`
    : "";

  // Working depot (from header switcher) wins over org-level branding so
  // payslips always match the depot the user is operating from.
  const wd = getAppSettings().workingDepotBrand;
  const logo = s.logo_url || wd?.logoUrl || d.organization?.logo_url || "";
  const address = s.header_address || wd?.location || d.organization?.address || "";
  const orgName = wd?.name || d.organization?.name || "Organization";
  const taxId = wd?.taxId || d.organization?.tax_id || "";
  const footerExtra = s.footer_text ? `<div class="footer-extra">${escape(s.footer_text)}</div>` : "";
  const signature = s.signature_block_text
    ? `<div class="signature"><div class="line"></div><div class="sig-text">${escape(s.signature_block_text)}</div></div>`
    : "";

  return `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>Payslip ${escape(d.reference)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;padding:15mm;position:relative;direction:${dir}}
  .header{display:flex;justify-content:space-between;border-bottom:3px solid ${accent};padding-bottom:10px;margin-bottom:12px}
  .org h1{font-size:16px;color:${accent}}
  .org .meta{font-size:9px;color:#666;margin-top:2px;white-space:pre-line}
  .doc-title{text-align:right}
  .doc-title h2{font-size:18px;letter-spacing:2px;color:${accent}}
  .doc-title .ref{font-family:monospace;color:#444;margin-top:2px}
  .status-pill{display:inline-block;padding:2px 10px;border-radius:12px;font-size:9px;font-weight:bold;margin-top:4px;background:#f0f4f8;color:${accent};border:1px solid #d0dae8}
  .emp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:#f7f9fc;padding:10px;border-radius:6px;margin-bottom:12px}
  .emp .lbl{font-size:8px;color:#777;text-transform:uppercase;font-weight:bold}
  .emp .val{font-size:11px;margin-top:2px}
  table{border-collapse:collapse;width:100%;margin-bottom:10px}
  th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}
  th{background:${accent};color:#fff;font-size:10px;text-transform:uppercase}
  .amt{font-family:monospace;text-align:right;width:140px}
  .totals{margin-top:8px;border:2px solid ${accent};padding:10px}
  .totals .row{display:flex;justify-content:space-between;margin:2px 0;font-size:11px}
  .totals .net{font-size:16px;font-weight:bold;border-top:2px solid ${accent};padding-top:6px;margin-top:6px;color:${accent}}
  .signature{margin-top:30px;width:240px}
  .signature .line{border-top:1px solid #333;margin-bottom:4px}
  .signature .sig-text{font-size:10px;color:#444;white-space:pre-line}
  .footer{margin-top:18px;font-size:9px;color:#666;border-top:1px dashed #999;padding-top:6px;display:flex;justify-content:space-between}
  .footer-extra{margin-top:6px;font-size:9px;color:#555;text-align:center;font-style:italic;white-space:pre-line}
  .wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:120px;font-weight:bold;color:rgba(0,0,0,.06);pointer-events:none;z-index:0;letter-spacing:10px}
  .paid-stamp{position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-25deg);font-size:60px;font-weight:bold;color:rgba(34,197,94,.18);border:6px solid rgba(34,197,94,.18);padding:10px 30px;border-radius:12px;pointer-events:none;z-index:0}
  .approval{margin:8px 0;padding:6px 10px;background:#ecfdf5;border-left:3px solid #10b981;font-size:10px;color:#065f46}
  @media print{body{padding:10mm}@page{size:A4;margin:10mm}}
</style></head><body>
${watermark}
<div class="header">
  <div class="org">
    ${logo ? `<img src="${escape(logo)}" style="max-height:50px;margin-bottom:4px"/>` : ""}
    <h1>${escape(orgName)}</h1>
    <div class="meta">${escape(address)}</div>
    ${taxId ? `<div class="meta">Tax ID: ${escape(taxId)}</div>` : ""}
  </div>
  <div class="doc-title">
    <h2>PAYSLIP</h2>
    <div class="ref">${escape(d.reference)}</div>
    <div class="status-pill">${escape(statusUpper)}</div>
  </div>
</div>

${approvalBlock}

<div class="emp">
  <div><div class="lbl">Employee</div><div class="val">${escape(d.employee.name)}</div></div>
  <div><div class="lbl">Code</div><div class="val">${escape(d.employee.code ?? "—")}</div></div>
  <div><div class="lbl">Division</div><div class="val">${escape(d.employee.division ?? "—")}</div></div>
  <div><div class="lbl">Tax ID</div><div class="val">${escape(d.employee.tax_id ?? "—")}</div></div>
  <div><div class="lbl">Pay date</div><div class="val">${escape(d.pay_date)}</div></div>
  <div><div class="lbl">Period</div><div class="val">${escape(d.period_start)} → ${escape(d.period_end)}</div></div>
  <div><div class="lbl">Email</div><div class="val">${escape(d.employee.email ?? "—")}</div></div>
  <div><div class="lbl">Currency</div><div class="val">${escape(s.currency_code)}</div></div>
</div>

<table><thead><tr><th>Earnings</th><th class="amt">Amount</th></tr></thead><tbody>${renderLines(earnings)}</tbody></table>
<table><thead><tr><th>Deductions</th><th class="amt">Amount</th></tr></thead><tbody>${renderLines(deductions)}</tbody></table>
<table><thead><tr><th>Employer Contributions</th><th class="amt">Amount</th></tr></thead><tbody>${renderLines(contributions)}</tbody></table>

<div class="totals">
  <div class="row"><span>Gross Pay</span><span class="amt">${fmt(d.gross_pay)}</span></div>
  <div class="row"><span>Total Deductions</span><span class="amt">- ${fmt(d.total_deductions)}</span></div>
  <div class="row"><span>Total Contributions (employer)</span><span class="amt">${fmt(d.total_contributions)}</span></div>
  <div class="row net"><span>NET PAY</span><span class="amt">${fmt(d.net_pay)}</span></div>
</div>

${signature}

<div class="footer">
  <div>Generated ${format(new Date(), "dd MMM yyyy HH:mm")}</div>
  <div>Reference: ${escape(d.reference)}</div>
</div>
${footerExtra}
</body></html>`;
}

function escape(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function downloadPayslipPdf(data: PayslipPdfData) {
  void (async () => {
    const wd = getAppSettings().workingDepotBrand;
    const logo = wd?.logoUrl || data.settings?.logo_url || data.organization?.logo_url || "";
    const html = buildPayslipHtml({
      ...data,
      settings: { ...(data.settings ?? {}), logo_url: await toPrintableImageUrl(logo) },
    });
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
  })();
}

/** Print/export many payslips as one continuous document (one payslip per page). */
export function downloadPayslipBatchPdf(items: PayslipPdfData[], title = "Payroll payslips") {
  void (async () => {
    if (items.length === 0) return;
    const wd = getAppSettings().workingDepotBrand;
    const docs: string[] = [];
    for (const data of items) {
      const logo = wd?.logoUrl || data.settings?.logo_url || data.organization?.logo_url || "";
      docs.push(
        buildPayslipHtml({
          ...data,
          settings: { ...(data.settings ?? {}), logo_url: await toPrintableImageUrl(logo) },
        }),
      );
    }
    const head = docs[0].split("</head>")[0] + "</head>";
    const bodies = docs
      .map((h) => h.split("<body>")[1]?.split("</body>")[0] ?? "")
      .map((b) => `<section style="page-break-after:always">${b}</section>`)
      .join("\n");
    const html = `${head.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)}<body>${bodies}</body></html>`;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  })();
}

