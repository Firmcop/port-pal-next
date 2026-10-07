import * as XLSX from "xlsx";
import { z } from "zod";

export type ColumnSpec = {
  key: string;
  label: string;
  type?: "string" | "number" | "boolean" | "date";
  enum?: readonly string[];
  required?: boolean;
  example?: string | number | boolean;
  /** Field is parsed from the sheet but stripped before upsert (used by post-import RPC). */
  transient?: boolean;
};

export type RegistryConfig = {
  table: string;
  label: string;
  businessKey: string;
  uniqueOn: string;
  columns: ColumnSpec[];
  editableFields?: { key: string; label: string; type?: "string" | "boolean"; enum?: readonly string[] }[];
  deletable?: boolean;
  importable?: boolean;
  templateExamples?: Record<string, any>[];
  templateNotes?: string[];
  /** Optional Postgres RPC invoked once per imported row after upsert. Receives (businessKey, payload jsonb). */
  postImportRpc?: string;
  /** Predicate deciding whether to invoke postImportRpc for a parsed row. */
  postImportTrigger?: (row: Record<string, any>) => boolean;
};

export function downloadTemplate(
  config: RegistryConfig,
  filename: string,
  prefilledRows?: any[]
) {
  const headers = config.columns.map((c) => c.label);
  const exampleRows: any[][] =
    prefilledRows?.length
      ? prefilledRows.map((r) => config.columns.map((c) => r[c.key] ?? ""))
      : config.templateExamples?.length
        ? config.templateExamples.map((r) => config.columns.map((c) => r[c.key] ?? ""))
        : [config.columns.map((c) => c.example ?? "")];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
  // Column widths
  ws["!cols"] = config.columns.map((c) => ({
    wch: Math.max(12, c.label.length + 2, 18),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");

  // Hidden meta sheet
  const meta: any[][] = [
    ["Field", "Value"],
    ["entity", config.table],
    ["business_key", config.businessKey],
    ["template_version", "1"],
    ["generated_at", new Date().toISOString()],
    [],
    ["Column", "Required", "Type", "Allowed values"],
    ...config.columns.map((c) => [
      c.label,
      c.required ? "yes" : "no",
      c.type ?? "string",
      c.enum?.join(" | ") ?? "",
    ]),
  ];
  if (config.templateNotes?.length) {
    meta.push([], ["Notes"]);
    config.templateNotes.forEach((n) => meta.push([n]));
  }
  const metaWs = XLSX.utils.aoa_to_sheet(meta);
  XLSX.utils.book_append_sheet(wb, metaWs, "_meta");

  XLSX.writeFile(wb, filename);
}

export type ParsedRow = { rowNumber: number; data: Record<string, any>; raw: Record<string, any> };
export type ParseError = { rowNumber: number; raw: Record<string, any>; errors: string[] };

export async function parseUpload(
  file: File,
  config: RegistryConfig,
  schema: z.ZodTypeAny
): Promise<{ valid: ParsedRow[]; invalid: ParseError[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false, dateNF: "yyyy-mm-ddThh:mm:ss" });

  const labelToKey = new Map(config.columns.map((c) => [c.label.toLowerCase().trim(), c]));
  const valid: ParsedRow[] = [];
  const invalid: ParseError[] = [];

  json.forEach((raw, idx) => {
    const rowNumber = idx + 2; // header row + 1-based
    const data: Record<string, any> = {};
    for (const [label, val] of Object.entries(raw)) {
      const col = labelToKey.get(String(label).toLowerCase().trim());
      if (!col) continue;
      data[col.key] = coerce(val, col.type);
    }

    const result = schema.safeParse(data);
    if (result.success) {
      valid.push({ rowNumber, data: result.data, raw });
    } else {
      invalid.push({
        rowNumber,
        raw,
        errors: result.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
      });
    }
  });

  return { valid, invalid };
}

function coerce(val: any, type?: ColumnSpec["type"]) {
  if (val === null || val === undefined || val === "") return null;
  switch (type) {
    case "number": {
      const n = Number(String(val).replace(/,/g, ""));
      return Number.isNaN(n) ? null : n;
    }
    case "boolean": {
      const s = String(val).toLowerCase().trim();
      if (["true", "yes", "1", "y", "active"].includes(s)) return true;
      if (["false", "no", "0", "n", "inactive"].includes(s)) return false;
      return null;
    }
    case "date":
      return val instanceof Date ? val.toISOString() : String(val);
    default:
      return String(val).trim();
  }
}

export function exportRowsToXlsx(
  config: RegistryConfig,
  rows: any[],
  filename: string
) {
  const headers = config.columns.map((c) => c.label);
  const data = rows.map((r) => config.columns.map((c) => r[c.key] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws["!cols"] = config.columns.map((c) => ({ wch: Math.max(12, c.label.length + 2, 18) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, filename);
}

export function exportErrorReport(invalid: ParseError[], filename: string) {
  if (!invalid.length) return;
  const data = invalid.map((i) => ({
    Row: i.rowNumber,
    Errors: i.errors.join("; "),
    ...i.raw,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  XLSX.writeFile(wb, filename);
}
