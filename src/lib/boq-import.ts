/**
 * Pure helpers for importing Bill-of-Quantities style spreadsheets into quote templates.
 * Handles real-world BOQ layouts: title rows, repeated header rows, section captions in
 * column A, subtotal rows and currency-suffixed column labels.
 */

export type BoqItem = {
  description: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
};

export type BoqSection = { title: string; items: BoqItem[] };

export type BoqParseResult = {
  sections: BoqSection[];
  error?: string;
};

export type BoqColumnKey =
  | "section"
  | "code"
  | "description"
  | "unit"
  | "quantity"
  | "unit_price"
  | "amount"
  | "discount_pct"
  | "tax_pct";

const ALIASES: Record<string, BoqColumnKey> = {
  section: "section", group: "section", category: "section", "section title": "section",
  item: "code", "item no": "code", "item code": "code", code: "code", ref: "code", "s n": "code", sn: "code", no: "code",
  description: "description", particulars: "description", "item description": "description",
  "description of works": "description", works: "description", activity: "description", details: "description",
  unit: "unit", uom: "unit", units: "unit", "unit of measure": "unit",
  quantity: "quantity", qty: "quantity", quant: "quantity", nos: "quantity",
  "unit price": "unit_price", price: "unit_price", rate: "unit_price", "unit rate": "unit_price",
  "rate unit": "unit_price", "unit cost": "unit_price", cost: "unit_price", "rate per unit": "unit_price",
  amount: "amount", total: "amount", "total amount": "amount", "line total": "amount", value: "amount",
  "discount %": "discount_pct", discount: "discount_pct", "disc%": "discount_pct", disc: "discount_pct",
  "discount pct": "discount_pct",
  "tax %": "tax_pct", tax: "tax_pct", vat: "tax_pct", "vat %": "tax_pct", "tax pct": "tax_pct",
};

const NOISE = /^(sub[\s-]?total|total|grand total|sum|summary|contingenc|provisional sum|notes?|exclusions?|assumptions?|vat|tax)\b/i;

/** Normalise a header label: drop bracketed units/currency, punctuation and casing. */
export function cleanLabel(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[_\-/\\.]+/g, " ")
    .replace(/[:：]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Map one cleaned header label to a known column key. */
export function labelToKey(raw: unknown): BoqColumnKey | null {
  const c = cleanLabel(raw);
  if (!c) return null;
  if (ALIASES[c]) return ALIASES[c];
  // allow "unit rate kes" style leftovers and other suffixed labels
  const words = c.split(" ");
  for (let take = words.length - 1; take >= 1; take--) {
    const prefix = words.slice(0, take).join(" ");
    if (ALIASES[prefix]) return ALIASES[prefix];
  }
  return null;
}

/** Parse a spreadsheet cell into a number, tolerating currency symbols, commas and blanks. */
export function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  if (s.startsWith("=")) return 0; // uncached formula — treat as empty
  const neg = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()]/g, "").replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function cellText(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.startsWith("=") ? "" : s;
}

export type HeaderMatch = { rowIndex: number; map: Record<number, BoqColumnKey> };

/** Build a column map from a candidate header row, or null when it isn't one. */
export function headerMapFor(row: unknown[]): Record<number, BoqColumnKey> | null {
  const map: Record<number, BoqColumnKey> = {};
  row.forEach((cell, i) => {
    const key = labelToKey(cell);
    if (key && !Object.values(map).includes(key)) map[i] = key;
  });
  const keys = Object.values(map);
  const hasDesc = keys.includes("description") || keys.includes("code");
  const hasNumeric = keys.includes("quantity") || keys.includes("unit_price") || keys.includes("amount");
  return hasDesc && hasNumeric ? map : null;
}

/** Locate the header row anywhere in the first `limit` rows. */
export function findHeaderRow(rows: unknown[][], limit = 30): HeaderMatch | null {
  const end = Math.min(rows.length, limit);
  for (let i = 0; i < end; i++) {
    const map = headerMapFor(rows[i] ?? []);
    if (map) return { rowIndex: i, map };
  }
  return null;
}

export function isNoiseRow(text: string): boolean {
  return NOISE.test(text.trim());
}

/** Turn a sheet's raw rows (array-of-arrays) into sections of priced items. */
export function parseBoqRows(rows: unknown[][]): BoqParseResult {
  const header = findHeaderRow(rows);
  if (!header) {
    return { sections: [], error: "Could not find a header row. The sheet needs columns like Description, Unit, Qty and Rate." };
  }
  const { map } = header;
  const cols = Object.entries(map).map(([i, key]) => [Number(i), key] as [number, BoqColumnKey]);
  const colOf = (key: BoqColumnKey) => cols.find(([, k]) => k === key)?.[0];
  const descCol = colOf("description");
  const codeCol = colOf("code");
  const sectionCol = colOf("section");
  const unitCol = colOf("unit");
  const qtyCol = colOf("quantity");
  const priceCol = colOf("unit_price");
  const discCol = colOf("discount_pct");
  const taxCol = colOf("tax_pct");

  const sections: BoqSection[] = [];
  let current: BoqSection | null = null;
  const pushSection = (title: string) => {
    current = { title: title || `Section ${sections.length + 1}`, items: [] };
    sections.push(current);
  };

  // A caption directly above the header row is the first section's title.
  for (let r = header.rowIndex - 1; r >= 0; r--) {
    const above = (rows[r] ?? []).map(cellText).filter((t) => t !== "");
    if (!above.length) continue;
    if (above.length === 1 && !isNoiseRow(above[0])) pushSection(above[0]);
    break;
  }


  for (let r = header.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const filled = row.map((c, i) => [i, cellText(c)] as [number, string]).filter(([, t]) => t !== "");
    if (!filled.length) continue;

    // repeated header row further down the sheet
    if (headerMapFor(row)) continue;

    const qty = qtyCol != null ? parseNumber(row[qtyCol]) : 0;
    const price = priceCol != null ? parseNumber(row[priceCol]) : 0;

    // caption row: a single text cell, no numbers → new section
    if (filled.length === 1 && qty === 0 && price === 0) {
      const title = filled[0][1];
      if (!isNoiseRow(title)) pushSection(title);
      continue;
    }

    const explicitSection = sectionCol != null ? cellText(row[sectionCol]) : "";
    const rawDesc = descCol != null ? cellText(row[descCol]) : "";
    const code = codeCol != null && codeCol !== descCol ? cellText(row[codeCol]) : "";

    if (isNoiseRow(rawDesc) || isNoiseRow(filled[0][1])) continue;

    // Section column used as the grouping (template-style sheets)
    if (explicitSection && !rawDesc) {
      pushSection(explicitSection);
      continue;
    }

    let description = rawDesc;
    if (!description && code && descCol == null) description = code;
    else if (description && code) description = `${code} — ${description}`;
    if (!description) continue;
    if (qty === 0 && price === 0) continue;

    if (!current) pushSection(explicitSection || "Items");
    else if (explicitSection && explicitSection !== current.title) pushSection(explicitSection);

    current!.items.push({
      description,
      unit: unitCol != null && cellText(row[unitCol]) ? cellText(row[unitCol]) : null,
      quantity: qty || 1,
      unit_price: price,
      discount_pct: discCol != null ? parseNumber(row[discCol]) : 0,
      tax_pct: taxCol != null ? parseNumber(row[taxCol]) : 0,
    });
  }

  const withItems = sections.filter((s) => s.items.length);
  if (!withItems.length) {
    return { sections: [], error: "Header row found, but no priced rows could be read. Check that Qty and Rate columns contain numbers." };
  }
  return { sections: withItems };
}
