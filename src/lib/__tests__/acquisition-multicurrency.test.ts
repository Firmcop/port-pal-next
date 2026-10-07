import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpc(...a) },
}));

import { splitAcquisition, setAcquisitionCostsBulk } from "@/lib/container-acquisition-edit";
import type { AcqInvoice } from "@/lib/acquisition-costs";

const inv = (o: Partial<AcqInvoice>): AcqInvoice => ({
  id: Math.random().toString(),
  invoice_number: "PINV-1",
  reason: "purchase",
  total_amount: 0,
  currency: "USD",
  status: "issued",
  ...o,
});

describe("splitAcquisition across currencies", () => {
  it("keeps the seller currency separate from the service currencies", () => {
    const res = splitAcquisition(
      [
        inv({ reason: "purchase", total_amount: 2400, currency: "USD" }),
        inv({ reason: "acquisition_transport", total_amount: 60000, currency: "KES" }),
        inv({ reason: "acquisition_crane_offloading", total_amount: 25000, currency: "KES" }),
      ],
      "KES",
    );
    expect(res.purchaseCurrency).toBe("USD");
    expect(res.servicesByCurrency).toEqual([{ currency: "KES", amount: 85000 }]);
    expect(res.byCurrency.sort((a, b) => a.currency.localeCompare(b.currency))).toEqual([
      { currency: "KES", amount: 85000 },
      { currency: "USD", amount: 2400 },
    ]);
    // No base_amount on the USD invoice -> refuse a bogus combined total.
    expect(res.mixed).toBe(true);
  });

  it("uses the FX-locked base amount for a combined total when available", () => {
    const res = splitAcquisition(
      [
        inv({ reason: "purchase", total_amount: 100, currency: "USD", base_amount: 13000 }),
        inv({ reason: "acquisition_transport", total_amount: 5000, currency: "KES" }),
      ],
      "KES",
    );
    expect(res.mixed).toBe(false);
    expect(res.total).toBe(18000);
  });

  it("excludes cancelled invoices", () => {
    const res = splitAcquisition(
      [
        inv({ reason: "purchase", total_amount: 500, currency: "USD", status: "cancelled" }),
        inv({ reason: "acquisition_transport", total_amount: 200, currency: "USD" }),
      ],
      "USD",
    );
    expect(res.purchase).toBe(0);
    expect(res.total).toBe(200);
  });
});

describe("setAcquisitionCostsBulk", () => {
  beforeEach(() => rpc.mockReset());

  it("skips containers whose preview reports a blocker and applies the rest", async () => {
    rpc.mockImplementation((fn: string, args: any) => {
      if (fn === "preview_container_acquisition_costs") {
        return Promise.resolve({
          data:
            args._container_id === "bad"
              ? { blockers: [{ code: "missing_vendor", message: "no vendor", fix: "add one" }], warnings: [], components: [] }
              : { blockers: [], warnings: [], components: [] },
          error: null,
        });
      }
      return Promise.resolve({
        data: { acquisition_transport: { amount: 100, outcome: "created" } },
        error: null,
      });
    });

    const res = await setAcquisitionCostsBulk(
      [
        { id: "bad", container_number: "AAAA1" },
        { id: "good", container_number: "BBBB2" },
      ],
      { purchase: 0, transport: 100, transportVendor: "Acme", offloading: 0, currency: "KES", reason: "correction" },
    );

    expect(res[0].status).toBe("skipped");
    expect(res[1].status).toBe("applied");
    // The blocked container must never reach the write RPC.
    const writes = rpc.mock.calls.filter((c) => c[0] === "set_container_acquisition_costs");
    expect(writes).toHaveLength(1);
    expect(writes[0][1]._container_id).toBe("good");
  });

  it("reports failures instead of throwing", async () => {
    rpc.mockImplementation((fn: string) =>
      fn === "preview_container_acquisition_costs"
        ? Promise.resolve({ data: { blockers: [], warnings: [], components: [] }, error: null })
        : Promise.resolve({ data: null, error: { message: "Only admins can edit acquisition costs" } }),
    );
    const res = await setAcquisitionCostsBulk([{ id: "x", container_number: "CCCC3" }], {
      purchase: 0,
      transport: 10,
      transportVendor: "Acme",
      offloading: 0,
      currency: "USD",
      reason: "test",
    });
    expect(res[0].status).toBe("failed");
    expect(res[0].detail).toMatch(/admin/);
  });
});
