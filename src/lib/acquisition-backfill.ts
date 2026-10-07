/**
 * One-off acquisition backfill: raise the purchase invoices that were never
 * issued for existing inventory.
 *
 *  - Batch 1: crane / offloading invoices payable to Gataru Enterprises for
 *    every container that has no offloading invoice yet.
 *  - Batch 2: seller purchase invoices payable to JJ MES DMCC for every
 *    JJ MES container that is not linked to a repatriation.
 *  - Batch 3: correct the one 40ft container that was invoiced at the 20ft rate.
 *
 * All planning here is pure so the dry run shown to the user and the rows that
 * actually get written can never diverge.
 */

import { isVoidInvoice } from "@/lib/acquisition-costs";

export const OFFLOADING_VENDOR = "Gataru Enterprises";
export const SELLER_NAME = "JJ MES DMCC";

/** KES per container, by size. */
export const OFFLOADING_RATES: Record<string, number> = { "40": 4000, "20": 2000 };
/** USD per container, by size. */
export const PURCHASE_RATES: Record<string, number> = { "40": 1700, "20": 700 };

export const OFFLOADING_CURRENCY = "KES";
export const PURCHASE_CURRENCY = "USD";
/** Manually agreed USD -> KES rate for this backfill. */
export const PURCHASE_FX = 130.8;

export const MISPRICED_CONTAINER = "BSIU9315346";

export interface BackfillContainer {
  id: string;
  container_number: string | null;
  size: string | number | null;
  status: string | null;
  owner: string | null;
}

export interface BackfillInvoice {
  id: string;
  container_id: string | null;
  reason: string | null;
  status: string | null;
  total_amount: number | string | null;
  currency: string | null;
  invoice_number: string | null;
  vendor?: string | null;
}

export type RowState = "ready" | "skip" | "blocked";

export interface PlanRow {
  containerId: string;
  containerNumber: string;
  size: string;
  status: string | null;
  vendor: string;
  amount: number;
  currency: string;
  fxRate: number | null;
  state: RowState;
  note: string;
}

const sizeKey = (c: BackfillContainer) => String(c.size ?? "").trim();
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Live (non-void) invoices for a container with the given reason. */
export function liveInvoices(
  invoices: BackfillInvoice[],
  containerId: string,
  reason: string,
): BackfillInvoice[] {
  return invoices.filter(
    (i) => i.container_id === containerId && i.reason === reason && !isVoidInvoice(i as any),
  );
}

/** Batch 1 — crane / offloading invoices for every container without one. */
export function planOffloading(
  containers: BackfillContainer[],
  invoices: BackfillInvoice[],
): PlanRow[] {
  return containers.map((c) => {
    const existing = liveInvoices(invoices, c.id, "acquisition_crane_offloading");
    const size = sizeKey(c);
    const amount = OFFLOADING_RATES[size] ?? 0;
    const base: PlanRow = {
      containerId: c.id,
      containerNumber: c.container_number ?? "—",
      size,
      status: c.status,
      vendor: OFFLOADING_VENDOR,
      amount,
      currency: OFFLOADING_CURRENCY,
      fxRate: null,
      state: "ready",
      note: "Will create offloading invoice",
    };
    if (existing.length) {
      return {
        ...base,
        state: "skip",
        note: `Already invoiced (${existing.map((i) => i.invoice_number).join(", ")})`,
      };
    }
    if (!amount) {
      return { ...base, state: "blocked", note: `No agreed offloading rate for size ${size || "?"}` };
    }
    return base;
  });
}

/** Batch 2 — seller purchase invoices for the JJ MES containers still to be acquired. */
export function planPurchase(
  containers: BackfillContainer[],
  invoices: BackfillInvoice[],
  repatriatedIds: Set<string>,
): PlanRow[] {
  return containers
    .filter((c) => (c.owner ?? "").trim().toLowerCase() === SELLER_NAME.toLowerCase())
    .map((c) => {
      const size = sizeKey(c);
      const amount = PURCHASE_RATES[size] ?? 0;
      const base: PlanRow = {
        containerId: c.id,
        containerNumber: c.container_number ?? "—",
        size,
        status: c.status,
        vendor: SELLER_NAME,
        amount,
        currency: PURCHASE_CURRENCY,
        fxRate: PURCHASE_FX,
        state: "ready",
        note: "Will create seller purchase invoice",
      };
      if (repatriatedIds.has(c.id)) {
        return { ...base, state: "skip", note: "Repatriated — excluded" };
      }
      const existing = liveInvoices(invoices, c.id, "purchase");
      if (existing.length) {
        return {
          ...base,
          state: "skip",
          note: `Already invoiced (${existing.map((i) => i.invoice_number).join(", ")})`,
        };
      }
      if (!amount) {
        return { ...base, state: "blocked", note: `No agreed purchase rate for size ${size || "?"}` };
      }
      return base;
    });
}

export interface CorrectionRow extends PlanRow {
  invoiceId: string;
  invoiceNumber: string;
  oldAmount: number;
}

/** Batch 3 — the 40ft container invoiced at the 20ft rate. */
export function planCorrection(
  containers: BackfillContainer[],
  invoices: BackfillInvoice[],
): CorrectionRow[] {
  const target = containers.find(
    (c) => (c.container_number ?? "").trim().toUpperCase() === MISPRICED_CONTAINER,
  );
  if (!target) return [];
  const size = sizeKey(target);
  const expected = PURCHASE_RATES[size] ?? 0;
  return liveInvoices(invoices, target.id, "purchase")
    .filter((inv) => expected > 0 && num(inv.total_amount) !== expected)
    .map((inv) => ({
      containerId: target.id,
      containerNumber: target.container_number ?? "—",
      size,
      status: target.status,
      vendor: inv.vendor ?? SELLER_NAME,
      amount: expected,
      currency: (inv.currency ?? PURCHASE_CURRENCY).toUpperCase(),
      fxRate: PURCHASE_FX,
      state: "ready" as RowState,
      note: `Adjust ${num(inv.total_amount)} -> ${expected} (${size}ft rate)`,
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number ?? "—",
      oldAmount: num(inv.total_amount),
    }));
}

