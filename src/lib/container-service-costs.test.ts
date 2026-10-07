import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

import { recordContainerServiceInvoice } from "@/lib/container-service-costs";

beforeEach(() => rpcMock.mockReset());

describe("recordContainerServiceInvoice — guards", () => {
  it("skips when containerId is missing", async () => {
    const out = await recordContainerServiceInvoice({
      containerId: null, vendorName: "ACME", amount: 100, currency: "USD", serviceKind: "transport",
    });
    expect(out).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("skips when vendor is blank", async () => {
    const out = await recordContainerServiceInvoice({
      containerId: "c-1", vendorName: "   ", amount: 100, currency: "USD", serviceKind: "transport",
    });
    expect(out).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("skips when amount is not positive", async () => {
    for (const amount of [0, -1, NaN, null]) {
      rpcMock.mockReset();
      const out = await recordContainerServiceInvoice({
        containerId: "c-1", vendorName: "ACME", amount: amount as any, currency: "USD", serviceKind: "crane_offloading",
      });
      expect(out).toBeNull();
      expect(rpcMock).not.toHaveBeenCalled();
    }
  });

  it("issues exactly ONE RPC call with the correct payload", async () => {
    rpcMock.mockResolvedValueOnce({ data: "po-1", error: null });
    const out = await recordContainerServiceInvoice({
      containerId: "c-1", vendorName: " Speedy Haulage ", amount: 250, currency: "kes",
      serviceKind: "transport", reference: "MSCU1234567",
    });
    expect(out).toBe("po-1");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("record_container_service_invoice", {
      _container_id: "c-1",
      _vendor_name: "Speedy Haulage",
      _amount: 250,
      _currency: "KES",
      _service_kind: "transport",
      _reference: "MSCU1234567",
      _fx_rate: null,
    });
  });

  it("returns null when the RPC no-ops server-side (already invoiced)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const out = await recordContainerServiceInvoice({
      containerId: "c-1", vendorName: "Crane Co", amount: 50, currency: "USD", serviceKind: "crane_offloading",
    });
    expect(out).toBeNull();
  });

  it("propagates RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(
      recordContainerServiceInvoice({
        containerId: "c-1", vendorName: "Crane Co", amount: 50, currency: "USD", serviceKind: "crane_offloading",
      }),
    ).rejects.toMatchObject({ message: "boom" });
  });
});

describe("service invoice RPC — single source of truth", () => {
  for (const file of ["src/views/Inventory.tsx", "src/lib/container-backfill.ts"]) {
    it(`${file} uses the helper and never calls the RPC directly`, () => {
      const src = fs.readFileSync(path.resolve(file), "utf8");
      expect(src).toContain("recordContainerServiceInvoice");
      expect(src).not.toMatch(/record_container_service_invoice/);
    });
  }
});
