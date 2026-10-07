import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---- Mock supabase client ----
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

import { acquireContainerFromOwner } from "@/lib/container-acquisition";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("acquireContainerFromOwner — invariants", () => {
  it("skips and returns null when containerId is missing (no RPC call)", async () => {
    const out = await acquireContainerFromOwner({
      containerId: null,
      amount: 1000,
      currency: "USD",
      reason: "sale",
      reference: "SLE-1",
    });
    expect(out).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("skips and returns null when amount is 0 or negative (prevents zero-value PO duplicates)", async () => {
    for (const amount of [0, -5, NaN]) {
      rpcMock.mockReset();
      const out = await acquireContainerFromOwner({
        containerId: "c-1",
        amount,
        currency: "USD",
        reason: "sale",
        reference: "SLE-1",
      });
      expect(out).toBeNull();
      expect(rpcMock).not.toHaveBeenCalled();
    }
  });

  it("issues exactly ONE RPC call with the correct payload (sale)", async () => {
    rpcMock.mockResolvedValueOnce({ data: "po-uuid-1", error: null });
    const out = await acquireContainerFromOwner({
      containerId: "c-1",
      amount: 1500,
      currency: "EUR",
      reason: "sale",
      reference: "SLE-42",
    });
    expect(out).toBe("po-uuid-1");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("acquire_container_from_owner", {
      _container_id: "c-1",
      _amount: 1500,
      _currency: "EUR",
      _reason: "sale",
      _reference: "SLE-42",
      _expected_owner: null,
      _fx_rate: null,
    });
  });

  it("forwards expectedOwner so buyer name never becomes the PO recipient", async () => {
    rpcMock.mockResolvedValueOnce({ data: "po-uuid-x", error: null });
    await acquireContainerFromOwner({
      containerId: "c-1",
      amount: 100,
      currency: "USD",
      reason: "sale",
      reference: "SLE-99",
      expectedOwner: "JJ MES DMCC",
    });
    expect(rpcMock.mock.calls[0][1]._expected_owner).toBe("JJ MES DMCC");
  });

  it("issues exactly ONE RPC call (conversion)", async () => {
    rpcMock.mockResolvedValueOnce({ data: "po-uuid-2", error: null });
    await acquireContainerFromOwner({
      containerId: "c-2",
      amount: 800,
      currency: "USD",
      reason: "conversion",
      reference: "CONV-9",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][1]._reason).toBe("conversion");
  });

  it("issues exactly ONE RPC call (gate-out sale)", async () => {
    rpcMock.mockResolvedValueOnce({ data: "po-uuid-3", error: null });
    await acquireContainerFromOwner({
      containerId: "c-3",
      amount: 2200,
      currency: "USD",
      reason: "gate_out_sale",
      reference: "EIR-7",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][1]._reason).toBe("gate_out_sale");
  });

  it("returns null when RPC no-ops server-side (owner == depot)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const out = await acquireContainerFromOwner({
      containerId: "c-1",
      amount: 100,
      currency: "USD",
      reason: "sale",
      reference: "X",
    });
    expect(out).toBeNull();
  });

  it("propagates RPC errors so the caller can roll back", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(
      acquireContainerFromOwner({
        containerId: "c-1",
        amount: 100,
        currency: "USD",
        reason: "sale",
        reference: "X",
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("defaults currency to USD when blank", async () => {
    rpcMock.mockResolvedValueOnce({ data: "po", error: null });
    await acquireContainerFromOwner({
      containerId: "c-1",
      amount: 10,
      currency: "",
      reason: "sale",
      reference: "X",
    });
    expect(rpcMock.mock.calls[0][1]._currency).toBe("USD");
  });
});

// ---- Source-level guardrails ----
// These prevent regressions where a future contributor reintroduces an
// inline `supabase.rpc("acquire_container_from_owner", ...)` call (which
// would bypass the helper's guards and could double-create PO documents
// if combined with the helper). All sale / conversion / gate-out paths
// MUST go through `acquireContainerFromOwner`.

const PAGES = [
  "src/views/ContainerSales.tsx",
  "src/views/ConversionDetail.tsx",
  "src/views/EIRRecords.tsx",
];

describe("acquisition RPC — single source of truth", () => {
  for (const file of PAGES) {
    it(`${file} uses the helper and never calls the RPC directly`, () => {
      const src = fs.readFileSync(path.resolve(file), "utf8");
      expect(src).toContain("acquireContainerFromOwner");
      // No raw RPC string in the page — only the helper module owns it.
      expect(src).not.toMatch(/acquire_container_from_owner/);
    });
  }

  it("only the helper module references the RPC name", () => {
    const helper = fs.readFileSync(
      path.resolve("src/lib/container-acquisition.ts"),
      "utf8",
    );
    expect(helper).toContain("acquire_container_from_owner");
  });
});
