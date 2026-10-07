import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { CATEGORY_LABELS, type ContainerCategory } from "@/lib/container-constants";

const CATEGORY_ORDER: ContainerCategory[] = ["dry", "reefer", "tank", "flat_rack", "open_top"];

const ALL_STATUSES = [
  "available", "allocated", "damaged", "repair_pending", "in_repair",
  "hold", "in_conversion", "converted", "on_lease", "sold", "booked_for_repatriation",
];

export type ExportContainer = any;

export async function fetchAllContainersForExport(): Promise<ExportContainer[]> {
  const pageSize = 1000;
  let from = 0;
  const all: ExportContainer[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("containers")
      .select("*, yard_blocks(name), depots!containers_depot_id_fkey(name)")
      .order("container_number")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function groupByCategory(rows: ExportContainer[]) {
  const groups = new Map<string, ExportContainer[]>();
  for (const cat of CATEGORY_ORDER) groups.set(cat, []);
  const other: ExportContainer[] = [];
  for (const r of rows) {
    const key = r.category as string;
    if (groups.has(key)) groups.get(key)!.push(r);
    else other.push(r);
  }
  if (other.length) groups.set("other", other);
  return groups;
}

const SHEET_HEADERS = [
  "Container #", "Size", "Height", "ISO Type", "Status", "Owner", "Shipping Line",
  "Depot", "Block", "Bay", "Row", "Tier", "Empty?",
  "Tare (kg)", "Weight (kg)", "Gate In", "Gate Out", "Notes",
];

function rowToArray(c: ExportContainer): (string | number)[] {
  return [
    c.container_number ?? "",
    c.size ? `${c.size}'` : "",
    c.height_class ?? "",
    c.iso_type ?? "",
    String(c.status ?? "").replace(/_/g, " "),
    c.owner ?? "",
    c.shipping_line ?? "",
    c.depots?.name ?? "",
    c.yard_blocks?.name ?? "",
    c.bay ?? "",
    c.row ?? "",
    c.tier ?? "",
    c.is_empty ? "Yes" : "No",
    c.tare_weight_kg ?? "",
    c.weight_kg ?? "",
    c.gate_in_at ? format(new Date(c.gate_in_at), "yyyy-MM-dd HH:mm") : "",
    c.gate_out_at ? format(new Date(c.gate_out_at), "yyyy-MM-dd HH:mm") : "",
    c.notes ?? "",
  ];
}

export function exportInventoryXlsx(rows: ExportContainer[]) {
  const wb = XLSX.utils.book_new();
  const groups = groupByCategory(rows);

  // Summary sheet
  const summaryHeader = ["Category", ...ALL_STATUSES.map((s) => s.replace(/_/g, " ")), "Total"];
  const summaryRows: (string | number)[][] = [];
  for (const [cat, list] of groups.entries()) {
    const counts = ALL_STATUSES.map((s) => list.filter((r) => r.status === s).length);
    const label = (CATEGORY_LABELS as any)[cat] ?? cat;
    summaryRows.push([label, ...counts, list.length]);
  }
  summaryRows.push([
    "TOTAL",
    ...ALL_STATUSES.map((s) => rows.filter((r) => r.status === s).length),
    rows.length,
  ]);
  const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
  summaryWs["!cols"] = summaryHeader.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  // One sheet per category
  for (const [cat, list] of groups.entries()) {
    const label = (CATEGORY_LABELS as any)[cat] ?? cat;
    const ws = XLSX.utils.aoa_to_sheet([SHEET_HEADERS, ...list.map(rowToArray)]);
    ws["!cols"] = SHEET_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
    const safeName = String(label).slice(0, 31).replace(/[\\/?*[\]:]/g, " ");
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  XLSX.writeFile(wb, `inventory_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}

// ── PDF (landscape, multi-section) ──────────────────────────
const PDF_HEADERS = [
  "Container #", "Size", "Height", "Status", "Owner", "Shipping Line",
  "Depot", "Block", "Bay/Row/Tier", "Empty", "Gate In",
];

function pdfRow(c: ExportContainer): string[] {
  return [
    c.container_number ?? "",
    c.size ? `${c.size}'` : "",
    c.height_class ?? "",
    String(c.status ?? "").replace(/_/g, " "),
    c.owner ?? "",
    c.shipping_line ?? "",
    c.depots?.name ?? "",
    c.yard_blocks?.name ?? "",
    [c.bay, c.row, c.tier].filter((v) => v != null && v !== "").join("/") || "—",
    c.is_empty ? "Y" : "N",
    c.gate_in_at ? format(new Date(c.gate_in_at), "dd MMM yyyy") : "—",
  ];
}

function pdfEscape(str: string) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]/g, " ");
}

