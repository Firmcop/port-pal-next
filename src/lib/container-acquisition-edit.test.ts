import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

import { setContainerAcquisitionCosts, splitAcquisition } from "@/lib/container-acquisition-edit";

beforeEach(() => rpcMock.mockReset());

describe("setContainerAcquisitionCosts — guards", () => {
  it("refuses without a container", async () => {
    await expect(
      setContainerAcquisitionCosts({
        containerId: null, purchase: 1, transport: 0, offloading: 0, currency: "USD", reason: "fix",
      }),
    ).rejects.toThrow(/container/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses without a reason", async () => {
    await expect(
      setContainerAcquisitionCosts({
        containerId: "c-1", purchase: 1, transport: 0, offloading: 0, currency: "USD", reason: "   ",
      }),
    ).rejects.toThrow(/reason/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("issues exactly ONE RPC call with a normalised payload", async () => {
    rpcMock.mockResolvedValueOnce({ data: { purchase: { amount: 100, outcome: "created" } }, error: null });
    const out = await setContainerAcquisitionCosts({
      containerId: "c-1", purchase: 100, transport: -5, transportVendor: " Speedy ",
      offloading: 20, offloadingVendor: "", currency: "kes", reason: " typo ",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("set_container_acquisition_costs", {
      _container_id: "c-1",
      _purchase: 100,
      _transport: 0,
      _transport_vendor: "Speedy",
      _offloading: 20,
      _offloading_vendor: null,
      _currency: "KES",
      _reason: "typo",
      _purchase_currency: "KES",
      _transport_currency: "KES",
      _offloading_currency: "KES",
      _purchase_fx: null,
      _transport_fx: null,
      _offloading_fx: null,
      _transport_supplier_id: null,
      _offloading_supplier_id: null,
    });
    expect(out.purchase.outcome).toBe("created");
  });

  it("propagates RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not admin" } });
    await expect(
      setContainerAcquisitionCosts({
        containerId: "c-1", purchase: 1, transport: 0, offloading: 0, currency: "USD", reason: "fix",
      }),
    ).rejects.toMatchObject({ message: "not admin" });
  });
});

describe("splitAcquisition", () => {
  const inv = (reason: string, total: number, status = "issued", currency = "USD") =>
    ({ id: reason + total, invoice_number: "PINV-1", reason, total_amount: total, currency, status }) as any;

  it("splits purchase vs services and excludes void invoices", () => {
    const out = splitAcquisition(
      [
        inv("purchase", 1000),
        inv("acquisition_transport", 200),
        inv("acquisition_crane_offloading", 50),
        inv("acquisition_transport", 999, "cancelled"),
      ],
      "USD",
    );
    expect(out.purchase).toBe(1000);
    expect(out.services).toBe(250);
    expect(out.total).toBe(1250);
    expect(out.empty).toBe(false);
    expect(out.mixed).toBe(false);
  });

  it("flags mixed currencies with no conversion", () => {
    const out = splitAcquisition([inv("purchase", 1000, "issued", "KES"), inv("acquisition_transport", 20, "issued", "USD")], "USD");
    expect(out.mixed).toBe(true);
  });

  it("reports empty when nothing live exists", () => {
    expect(splitAcquisition([inv("purchase", 100, "credited")], "USD").empty).toBe(true);
  });
});

describe("acquisition edit RPC — single source of truth", () => {
  for (const file of [
    "src/components/containers/AcquisitionCostPanel.tsx",
    "src/views/ContainerSales.tsx",
    "src/views/Conversions.tsx",
  ]) {
    it(`${file} never calls the RPC directly`, () => {
      const src = fs.readFileSync(path.resolve(file), "utf8");
      expect(src).not.toMatch(/rpc\(\s*"set_container_acquisition_costs/);
    });
  }
});
