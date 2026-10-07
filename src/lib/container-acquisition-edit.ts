import { supabase } from "@/integrations/supabase/client";
import { ACQ_REASONS, computeAcquisitionTotal, invoiceInBase, isVoidInvoice, type AcqInvoice } from "@/lib/acquisition-costs";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface SetAcquisitionCostsArgs {
  containerId: string | null | undefined;
  purchase: number | null | undefined;
  transport: number | null | undefined;
  transportVendor?: string | null;
  transportSupplierId?: string | null;
  offloading: number | null | undefined;
  offloadingVendor?: string | null;
  offloadingSupplierId?: string | null;
  /** Fallback currency used for any component without its own currency. */
  currency: string;
  /** Per-component currencies — the seller can bill in USD while transport / crane bill in KES. */
  purchaseCurrency?: string | null;
  transportCurrency?: string | null;
  offloadingCurrency?: string | null;
  /** Manually entered exchange rates into the org base currency (null = use the rate table). */
  purchaseFx?: number | null;
  transportFx?: number | null;
  offloadingFx?: number | null;
  reason: string;
}


const cur = (v: unknown, fallback?: string) => {
  const s = String(v ?? "").trim().toUpperCase();
  return s || (fallback ? fallback.toUpperCase() : null);
};

const pos = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Manual FX rate, or null when the stored rate table should be used. */
const rate = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? x : null;
};

/**
 * Turn raw database refusals into something a depot accountant can act on.
 * Keeps the original text when we have nothing better to say.
 */
export function friendlyAcquisitionError(message: string): string {
  const m = String(message ?? "");
  if (m.includes("invoice_currency_locked")) {
    return "This purchase invoice's currency is locked. It can only be changed while the invoice is still unpaid — cancel it and raise a new one instead.";
  }
  if (m.includes("invoice_totals_mismatch")) {
    return "The invoice total does not match its lines. Refresh the container and try again.";
  }
  if (m.includes("Only admins can edit acquisition costs") || m.toLowerCase().includes("forbidden")) {
    return "Only an admin or owner can change acquisition costs.";
  }
  if (m.includes("Missing FX rate") || m.includes("No ") && m.includes("rate on or before")) {
    return `${m} Add the rate under Finance → FX Rates, or type it manually on the component.`;
  }
  return m;
}


/**
 * Admin-only edit of a container's full acquisition cost. Wraps the
 * `set_container_acquisition_costs` SECURITY DEFINER RPC — the single call site
 * so its guards (mandatory reason, admin gate, per-component create / adjust /
 * cancel semantics and the audit trail) can never be bypassed.
 */
export async function setContainerAcquisitionCosts(
  args: SetAcquisitionCostsArgs,
): Promise<Record<string, { amount: number; outcome: string; currency?: string }>> {
  if (!args.containerId) throw new Error("Container is required");
  const reason = (args.reason ?? "").trim();
  if (!reason) throw new Error("A reason is required");

  const base = cur(args.currency, "USD")!;
  const { data, error } = await supabase.rpc("set_container_acquisition_costs" as any, {
    _container_id: args.containerId,
    _purchase: pos(args.purchase),
    _transport: pos(args.transport),
    _transport_vendor: args.transportVendor?.trim() || null,
    _offloading: pos(args.offloading),
    _offloading_vendor: args.offloadingVendor?.trim() || null,
    _currency: base,
    _reason: reason,
    _purchase_currency: cur(args.purchaseCurrency, base),
    _transport_currency: cur(args.transportCurrency, base),
    _offloading_currency: cur(args.offloadingCurrency, base),
    _purchase_fx: rate(args.purchaseFx),
    _transport_fx: rate(args.transportFx),
    _offloading_fx: rate(args.offloadingFx),
    _transport_supplier_id: args.transportSupplierId ?? null,
    _offloading_supplier_id: args.offloadingSupplierId ?? null,
  });
  if (error) throw new Error(friendlyAcquisitionError(error.message));

  return (data ?? {}) as Record<string, { amount: number; outcome: string; currency?: string }>;
}