export function exportInventoryPdf(rows: ExportContainer[]) {
  const groups = groupByCategory(rows);
  const pageW = 842; // A4 landscape
  const pageH = 595;
  const margin = 30;
  const usableW = pageW - 2 * margin;
  const colW = usableW / PDF_HEADERS.length;
  const rowH = 14;
  const headerRowH = 18;
  const sectionGap = 18;
  const fontSize = 7;
  const headerFontSize = 8;

  const pages: string[] = [];
  let current = "";
  let y = 0;

  const newPage = () => {
    if (current) pages.push(current);
    current = "";
    y = pageH - margin;
    current += `BT /F2 12 Tf ${margin} ${y} Td (Inventory Report) Tj ET\n`;
    current += `BT /F1 8 Tf ${margin + 200} ${y} Td (Generated: ${pdfEscape(format(new Date(), "dd MMM yyyy HH:mm"))}  ·  ${rows.length} containers) Tj ET\n`;
    y -= 22;
  };

  const drawTableHeader = () => {
    current += `0.9 0.9 0.9 rg ${margin} ${y - 4} ${usableW} ${headerRowH} re f 0 0 0 rg\n`;
    PDF_HEADERS.forEach((h, i) => {
      current += `BT /F2 ${headerFontSize} Tf ${margin + i * colW + 3} ${y + 3} Td (${pdfEscape(h)}) Tj ET\n`;
    });
    y -= headerRowH;
  };

  const drawRow = (row: string[]) => {
    if (y - rowH < margin) {
      newPage();
      drawTableHeader();
    }
    current += `0.88 0.88 0.88 RG ${margin} ${y - 2} m ${pageW - margin} ${y - 2} l S 0 0 0 RG\n`;
    row.forEach((cell, i) => {
      const truncated = String(cell ?? "").substring(0, Math.floor(colW / 3.5));
      current += `BT /F1 ${fontSize} Tf ${margin + i * colW + 3} ${y + 2} Td (${pdfEscape(truncated)}) Tj ET\n`;
    });
    y -= rowH;
  };

  const drawSectionTitle = (title: string, count: number) => {
    if (y - 30 < margin) newPage();
    y -= sectionGap;
    current += `BT /F2 11 Tf ${margin} ${y} Td (${pdfEscape(title)}  (${count})) Tj ET\n`;
    y -= 14;
  };

  newPage();

  for (const [cat, list] of groups.entries()) {
    if (!list.length) continue;
    const label = (CATEGORY_LABELS as any)[cat] ?? cat;
    drawSectionTitle(label, list.length);
    drawTableHeader();
    list.forEach((c) => drawRow(pdfRow(c)));
  }

  if (current) pages.push(current);

  // Assemble PDF
  const objects: string[] = [];
  const push = (s: string) => { objects.push(s); return objects.length; };

  push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj");
  const pagesIdx = push("");
  push("3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj");
  push("4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>endobj");

  const pageObjIds: number[] = [];
  pages.forEach((content) => {
    const streamObj = push(`${objects.length + 1} 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj`);
    const pageObj = push(`${objects.length + 1} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageW} ${pageH}]/Contents ${streamObj} 0 R/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>>>endobj`);
    pageObjIds.push(pageObj);
  });

  objects[1] = `2 0 obj<</Type/Pages/Kids[${pageObjIds.map((i) => `${i} 0 R`).join(" ")}]/Count ${pages.length}>>endobj`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, idx) => {
    offsets.push(body.length);
    if (!obj.startsWith(`${idx + 1} 0 obj`)) {
      body += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
    } else {
      body += obj + "\n";
    }
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { body += `${String(o).padStart(10, "0")} 00000 n \n`; });
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([body], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory_${format(new Date(), "yyyy-MM-dd")}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  // suppress unused
  void pagesIdx;
}