export const OWNER_CORRECTION_REASON =
  "Owner corrected: acquisition supplier is JJ MES DMCC";

export interface OwnerFixRow {
  containerId: string;
  containerNumber: string;
  size: string;
  status: string | null;
  currentOwner: string;
  newOwner: string;
  state: RowState;
  note: string;
}

/**
 * Batch 4 — every container whose owner is not exactly the seller name is
 * re-pointed to it. Sold and converted units are included: the owner field
 * records the acquisition supplier, not the buyer.
 */
export function planOwnerFix(containers: BackfillContainer[]): OwnerFixRow[] {
  return containers
    .filter((c) => (c.owner ?? "") !== SELLER_NAME)
    .map((c) => ({
      containerId: c.id,
      containerNumber: c.container_number ?? "—",
      size: sizeKey(c),
      status: c.status,
      currentOwner: (c.owner ?? "").trim() || "(blank)",
      newOwner: SELLER_NAME,
      state: "ready" as RowState,
      note:
        (c.owner ?? "").trim().toLowerCase() === SELLER_NAME.toLowerCase()
          ? "Trim stray whitespace"
          : "Will set owner to the acquisition supplier",
    }));
}

export function summariseOwnerFix(rows: OwnerFixRow[]) {
  const byOwner = new Map<string, number>();
  for (const r of rows) byOwner.set(r.currentOwner, (byOwner.get(r.currentOwner) ?? 0) + 1);
  return {
    total: rows.length,
    byOwner: Array.from(byOwner, ([owner, count]) => ({ owner, count })).sort(
      (a, b) => b.count - a.count,
    ),
  };
}

export interface Inconsistency {
  container: string;
  issue: string;
  detail: string;
}

/** Everything worth reporting but not automatically changed. */
export function findInconsistencies(
  containers: BackfillContainer[],
  invoices: BackfillInvoice[],
  repatriatedIds: Set<string>,
): Inconsistency[] {
  const out: Inconsistency[] = [];
  const byId = new Map(containers.map((c) => [c.id, c]));

  for (const c of containers) {
    if (repatriatedIds.has(c.id) && c.status !== "booked_for_repatriation") {
      out.push({
        container: c.container_number ?? c.id,
        issue: "Repatriated but not flagged",
        detail: `Linked to a repatriation while status is "${c.status ?? "?"}" — excluded from invoicing`,
      });
    }
  }

  for (const inv of invoices) {
    if (inv.reason !== "purchase" || isVoidInvoice(inv as any)) continue;
    const c = inv.container_id ? byId.get(inv.container_id) : undefined;
    if (!c) continue;
    const vendor = (inv.vendor ?? "").trim();
    if (vendor && vendor.toLowerCase() !== SELLER_NAME.toLowerCase()) {
      out.push({
        container: c.container_number ?? c.id,
        issue: "Purchase billed to another vendor",
        detail: `${inv.invoice_number}: issued to "${vendor}" rather than ${SELLER_NAME} — left as-is`,
      });
      continue;
    }
    if (vendor.toLowerCase() !== SELLER_NAME.toLowerCase()) continue;

    const expected = PURCHASE_RATES[sizeKey(c)] ?? 0;
    const amount = num(inv.total_amount);
    if (expected && amount !== expected && (c.container_number ?? "").toUpperCase() !== MISPRICED_CONTAINER) {
      out.push({
        container: c.container_number ?? c.id,
        issue: "Purchase price differs from agreed rate",
        detail: `${inv.invoice_number}: ${inv.currency} ${amount} vs agreed ${expected} for ${sizeKey(c)}ft — left as-is`,
      });
    }
  }

  for (const inv of invoices) {
    if (inv.reason !== "acquisition_crane_offloading" || isVoidInvoice(inv as any)) continue;
    const vendor = (inv.vendor ?? "").trim();
    if (vendor.toLowerCase() !== OFFLOADING_VENDOR.toLowerCase()) {
      const c = inv.container_id ? byId.get(inv.container_id) : undefined;
      out.push({
        container: c?.container_number ?? inv.container_id ?? "—",
        issue: "Offloading billed to another vendor",
        detail: `${inv.invoice_number}: ${vendor || "unknown vendor"} ${inv.currency} ${num(inv.total_amount)} — left as-is`,
      });
    }
  }

  const owners = new Map<string, number>();
  for (const c of containers) {
    const raw = c.owner ?? "";
    if (!raw) continue;
    if (raw !== raw.trim()) owners.set(raw, (owners.get(raw) ?? 0) + 1);
  }
  for (const [owner, count] of owners) {
    out.push({
      container: `${count} container(s)`,
      issue: "Owner name has stray whitespace",
      detail: `"${owner}" — trim to keep supplier matching reliable`,
    });
  }

  return out;
}

export function summarise(rows: PlanRow[]) {
  const ready = rows.filter((r) => r.state === "ready");
  const totals = new Map<string, number>();
  for (const r of ready) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.amount);
  return {
    ready: ready.length,
    skipped: rows.filter((r) => r.state === "skip").length,
    blocked: rows.filter((r) => r.state === "blocked").length,
    totals: Array.from(totals, ([currency, amount]) => ({ currency, amount })),
  };
}
