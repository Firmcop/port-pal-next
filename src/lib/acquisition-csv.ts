import { supabase } from "@/integrations/supabase/client";
import {
  previewAcquisitionCosts,
  setContainerAcquisitionCosts,
  type AcqPreview,
  type BulkEditResult,
} from "@/lib/container-acquisition-edit";
import { exportCSV } from "@/lib/export-utils";

export const ACQ_CSV_HEADERS = [
  "container_number",
  "purchase_amount",
  "purchase_currency",
  "transport_amount",
  "transport_currency",
  "transport_vendor",
  "crane_amount",
  "crane_currency",
  "crane_vendor",
] as const;

export interface AcqCsvRow {
  containerNumber: string;
  purchase: number;
  purchaseCurrency: string;
  transport: number;
  transportCurrency: string;
  transportVendor: string | null;
  offloading: number;
  offloadingCurrency: string;
  offloadingVendor: string | null;
  /** Container id resolved from the number, when it exists in this organisation. */
  containerId?: string;
  /** Parse / matching problem — such a row can never be applied. */
  error?: string;
  /** Blocking validation problems returned by the preview. */
  blockers?: string[];
  preview?: AcqPreview;
}

/** Download an empty template with one example row. */
export function downloadAcquisitionCsvTemplate(currency: string) {
  const c = (currency || "USD").toUpperCase();
  exportCSV(
    "acquisition-costs-template.csv",
    ACQ_CSV_HEADERS as unknown as string[],
    [["MSCU1234567", "3000", "USD", "25000", c, "Acme Transporters", "8000", c, "Coastal Crane"]],
  );
}

/** Minimal RFC-4180 style CSV split that tolerates quoted values and commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Turn an uploaded CSV into rows ready for the bulk editor: each row matched to
 * a container in this organisation and validated through the same preview RPC
 * the manual dialog uses, so nothing can be saved that the dialog would refuse.
 */
export async function parseAcquisitionCsv(text: string, fallbackCurrency: string): Promise<AcqCsvRow[]> {
  const grid = parseCsv(text);
  if (grid.length === 0) throw new Error("The file is empty.");

  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = (name: string) => header.indexOf(name);
  if (idx("container_number") === -1) {
    throw new Error(`Missing a "container_number" column. Download the template and use its headings.`);
  }
  const at = (r: string[], name: string) => {
    const i = idx(name);
    return i === -1 ? "" : (r[i] ?? "").trim();
  };
  const base = (fallbackCurrency || "USD").toUpperCase();

  const rows: AcqCsvRow[] = grid.slice(1).map((r) => ({
    containerNumber: at(r, "container_number").toUpperCase(),
    purchase: num(at(r, "purchase_amount")),
    purchaseCurrency: (at(r, "purchase_currency") || base).toUpperCase(),
    transport: num(at(r, "transport_amount")),
    transportCurrency: (at(r, "transport_currency") || base).toUpperCase(),
    transportVendor: at(r, "transport_vendor") || null,
    offloading: num(at(r, "crane_amount")),
    offloadingCurrency: (at(r, "crane_currency") || base).toUpperCase(),
    offloadingVendor: at(r, "crane_vendor") || null,
  }));

  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.containerNumber) row.error = "No container number in this row.";
    else if (seen.has(row.containerNumber)) row.error = "Duplicate container number in the file.";
    seen.add(row.containerNumber);
  }

  const numbers = Array.from(new Set(rows.filter((r) => !r.error).map((r) => r.containerNumber)));
  if (numbers.length) {
    const { data, error } = await supabase
      .from("containers")
      .select("id, container_number")
      .in("container_number", numbers);
    if (error) throw error;
    const map = new Map((data ?? []).map((c: any) => [String(c.container_number).toUpperCase(), c.id as string]));
    for (const row of rows) {
      if (row.error) continue;
      const id = map.get(row.containerNumber);
      if (!id) row.error = "No container with this number in your inventory.";
      else row.containerId = id;
    }
  }

  for (const row of rows) {
    if (!row.containerId) continue;
    try {
      const preview = await previewAcquisitionCosts({
        containerId: row.containerId,
        purchase: row.purchase,
        purchaseCurrency: row.purchaseCurrency,
        transport: row.transport,
        transportVendor: row.transportVendor,
        transportCurrency: row.transportCurrency,
        offloading: row.offloading,
        offloadingVendor: row.offloadingVendor,
        offloadingCurrency: row.offloadingCurrency,
      });
      row.preview = preview;
      row.blockers = (preview.blockers ?? []).map((b) => `${b.message} ${b.fix}`.trim());
    } catch (e: any) {
      row.error = e?.message ?? "Validation failed.";
    }
  }

  return rows;
}

/** Apply the validated CSV rows, one reason recorded on every container. */
export async function applyAcquisitionCsv(rows: AcqCsvRow[], reason: string): Promise<BulkEditResult[]> {
  const out: BulkEditResult[] = [];
  for (const row of rows) {
    if (row.error || (row.blockers?.length ?? 0) > 0 || !row.containerId) {
      out.push({
        containerId: row.containerId ?? row.containerNumber,
        containerNumber: row.containerNumber,
        status: "skipped",
        detail: row.error ?? (row.blockers ?? []).join(" · "),
      });
      continue;
    }
    try {
      const res = await setContainerAcquisitionCosts({
        containerId: row.containerId,
        purchase: row.purchase,
        purchaseCurrency: row.purchaseCurrency,
        transport: row.transport,
        transportVendor: row.transportVendor,
        transportCurrency: row.transportCurrency,
        offloading: row.offloading,
        offloadingVendor: row.offloadingVendor,
        offloadingCurrency: row.offloadingCurrency,
        currency: row.purchaseCurrency,
        reason,
      });
      const changed = Object.entries(res ?? {})
        .filter(([, v]: any) => v?.outcome && v.outcome !== "unchanged")
        .map(([k, v]: any) => `${k.replace("acquisition_", "").replace(/_/g, " ")}: ${v.outcome}`);
      out.push({
        containerId: row.containerId,
        containerNumber: row.containerNumber,
        status: "applied",
        detail: changed.length ? changed.join(" · ") : "no change needed",
      });
    } catch (e: any) {
      out.push({
        containerId: row.containerId,
        containerNumber: row.containerNumber,
        status: "failed",
        detail: e?.message ?? "Unknown error",
      });
    }
  }
  return out;
}

/** Error report for the rows that could not be applied. */
export function downloadAcquisitionCsvErrors(results: BulkEditResult[]) {
  exportCSV(
    "acquisition-import-errors.csv",
    ["container_number", "status", "detail"],
    results.filter((r) => r.status !== "applied").map((r) => [r.containerNumber ?? "", r.status, r.detail]),
  );
}
