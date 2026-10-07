import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  convertQuoteToConversionJob,
  convertQuoteToContainerSales,
  NoContainersOnQuoteError,
} from "@/lib/quote-conversion";

type Row = Record<string, any>;

function makeSupabase(state: {
  quote: Row;
  quoteItems: Row[];
  containers: Row[];
  existingConversion?: Row | null;
  existingSales?: Row[];
}) {
  const inserted: Record<string, Row[]> = {
    container_conversions: [],
    container_sales: [],
    conversion_materials: [],
    conversion_labour: [],
    conversion_services: [],
  };
  const updated: Record<string, Row[]> = { quotes: [] };
  const rpcCalls: { name: string; args: any }[] = [];

  const from = (table: string) => {
    const builder: any = { _table: table, _op: "select" as string, _filters: [] as any[] };
    const chain = (obj: any) => Object.assign(obj, builder);

    builder.select = (_cols?: string) => chain(builder);
    builder.eq = (col: string, val: any) => { builder._filters.push(["eq", col, val]); return builder; };
    builder.in = (col: string, vals: any[]) => { builder._filters.push(["in", col, vals]); return builder; };
    builder.not = () => builder;
    builder.limit = () => builder;
    builder.order = () => builder;

    builder.maybeSingle = async () => {
      if (table === "container_conversions") {
        return { data: state.existingConversion ?? null, error: null };
      }
      return { data: null, error: null };
    };
    builder.single = async () => {
      if (table === "quotes") return { data: state.quote, error: null };
      if (builder._op === "insert") {
        const row = inserted[table]?.[inserted[table].length - 1];
        return { data: { id: row?.id ?? `${table}-new` }, error: null };
      }
      return { data: null, error: null };
    };

    // Terminal for list-returning selects
    const runSelect = async () => {
      if (table === "quote_items") return { data: state.quoteItems, error: null };
      if (table === "containers") return { data: state.containers, error: null };
      if (table === "container_sales") return { data: state.existingSales ?? [], error: null };
      return { data: [], error: null };
    };
    builder.then = (resolve: any, reject: any) => runSelect().then(resolve, reject);

    builder.insert = (rows: Row | Row[]) => {
      builder._op = "insert";
      const list = Array.isArray(rows) ? rows : [rows];
      list.forEach((r, i) => inserted[table].push({ ...r, id: `${table}-${inserted[table].length + 1}` }));
      const chained: any = {
        select: () => ({
          single: async () => ({ data: { id: inserted[table][inserted[table].length - 1].id }, error: null }),
          then: (resolve: any) => resolve({ data: inserted[table].slice(-list.length), error: null }),
        }),
      };
      return chained;
    };

    builder.update = (patch: Row) => {
      updated[table] = updated[table] ?? [];
      updated[table].push(patch);
      return { eq: async () => ({ data: null, error: null }) };
    };
    return builder;
  };

  const supabase: any = {
    from,
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  };
  return { supabase, inserted, updated, rpcCalls };
}

const quote: Row = {
  id: "q-1",
  quote_number: "QTE-001",
  customer_id: "cust-1",
  total_amount: 900,
  currency: "USD",
  status: "approved",
};
const quoteItems = [
  { id: "qi-1", item_kind: "container", ref_id: "cont-1" },
  { id: "qi-2", item_kind: "container", ref_id: "cont-2" },
  { id: "qi-3", item_kind: "container", ref_id: "cont-3" },
];
const workOnlyQuoteItems = [
  { id: "qi-mat", item_kind: "material", description: "Steel framing", quantity: 2, unit_price: 100, total_price: 200 },
  { id: "qi-lab", item_kind: "labor", description: "Fabrication labour", quantity: 5, unit_price: 30, total_price: 150 },
  { id: "qi-svc", item_kind: "service", description: "Transport", quantity: 1, unit_price: 75, total_price: 75 },
];
const containers = [
  { id: "cont-1", container_number: "ABCU1000000", purchase_price: 100, owner: "OwnerA" },
  { id: "cont-2", container_number: "ABCU2000000", purchase_price: 120, owner: "OwnerA" },
  { id: "cont-3", container_number: "ABCU3000000", purchase_price: 90, owner: "OwnerB" },
];

