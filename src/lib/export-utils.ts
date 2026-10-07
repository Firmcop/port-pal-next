import { format } from "date-fns";

// ── CSV ──────────────────────────────────────────────────────
export function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  downloadBlob(csv, filename, "text/csv;charset=utf-8;");
}

// ── PDF (simple table-based) ─────────────────────────────────
export function exportPDF(title: string, filename: string, headers: string[], rows: string[][], options?: { landscape?: boolean }) {
  const landscape = options?.landscape ?? false;
  const pageW = landscape ? 842 : 595; // A4 pts
  const pageH = landscape ? 595 : 842;
  const margin = 40;
  const colW = (pageW - 2 * margin) / headers.length;
  const rowH = 18;
  const headerRowH = 22;
  const maxY = pageH - margin;
  const fontSize = 8;
  const headerFontSize = 9;

  let pages: string[] = [];
  let currentPage = "";
  let y = 0;

  function startPage() {
    y = pageH - margin;
    // title
    currentPage = `BT /F1 14 Tf ${margin} ${y} Td (${pdfEscape(title)}) Tj ET\n`;
    y -= 24;
    // date
    currentPage += `BT /F1 8 Tf ${margin} ${y} Td (Generated: ${format(new Date(), "dd MMM yyyy HH:mm")}) Tj ET\n`;
    y -= 20;
    drawHeaderRow();
  }

  function drawHeaderRow() {
    // bg
    currentPage += `0.92 0.92 0.92 rg ${margin} ${y - 4} ${pageW - 2 * margin} ${headerRowH} re f 0 0 0 rg\n`;
    headers.forEach((h, i) => {
      currentPage += `BT /F2 ${headerFontSize} Tf ${margin + i * colW + 4} ${y + 2} Td (${pdfEscape(h)}) Tj ET\n`;
    });
    y -= headerRowH;
  }

  function drawRow(row: string[]) {
    if (y - rowH < margin) {
      pages.push(currentPage);
      startPage();
    }
    // light grid line
    currentPage += `0.85 0.85 0.85 RG ${margin} ${y - 2} m ${pageW - margin} ${y - 2} l S 0 0 0 RG\n`;
    row.forEach((cell, i) => {
      const truncated = String(cell ?? "").substring(0, Math.floor(colW / 4));
      currentPage += `BT /F1 ${fontSize} Tf ${margin + i * colW + 4} ${y + 2} Td (${pdfEscape(truncated)}) Tj ET\n`;
    });
    y -= rowH;
  }

  startPage();
  rows.forEach((r) => drawRow(r));
  pages.push(currentPage);

  // Build raw PDF
  const pdfContent = buildPDF(pages, pageW, pageH);
  downloadBlob(pdfContent, filename, "application/pdf");
}

function pdfEscape(str: string) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]/g, " ");
}

function buildPDF(pages: string[], w: number, h: number): string {
  // Minimal valid PDF with two fonts
  const objects: string[] = [];
  const push = (s: string) => { objects.push(s); return objects.length; };

  push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj");
  // placeholder for pages dict
  const pagesIdx = push("");
  // fonts
  push("3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj");
  push("4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>endobj");

  const pageObjIds: number[] = [];
  pages.forEach((content) => {
    const streamObj = push(`${objects.length + 1} 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj`);
    const pageObj = push(`${objects.length + 1} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]/Contents ${streamObj} 0 R/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>>>endobj`);
    pageObjIds.push(pageObj);
  });

  objects[1] = `2 0 obj<</Type/Pages/Kids[${pageObjIds.map((i) => `${i} 0 R`).join(" ")}]/Count ${pages.length}>>endobj`;

  // Serialize
  let body = "";
  const offsets: number[] = [];
  const header = "%PDF-1.4\n";
  body = header;
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
  offsets.forEach((o) => {
    body += `${String(o).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;
  return body;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
