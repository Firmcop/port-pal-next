/**
 * Helpers to convert a Quote into either a Conversion Job or one Container
 * Sale per container found on the quote. Both flows are idempotent — calling
 * them twice for the same quote yields the same result and never duplicates.
 */

import { getDefaultCurrency } from "@/lib/finance-format";

export type QuoteContainer = {
  id: string;
  container_number: string;
  size?: string | number | null;
  category?: string | null;
  purchase_price?: number | null;
  owner?: string | null;
};


export class NoContainersOnQuoteError extends Error {
  code = "no_containers_on_quote";
  constructor() {
    super("This quote has no container line items to convert.");
  }
}

type SB = any;

/** Read all containers referenced by a quote via quote_items(item_kind='container'). */
export async function getQuoteContainers(supabase: SB, quoteId: string): Promise<QuoteContainer[]> {
  const { data: items, error } = await supabase
    .from("quote_items")
    .select("ref_id")
    .eq("quote_id", quoteId)
    .eq("item_kind", "container")
    .not("ref_id", "is", null);
  if (error) throw error;
  const ids = Array.from(new Set((items ?? []).map((r: any) => r.ref_id as string).filter(Boolean)));
  if (!ids.length) return [];
  const { data: containers, error: e2 } = await supabase
    .from("containers")
    .select("id, container_number, size, category, purchase_price, owner")
    .in("id", ids);
  if (e2) throw e2;
  return (containers ?? []) as QuoteContainer[];
}

async function fetchQuote(supabase: SB, quoteId: string) {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_number, customer_id, total_amount, status, notes")
    .eq("id", quoteId)
    .single();
  if (error) throw error;
  return data;
}



async function markQuoteAccepted(supabase: SB, quoteId: string, currentStatus: string) {
  if (currentStatus === "accepted") return;
  await supabase.from("quotes").update({ status: "accepted" }).eq("id", quoteId);
}

export type ConvertToJobResult = {
  jobId: string;
  alreadyExisted: boolean;
  containerIds: string[];
  copiedLines: { materials: number; labour: number; services: number };
};

export async function convertQuoteToConversionJob(
  supabase: SB,
  opts: { quoteId: string; userId?: string | null; selectedContainerIds?: string[] },
): Promise<ConvertToJobResult> {
  const quote = await fetchQuote(supabase, opts.quoteId);
  const all = await getQuoteContainers(supabase, opts.quoteId);
  const picked = opts.selectedContainerIds?.length
    ? all.filter((c) => opts.selectedContainerIds!.includes(c.id))
    : all;

  // Idempotency guard
  const { data: existing, error: exErr } = await supabase
    .from("container_conversions")
    .select("id")
    .eq("quote_id", opts.quoteId)
    .limit(1)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing?.id) {
    return {
      jobId: existing.id as string,
      alreadyExisted: true,
      containerIds: picked.map((c) => c.id),
      copiedLines: { materials: 0, labour: 0, services: 0 },
    };
  }

  // Choose product_type: containers => office (existing behavior);
  // no containers => infer steel_structure if description hints at steel, else fabrication.
  let productType: string = "office";
  if (!picked.length) {
    const hay = `${quote.quote_number ?? ""} ${quote.notes ?? ""}`.toLowerCase();
    productType = /\bsteel|structur|truss|beam|frame|rafter|purlin\b/.test(hay)
      ? "steel_structure"
      : "fabrication";
  }

  const { data: inserted, error: insErr } = await supabase
    .from("container_conversions")
    .insert({
      quote_id: opts.quoteId,

      customer_id: quote.customer_id,
      job_kind: "product",
      product_type: productType,
      status: "planning",
      qty_produced: Math.max(picked.length, 1),
      quoted_price: Number(quote.total_amount ?? 0),
      description: `From quote ${quote.quote_number}`,
      created_by: opts.userId ?? null,
    })
    .select("id")
    .single();
  if (insErr) {
    // A unique violation here is a job-number collision, not an already-converted quote.
    if (
      (insErr as any)?.code === "23505" ||
      /duplicate key/i.test((insErr as any)?.message ?? "")
    ) {
      throw new Error(
        "Could not allocate a job number for this quote (numbering conflict). Please try again.",
      );
    }
    throw insErr;
  }
  const jobId = inserted!.id as string;

  for (const c of picked) {
    // Attach at the container's live acquisition cost (seller + transport/crane)
    // rather than zero, so the new job's margin is right from the start.
    let purchase = 0;
    let transport = 0;
    try {
      const { data: split, error: splitErr } = await supabase.rpc("container_acquisition_split", {
        _container_id: c.id,
        _currency: getDefaultCurrency(),
      });
      if (splitErr) throw splitErr;
      const row = Array.isArray(split) ? split[0] : split;
      purchase = Number(row?.purchase ?? 0);
      transport = Number(row?.services ?? 0);
    } catch {
      purchase = Number(c.purchase_price ?? 0);
    }

    const { error: rpcErr } = await supabase.rpc("attach_container_to_conversion", {
      _conversion_id: jobId,
      _container_id: c.id,
      _container_cost: purchase,
      _transport_offloading_cost: transport,
    });
    if (rpcErr) throw rpcErr;
  }


  // Quote lines are NOT copied into cost lines — only the quoted total carries over.
  // All materials/labour/services are entered on the conversion job page.
  await markQuoteAccepted(supabase, opts.quoteId, quote.status);
  return {
    jobId,
    alreadyExisted: false,
    containerIds: picked.map((c) => c.id),
    copiedLines: { materials: 0, labour: 0, services: 0 },
  };
}

export type ConvertToSaleResult = { saleIds: string[]; alreadyExisted: boolean };

export async function convertQuoteToContainerSales(
  supabase: SB,
  opts: {
    quoteId: string;
    userId?: string | null;
    /** Optional per-container price overrides. If omitted, splits quote total evenly. */
    priceByContainerId?: Record<string, number>;
    selectedContainerIds?: string[];
  },
): Promise<ConvertToSaleResult> {
  const quote = await fetchQuote(supabase, opts.quoteId);
  const all = await getQuoteContainers(supabase, opts.quoteId);
  const picked = opts.selectedContainerIds?.length
    ? all.filter((c) => opts.selectedContainerIds!.includes(c.id))
    : all;
  if (!picked.length) throw new NoContainersOnQuoteError();

  // Idempotency guard
  const { data: existing, error: exErr } = await supabase
    .from("container_sales")
    .select("id")
    .eq("quote_id", opts.quoteId);
  if (exErr) throw exErr;
  if (existing && existing.length) {
    return { saleIds: existing.map((r: any) => r.id as string), alreadyExisted: true };
  }

  const total = Number(quote.total_amount ?? 0);
  const evenSplit = picked.length > 0 ? total / picked.length : 0;

  const rows = picked.map((c) => ({
    sale_number: `CS-${Date.now().toString(36).toUpperCase()}-${c.container_number}`,
    quote_id: opts.quoteId,
    customer_id: quote.customer_id,
    container_id: c.id,
    buyer_name: "TBD",
    entry_price: Number(c.purchase_price ?? 0),
    markup_percentage: 0,
    selling_price: opts.priceByContainerId?.[c.id] ?? evenSplit,
    status: "listed",
    original_owner: c.owner ?? null,
    created_by: opts.userId ?? null,
  }));

  const { data: created, error: insErr } = await supabase
    .from("container_sales")
    .insert(rows)
    .select("id");
  if (insErr) throw insErr;

  await markQuoteAccepted(supabase, opts.quoteId, quote.status);
  return { saleIds: (created ?? []).map((r: any) => r.id as string), alreadyExisted: false };
}