/* ------------------------------------------------------------------ preview */

export type AcqAction = "unchanged" | "create" | "adjust" | "cancel";

export interface AcqPreviewComponent {
  component: string;
  action: AcqAction;
  vendor: string | null;
  currency: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  paid_amount: number;
  old_amount: number;
  old_currency: string | null;
  new_amount: number;
  delta: number;
  purchase_order_id: string | null;
  /** Rate used to convert this component into the org base currency (null when unavailable). */
  fx_rate: number | null;
  /** Effective date of the rate that was applied. */
  fx_rate_date: string | null;
  /** Whether the rate came from the FX table ("auto") or was typed in ("manual"). */
  fx_rate_source?: "auto" | "manual" | null;

  base_currency: string | null;
  base_amount: number | null;
  ledger: string | null;
}

export interface FxRevaluationDetail {
  invoice_number: string | null;
  container_number: string | null;
  status: "revalued" | "skipped" | "failed";
  detail: string;
}

export interface FxRevaluationResult {
  revalued: number;
  unchanged: number;
  skipped: number;
  failed: number;
  base_currency: string;
  as_of: string;
  details: FxRevaluationDetail[];
}

/**
 * Recalculate the base-currency valuation of every open acquisition invoice in
 * a foreign currency, using the latest rate on or before `asOf`. Face values in
 * the vendor's own currency are untouched; each change is written to the
 * finance audit trail so it shows in the container's acquisition history.
 */
