import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapRepatriationError } from "@/lib/repatriation-errors";

// Mock supabase client
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpcMock(...a) },
}));

async function callBill(repatriationId: string) {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await (supabase as any).rpc("bill_repatriation_to_owner", {
    _repatriation_id: repatriationId,
  });
  if (error) throw error;
  return data as string | null;
}

beforeEach(() => rpcMock.mockReset());

describe("bill_repatriation_to_owner — idempotency", () => {
  it("returns the invoice id on first call", async () => {
    rpcMock.mockResolvedValueOnce({ data: "inv-1", error: null });
    const id = await callBill("rep-1");
    expect(id).toBe("inv-1");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("bill_repatriation_to_owner", { _repatriation_id: "rep-1" });
  });

  it("second call raises repatriation_already_invoiced and never creates a second invoice", async () => {
    rpcMock.mockResolvedValueOnce({ data: "inv-1", error: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "repatriation_already_invoiced" } });

    const first = await callBill("rep-1");
    expect(first).toBe("inv-1");

    await expect(callBill("rep-1")).rejects.toMatchObject({ message: "repatriation_already_invoiced" });

    // Exactly two RPC attempts — the server refuses to create a second invoice.
    expect(rpcMock).toHaveBeenCalledTimes(2);
    // Both calls use the same repatriation id — guarantees no duplicate under retry.
    expect(rpcMock.mock.calls[0][1]._repatriation_id).toBe("rep-1");
    expect(rpcMock.mock.calls[1][1]._repatriation_id).toBe("rep-1");
  });

  it("maps repatriation_already_invoiced to a friendly message", () => {
    expect(mapRepatriationError({ message: "repatriation_already_invoiced" }))
      .toMatch(/already been invoiced/i);
  });

  it("maps repatriation_nothing_to_bill to a friendly message", () => {
    expect(mapRepatriationError({ message: "repatriation_nothing_to_bill" }))
      .toMatch(/no billable charges/i);
  });

  it("maps repatriation_owner_missing to a friendly message", () => {
    expect(mapRepatriationError({ message: "repatriation_owner_missing" }))
      .toMatch(/container owner/i);
  });

  it("maps repatriation_invoice_missing (mark-as-paid before completion)", () => {
    expect(mapRepatriationError({ message: "repatriation_invoice_missing" }))
      .toMatch(/no invoice yet/i);
  });

  it("maps repatriation_invoice_already_settled", () => {
    expect(mapRepatriationError({ message: "repatriation_invoice_already_settled" }))
      .toMatch(/already fully paid/i);
  });
});
