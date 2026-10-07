import { describe, it, expect, vi } from "vitest";

const invokeMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: any[]) => invokeMock(...a) },
    from: (table: string) => fromMock(table),
  },
}));

import { supabase } from "@/integrations/supabase/client";

describe("Blank workspace provisioning", () => {
  it("provision-organization is invoked with country/currency/timezone", async () => {
    invokeMock.mockResolvedValue({ data: { organization_id: "new-org-id" }, error: null });

    const payload = {
      name: "Acme Depot Co",
      country: "Kenya",
      currency: "KES",
      timezone: "Africa/Nairobi",
      depotName: "Mombasa",
      depotCode: "MSA1",
    };
    const { data, error } = await supabase.functions.invoke("provision-organization", { body: payload });

    expect(error).toBeNull();
    expect(data).toMatchObject({ organization_id: "new-org-id" });
    expect(invokeMock).toHaveBeenCalledWith(
      "provision-organization",
      expect.objectContaining({ body: expect.objectContaining({ currency: "KES", timezone: "Africa/Nairobi" }) })
    );
  });

  it("a freshly provisioned org returns empty rows for business tables", async () => {
    const newOrgId = "new-org-id";
    const select = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
    }));
    fromMock.mockImplementation(() => ({ select }));

    for (const table of ["containers", "customers", "invoices"]) {
      const { data } = await ((supabase as any).from(table)).select("*").eq("organization_id", newOrgId);
      expect(data).toEqual([]);
    }
    expect(fromMock).toHaveBeenCalledTimes(3);
  });

  it("does not leak rows from the legacy default org", async () => {
    const LEGACY = "00000000-0000-0000-0000-000000000001";
    const newOrgId = "new-org-id";
    const eq = vi.fn((_col: string, val: string) => {
      if (val === LEGACY) return Promise.resolve({ data: [{ id: 1 }, { id: 2 }], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    fromMock.mockImplementation(() => ({ select: () => ({ eq }) }));

    const { data: legacy } = await (supabase.from("containers") as any).select("*").eq("organization_id", LEGACY);
    const { data: fresh } = await (supabase.from("containers") as any).select("*").eq("organization_id", newOrgId);
    expect(legacy.length).toBeGreaterThan(0);
    expect(fresh).toEqual([]);
  });
});