export async function revalueAcquisitionFx(
  currencyFrom?: string | null,
  asOf?: string,
): Promise<FxRevaluationResult> {
  const { data, error } = await supabase.rpc("revalue_acquisition_fx" as any, {
    _currency_from: currencyFrom ? currencyFrom.toUpperCase() : null,
    _as_of: asOf ?? new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return data as unknown as FxRevaluationResult;
}




export interface AcqPreviewIssue {
  component: string;
  code: string;
  message: string;
  fix: string;
}

export interface AcqPreview {
  container_id: string;
  container_number: string;
  container_status: string | null;
  owner: string | null;
  org_currency: string;
  components: AcqPreviewComponent[];
  blockers: AcqPreviewIssue[];
  warnings: AcqPreviewIssue[];
}

export interface PreviewArgs {
  containerId: string;
  purchase?: number | null;
  purchaseCurrency?: string | null;
  purchaseFx?: number | null;
  transport?: number | null;
  transportVendor?: string | null;
  transportCurrency?: string | null;
  transportFx?: number | null;
  offloading?: number | null;
  offloadingVendor?: string | null;
  offloadingCurrency?: string | null;
  offloadingFx?: number | null;
}

/**
 * Read-only dry run: what invoices and ledger entries an edit would produce,
 * plus blocking problems and warnings. The edit dialog and the bulk dialog use
 * the same RPC so the preview can never diverge from what gets saved.
 */
export async function previewAcquisitionCosts(args: PreviewArgs): Promise<AcqPreview> {
  const { data, error } = await supabase.rpc("preview_container_acquisition_costs" as any, {
    _container_id: args.containerId,
    _purchase: pos(args.purchase),
    _purchase_currency: cur(args.purchaseCurrency),
    _transport: pos(args.transport),
    _transport_vendor: args.transportVendor?.trim() || null,
    _transport_currency: cur(args.transportCurrency),
    _offloading: pos(args.offloading),
    _offloading_vendor: args.offloadingVendor?.trim() || null,
    _offloading_currency: cur(args.offloadingCurrency),
    _purchase_fx: rate(args.purchaseFx),
    _transport_fx: rate(args.transportFx),
    _offloading_fx: rate(args.offloadingFx),
  });
  if (error) throw error;
  return data as unknown as AcqPreview;
}


export interface BulkEditResult {
  containerId: string;
  containerNumber?: string | null;
  status: "applied" | "skipped" | "failed";
  detail: string;
}

/**
 * Apply the same acquisition-cost edit to many containers with one reason.
 * Every container is previewed first; those with blockers are skipped instead
 * of being partially written.
 */
export async function setAcquisitionCostsBulk(
  containers: { id: string; container_number?: string | null }[],
  input: Omit<SetAcquisitionCostsArgs, "containerId">,
): Promise<BulkEditResult[]> {
  const out: BulkEditResult[] = [];
  for (const c of containers) {
    try {
      const preview = await previewAcquisitionCosts({
        containerId: c.id,
        purchase: input.purchase,
        purchaseCurrency: input.purchaseCurrency ?? input.currency,
        purchaseFx: input.purchaseFx,
        transport: input.transport,
        transportVendor: input.transportVendor,
        transportCurrency: input.transportCurrency ?? input.currency,
        transportFx: input.transportFx,
        offloading: input.offloading,
        offloadingVendor: input.offloadingVendor,
        offloadingCurrency: input.offloadingCurrency ?? input.currency,
        offloadingFx: input.offloadingFx,
      });

      if (preview.blockers?.length) {
        out.push({
          containerId: c.id,
          containerNumber: c.container_number,
          status: "skipped",
          detail: preview.blockers.map((b) => b.message).join(" · "),
        });
        continue;
      }
      const res = await setContainerAcquisitionCosts({ ...input, containerId: c.id });
      const changed = Object.entries(res ?? {})
        .filter(([, v]: any) => v?.outcome && v.outcome !== "unchanged")
        .map(([k, v]: any) => `${k.replace("acquisition_", "").replace(/_/g, " ")}: ${v.outcome}`);
      out.push({
        containerId: c.id,
        containerNumber: c.container_number,
        status: "applied",
        detail: changed.length ? changed.join(" · ") : "no change needed",
      });
    } catch (e: any) {
      out.push({
        containerId: c.id,
        containerNumber: c.container_number,
        status: "failed",
        detail: e?.message ?? "Unknown error",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------- breakdowns */

export interface AcquisitionBreakdown {
  /** Seller / purchase-price invoice total, converted into `currency`. */
  purchase: number;
  /** Transport + crane / offloading invoice totals combined, converted into `currency`. */
  services: number;
  total: number;
  currency: string;
  /** True when the live invoices span currencies with no reliable conversion. */
  mixed: boolean;
  /** True when no live acquisition invoice exists for the container. */
  empty: boolean;
  /** Per-currency subtotals across all live acquisition invoices. */
  byCurrency: { currency: string; amount: number }[];
  /** Currency of the seller invoice, when there is one. */
  purchaseCurrency: string | null;
  /** Original (pre-conversion) seller amount, when it was billed in another currency. */
  purchaseSourceAmount: number | null;
  /** FX rate applied to the seller invoice (null when none was needed/available). */
  purchaseFxRate: number | null;
  /** Invoices we could not convert into `currency` — their raw amounts are included as-is. */
  unconverted: { invoice_number: string; currency: string; amount: number }[];
  /** Per-currency subtotals of the transport + crane invoices. */
  servicesByCurrency: { currency: string; amount: number }[];
}

const sumByCurrency = (invoices: AcqInvoice[], fallback: string) => {
  const map = new Map<string, number>();
  for (const i of invoices) {
    const c = (i.currency || fallback).toUpperCase();
    map.set(c, (map.get(c) ?? 0) + (Number(i.total_amount ?? 0) || 0));
  }
  return Array.from(map, ([currency, amount]) => ({ currency, amount }));
};

/**
 * Split the container's live acquisition invoices into purchase vs service costs,
 * converting every invoice into `baseCurrency` first. Without the conversion a
 * USD 1,700 seller invoice would be added to KES service invoices as 1,700.
 */
export function splitAcquisition(invoices: AcqInvoice[], baseCurrency: string): AcquisitionBreakdown {
  const base = (baseCurrency || "USD").toUpperCase();
  const live = invoices.filter((i) => !isVoidInvoice(i));
  const totals = computeAcquisitionTotal(invoices, base);
  const purchaseInvoices = live.filter((i) => i.reason === "purchase");
  const serviceInvoices = live.filter((i) =>
    ["acquisition_transport", "acquisition_crane_offloading"].includes(i.reason),
  );

  const unconverted: AcquisitionBreakdown["unconverted"] = [];
  const sum = (rows: AcqInvoice[]) =>
    rows.reduce((s, inv) => {
      const c = invoiceInBase(inv, base);
      if (!c.converted) {
        unconverted.push({ invoice_number: inv.invoice_number, currency: c.sourceCurrency, amount: c.amount });
      }
      return s + c.amount;
    }, 0);

  const purchase = round2(sum(purchaseInvoices));
  const services = round2(sum(serviceInvoices));
  const firstPurchase = purchaseInvoices[0];
  const purchaseConv = firstPurchase ? invoiceInBase(firstPurchase, base) : null;

  return {
    purchase,
    services,
    // Keep the parts and the total consistent: purchase + services IS the total.
    total: round2(purchase + services),
    currency: base,
    mixed: totals.mixed || unconverted.length > 0,
    empty: live.length === 0,
    byCurrency: totals.byCurrency,
    purchaseCurrency: firstPurchase?.currency?.toUpperCase() ?? null,
    purchaseSourceAmount:
      purchaseConv && purchaseConv.sourceCurrency !== base ? Number(firstPurchase?.total_amount ?? 0) : null,
    purchaseFxRate: purchaseConv && purchaseConv.sourceCurrency !== base ? purchaseConv.rate : null,
    unconverted,
    servicesByCurrency: sumByCurrency(serviceInvoices, base),
  };
}


/**
 * Fetch a container's acquisition breakdown.
 *
 * Split children never hold acquisition invoices of their own — they inherit an
 * equal share of the mother unit's cost, recorded on the conversion job. For
 * those we read the allocated share; everyone else is derived from invoices.
 */
export async function getContainerAcquisitionBreakdown(
  containerId: string | null | undefined,
  baseCurrency: string,
  containerNumber?: string | null,
): Promise<AcquisitionBreakdown> {
  const ccy = (baseCurrency || "USD").toUpperCase();
  const emptyResult: AcquisitionBreakdown = {
    purchase: 0,
    services: 0,
    total: 0,
    currency: ccy,
    mixed: false,
    empty: true,
    byCurrency: [],
    purchaseCurrency: null,
    purchaseSourceAmount: null,
    purchaseFxRate: null,
    unconverted: [],
    servicesByCurrency: [],
  };
  if (!containerId) return emptyResult;

  const { data: container } = await supabase
    .from("containers")
    .select("parent_container_id, acquisition_cost")
    .eq("id", containerId)
    .maybeSingle();

  if (container?.parent_container_id) {
    const { data: alloc } = await supabase
      .from("conversion_output_costs")
      .select("container_cost, total_cost")
      .eq("output_kind", "container")
      .eq("output_id", containerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const total = round2(Number(alloc?.total_cost ?? container.acquisition_cost ?? 0));
    const purchase = round2(Number(alloc?.container_cost ?? total));
    const services = round2(Math.max(total - purchase, 0));
    return {
      ...emptyResult,
      purchase,
      services,
      total: round2(purchase + services),
      empty: total === 0,
      byCurrency: total ? [{ currency: ccy, amount: total }] : [],
      servicesByCurrency: services ? [{ currency: ccy, amount: services }] : [],
    };
  }

  let q = supabase
    .from("supplier_invoices")
    .select("id, invoice_number, reason, total_amount, currency, status, base_amount")
    .in("reason", ACQ_REASONS as unknown as string[]);
  q = containerNumber
    ? q.or(`container_id.eq.${containerId},reference.eq.${containerNumber}`)
    : q.eq("container_id", containerId);
  const { data, error } = await q;
  if (error) throw error;
  return splitAcquisition((data ?? []) as unknown as AcqInvoice[], baseCurrency);
}