describe("convertQuoteToConversionJob", () => {
  it("creates one job and attaches every container from the quote", async () => {
    const { supabase, inserted, rpcCalls } = makeSupabase({ quote, quoteItems, containers });
    const res = await convertQuoteToConversionJob(supabase, { quoteId: "q-1", userId: "u-1" });
    expect(res.alreadyExisted).toBe(false);
    expect(inserted.container_conversions).toHaveLength(1);
    expect(inserted.container_conversions[0].quote_id).toBe("q-1");
    expect(inserted.container_conversions[0].qty_produced).toBe(3);
    expect(rpcCalls.filter((c) => c.name === "attach_container_to_conversion")).toHaveLength(3);
    expect(res.containerIds).toEqual(["cont-1", "cont-2", "cont-3"]);
  });

  it("creates a conversion job from work-only quotes without copying any cost lines", async () => {
    const { supabase, inserted, rpcCalls } = makeSupabase({ quote, quoteItems: workOnlyQuoteItems, containers: [] });
    const res = await convertQuoteToConversionJob(supabase, { quoteId: "q-1", userId: "u-1" });
    expect(res.alreadyExisted).toBe(false);
    expect(inserted.container_conversions).toHaveLength(1);
    expect(inserted.container_conversions[0].qty_produced).toBe(1);
    expect(inserted.container_conversions[0].quoted_price).toBe(900);
    expect(rpcCalls.filter((c) => c.name === "attach_container_to_conversion")).toHaveLength(0);
    expect(inserted.conversion_materials).toHaveLength(0);
    expect(inserted.conversion_labour).toHaveLength(0);
    expect(inserted.conversion_services).toHaveLength(0);
    expect(res.containerIds).toEqual([]);
    expect(res.copiedLines).toEqual({ materials: 0, labour: 0, services: 0 });
    expect(inserted.container_conversions[0].product_type).toBe("fabrication");
  });

  it("is idempotent — returns the existing job without inserting again", async () => {
    const { supabase, inserted, rpcCalls } = makeSupabase({
      quote, quoteItems, containers, existingConversion: { id: "job-existing" },
    });
    const res = await convertQuoteToConversionJob(supabase, { quoteId: "q-1" });
    expect(res.alreadyExisted).toBe(true);
    expect(res.jobId).toBe("job-existing");
    expect(inserted.container_conversions).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("still requires container line items for container sales", async () => {
    const { supabase } = makeSupabase({ quote, quoteItems: [], containers: [] });
    await expect(convertQuoteToContainerSales(supabase, { quoteId: "q-1" }))
      .rejects.toBeInstanceOf(NoContainersOnQuoteError);
  });
});

describe("convertQuoteToContainerSales", () => {
  it("creates one sale per container splitting the quote total evenly", async () => {
    const { supabase, inserted } = makeSupabase({ quote, quoteItems, containers });
    const res = await convertQuoteToContainerSales(supabase, { quoteId: "q-1" });
    expect(res.alreadyExisted).toBe(false);
    expect(inserted.container_sales).toHaveLength(3);
    const prices = inserted.container_sales.map((r) => r.selling_price);
    expect(prices).toEqual([300, 300, 300]);
    expect(inserted.container_sales.every((r) => r.quote_id === "q-1")).toBe(true);
  });

  it("is idempotent — returns existing sale ids without duplicating", async () => {
    const { supabase, inserted } = makeSupabase({
      quote, quoteItems, containers,
      existingSales: [{ id: "sale-a" }, { id: "sale-b" }, { id: "sale-c" }],
    });
    const res = await convertQuoteToContainerSales(supabase, { quoteId: "q-1" });
    expect(res.alreadyExisted).toBe(true);
    expect(res.saleIds).toEqual(["sale-a", "sale-b", "sale-c"]);
    expect(inserted.container_sales).toHaveLength(0);
  });

  it("respects per-container price overrides", async () => {
    const { supabase, inserted } = makeSupabase({ quote, quoteItems, containers });
    await convertQuoteToContainerSales(supabase, {
      quoteId: "q-1",
      priceByContainerId: { "cont-1": 400, "cont-2": 350, "cont-3": 150 },
    });
    expect(inserted.container_sales.map((r) => r.selling_price)).toEqual([400, 350, 150]);
  });
});
