import { format } from "date-fns";

function esc(s: any) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]/g, " ");
}

export function downloadAppointmentPdf(a: any, depotName = "Depot") {
  const pageW = 595; // A4 portrait
  const pageH = 842;
  const margin = 50;

  const scheduled = a.scheduled_at
    ? format(new Date(a.scheduled_at), "EEE, dd MMM yyyy · HH:mm")
    : "—";

  const rows: [string, string][] = [
    ["Appointment #", a.appointment_number ?? "—"],
    ["Type", (a.appointment_type ?? "").replace(/_/g, " ").toUpperCase()],
    ["Status", (a.status ?? "").replace(/_/g, " ").toUpperCase()],
    ["Scheduled", scheduled],
    ["Container #", a.container_number ?? "—"],
    ["Truck plate", a.truck_plate ?? "—"],
    ["Driver name", a.driver_name ?? "—"],
    ["Driver license", a.driver_license ?? "—"],
    ["Shipping line", a.shipping_line ?? "—"],
    ["Notes", a.notes ?? "—"],
  ];

  let y = pageH - margin;
  let stream = "";
  stream += `BT /F2 20 Tf ${margin} ${y} Td (${esc(depotName)} - Gate Appointment) Tj ET\n`;
  y -= 24;
  stream += `BT /F1 10 Tf ${margin} ${y} Td (Generated: ${esc(format(new Date(), "dd MMM yyyy HH:mm"))}) Tj ET\n`;
  y -= 30;

  stream += `0.85 0.85 0.85 RG ${margin} ${y} m ${pageW - margin} ${y} l S 0 0 0 RG\n`;
  y -= 20;

  for (const [k, v] of rows) {
    stream += `BT /F2 11 Tf ${margin} ${y} Td (${esc(k)}) Tj ET\n`;
    // wrap value at ~55 chars
    const text = String(v ?? "");
    const parts = text.match(/.{1,55}(\s|$)/g) ?? [text];
    let ly = y;
    parts.forEach((p, i) => {
      stream += `BT /F1 11 Tf ${margin + 130} ${ly} Td (${esc(p.trim())}) Tj ET\n`;
      if (i < parts.length - 1) ly -= 14;
    });
    y = ly - 22;
  }

  y -= 20;
  stream += `BT /F2 12 Tf ${margin} ${y} Td (Driver Instructions) Tj ET\n`;
  y -= 16;
  const instr = [
    "1. Present this document at the depot gate on arrival.",
    "2. Arrive within the scheduled time window; late arrivals may be rejected.",
    "3. Ensure the truck plate and driver license match the details above.",
    "4. Follow the gate clerk's instructions for inspection and placement.",
  ];
  for (const line of instr) {
    stream += `BT /F1 10 Tf ${margin} ${y} Td (${esc(line)}) Tj ET\n`;
    y -= 14;
  }

  // Assemble PDF
  const objs: string[] = [];
  const push = (s: string) => { objs.push(s); return objs.length; };
  push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj");
  const pagesIdx = push("");
  push("3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj");
  push("4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>endobj");
  const contentIdx = push(`${objs.length + 1} 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream\nendobj`);
  const pageIdx = push(`${objs.length + 1} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageW} ${pageH}]/Contents ${contentIdx} 0 R/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>>>endobj`);
  objs[1] = `2 0 obj<</Type/Pages/Kids[${pageIdx} 0 R]/Count 1>>endobj`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((obj, idx) => {
    offsets.push(body.length);
    if (!obj.startsWith(`${idx + 1} 0 obj`)) {
      body += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
    } else {
      body += obj + "\n";
    }
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(o => { body += `${String(o).padStart(10, "0")} 00000 n \n`; });
  body += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;

  const blob = new Blob([body], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `appointment_${a.appointment_number || "unknown"}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  void pagesIdx;
}
