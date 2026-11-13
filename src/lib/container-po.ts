/**
 * Container purchase orders: containers bought from a supplier who does not
 * store them with us. Order -> supplier invoice -> payment -> receipt into the
 * yard (or straight to a customer). The database side is
 * container_po_receive / container_po_record_bill / container_po_close_short.
 */

export const CONTAINER_SIZES = ["20", "40", "45", "10", "30"] as const;
export const CONTAINER_TYPES = [
  { value: "dry", label: "Dry" },
  { value: "reefer", label: "Reefer" },
  { value: "open_top", label: "Open top" },
  { value: "flat_rack", label: "Flat rack" },
  { value: "tank", label: "Tank" },
] as const;
export const CONTAINER_GRADES = [
  { value: "A", label: "Grade A" },
  { value: "B", label: "Grade B" },
  { value: "C", label: "Grade C" },
  { value: "D", label: "Grade D" },
  { value: "as_is", label: "As is" },
] as const;

export interface ContainerLineSpec {
  container_size?: string | null;
  container_height?: string | null;
  container_category?: string | null;
  container_grade?: string | null;
}

/** "40ft HC dry · grade B" — the PO line description. */
export function describeContainerLine(l: ContainerLineSpec): string {
  const size = l.container_size ? `${l.container_size}ft` : "Container";
  const dry = (l.container_category || "dry") === "dry";
  const height = dry && (l.container_height === "HC" || l.container_height === "LC") ? ` ${l.container_height}` : "";
  const type = CONTAINER_TYPES.find((t) => t.value === (l.container_category || "dry"))?.label.toLowerCase() ?? "dry";
  const grade = l.container_grade
    ? l.container_grade === "as_is" ? " · as is" : ` · grade ${l.container_grade}`
    : "";
  return `${size}${height} ${type} container${grade}`;
}

/** Upper case, letters and digits only. */
export function normalizeContainerNumber(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * ISO 6346 check digit. Returns true when the 11th character is the right
 * check digit for the first ten, false when it is wrong, null when the number
 * is not in the 4 letters + 7 digits form (we still accept it, with a warning).
 */
export function iso6346Valid(raw: string): boolean | null {
  const n = normalizeContainerNumber(raw);
  if (!/^[A-Z]{4}\d{7}$/.test(n)) return null;
  const letterValue = (ch: string) => {
    // A=10, skipping multiples of 11 (11, 22, 33)
    let v = 10;
    for (let c = 65; c < ch.charCodeAt(0); c++) {
      v++;
      if (v % 11 === 0) v++;
    }
    return v;
  };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = n[i];
    const v = i < 4 ? letterValue(ch) : Number(ch);
    sum += v * 2 ** i;
  }
  const check = (sum % 11) % 10;
  return check === Number(n[10]);
}

export interface ReceiveUnit {
  po_item_id: string;
  container_number: string;
  received_at?: string;
  delivery: "yard" | "direct";
  /** HC or LC; required for dry containers */
  height_class?: "HC" | "LC" | null;
  customer_id?: string | null;
  grade?: string | null;
  depot_id?: string | null;
  transporter?: string;
  truck_registration?: string;
  driver_name?: string;
  driver_phone?: string;
  transport_vendor?: string;
  transport_cost?: string | number;
  offloading_vendor?: string;
  offloading_cost?: string | number;
  notes?: string;
}

export interface OutstandingLine {
  id: string;
  description: string;
  quantity: number;
  received_qty: number;
  container_category?: string | null;
  container_height?: string | null;
}

export interface UnitIssue {
  row: number;
  field: keyof ReceiveUnit | "row";
  message: string;
  /** warnings do not block saving */
  warning?: boolean;
}

/** Check the receive form before it goes to the server. */
export function checkReceiveUnits(units: ReceiveUnit[], lines: OutstandingLine[]): UnitIssue[] {
  const issues: UnitIssue[] = [];
  const seen = new Map<string, number>();
  const perLine = new Map<string, number>();
  units.forEach((u, i) => {
    const num = normalizeContainerNumber(u.container_number);
    if (num.length < 4) {
      issues.push({ row: i, field: "container_number", message: "Enter the container number" });
    } else {
      if (seen.has(num)) issues.push({ row: i, field: "container_number", message: `Same number as row ${seen.get(num)! + 1}` });
      else seen.set(num, i);
      const ok = iso6346Valid(num);
      if (ok === null) issues.push({ row: i, field: "container_number", message: "Not in the usual ABCU1234567 form", warning: true });
      else if (ok === false) issues.push({ row: i, field: "container_number", message: "Check digit does not match — please re-check the number", warning: true });
    }
    if (!u.po_item_id) issues.push({ row: i, field: "po_item_id", message: "Pick the order line" });
    else perLine.set(u.po_item_id, (perLine.get(u.po_item_id) ?? 0) + 1);
    const line = lines.find((x) => x.id === u.po_item_id);
    if (line && (line.container_category || "dry") === "dry" && u.height_class !== "HC" && u.height_class !== "LC")
      issues.push({ row: i, field: "height_class", message: "Pick HC or LC" });
    if (u.delivery === "direct" && !u.customer_id) issues.push({ row: i, field: "customer_id", message: "Pick the customer" });
    if (Number(u.transport_cost || 0) > 0 && !String(u.transport_vendor ?? "").trim())
      issues.push({ row: i, field: "transport_vendor", message: "Who did the transport?" });
    if (Number(u.offloading_cost || 0) > 0 && !String(u.offloading_vendor ?? "").trim())
      issues.push({ row: i, field: "offloading_vendor", message: "Who did the offloading?" });
  });
  for (const [id, n] of perLine) {
    const l = lines.find((x) => x.id === id);
    if (!l) continue;
    const left = Math.max(Number(l.quantity) - Number(l.received_qty || 0), 0);
    if (n > left) {
      const row = units.findIndex((u) => u.po_item_id === id);
      issues.push({ row, field: "po_item_id", message: `"${l.description}": only ${left} still to come, ${n} entered` });
    }
  }
  return issues;
}

/** One empty row per container still to come, line by line. */
export function rowsForOutstanding(lines: OutstandingLine[], defaults: Partial<ReceiveUnit> = {}, max = 50): ReceiveUnit[] {
  const rows: ReceiveUnit[] = [];
  for (const l of lines) {
    const left = Math.max(Number(l.quantity) - Number(l.received_qty || 0), 0);
    for (let k = 0; k < left && rows.length < max; k++) {
      const dry = (l.container_category || "dry") === "dry";
      rows.push({
        delivery: "yard", ...defaults, po_item_id: l.id, container_number: "",
        height_class: dry ? (l.container_height === "HC" ? "HC" : "LC") : null,
      });
    }
  }
  return rows;
}

export interface ContainerPoSummary {
  status: string;
  total_cost: number;
  units_ordered: number;
  units_received: number;
  value_received: number;
  billed: number;
  paid: number;
  bill_supplier_ref?: string | null;
}

/** What is left to do on an order, for the list and the reports. */
export function poProgress(s: ContainerPoSummary) {
  const closed = s.status === "cancelled";
  const unitsToCome = closed ? 0 : Math.max(s.units_ordered - s.units_received, 0);
  const paidNotReceived = Math.max(round2(Number(s.paid) - Number(s.value_received)), 0);
  const receivedNotBilled = s.bill_supplier_ref ? 0 : round2(Number(s.value_received));
  const toPay = Math.max(round2(Number(s.total_cost) - Number(s.paid)), 0);
  return { unitsToCome, paidNotReceived, receivedNotBilled, toPay, hasSupplierInvoice: !!s.bill_supplier_ref };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
