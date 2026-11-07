import { describe, expect, it, vi } from "vitest";
import { generateEirPrint, type EirPrintData } from "@/lib/eir-templates";

// jsdom has no canvas: the QR code and barcode only need a context that accepts calls.
const ctx: any = new Proxy({}, {
  get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "canvas" ? document.createElement("canvas") : () => {}),
  set: () => true,
});
HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,";

function capture() {
  let html = "";
  vi.spyOn(window, "open").mockReturnValue({
    document: { write: (h: string) => { html += h; }, close: () => {} },
    print: () => {},
  } as any);
  return () => html;
}

const base: EirPrintData = {
  eir_number: "EIR-TEST-0001",
  eir_type: "gate_out",
  condition_grade: "A",
  cargo_status: "empty",
  seal_number: null,
  damage_description: null,
  inspector_notes: null,
  release_purpose: "sold_unit",
  released_by_name: "Gate clerk",
  released_by_role: "gate_clerk",
  truck_plate: "KDA 123A",
  driver_name: "Driver",
  driver_phone: "0700000000",
  transporter_company: "Transporter",
  transporter_indemnity_signed: true,
  transporter_indemnity_signer: "Driver",
  transporter_indemnity_signed_at: "2026-11-07T10:00:00Z",
  completed_at: "2026-11-07T10:00:00Z",
  created_at: "2026-11-07T10:00:00Z",
  container: {
    container_number: "TGHU 8339174", size: "40", iso_type: "45G1", category: "dry",
    owner: "Firmcop Limited", shipping_line: null, tare_weight_kg: null, weight_kg: null, is_empty: true, status: "gated_out",
  } as any,
  buyer: { label: "Buyer (New Owner)", name: "Naibor Stores Ltd", original_owner: "Firmcop Limited" } as any,
  owner_at_issue: "Firmcop Limited",
  new_owner: "Naibor Stores Ltd",
} as any;

describe("gate-out EIR print", () => {
  for (const template of ["standard", "compact", "minimal"] as const) {
    it(`${template}: shows the product, its source containers and the ownership transfer`, async () => {
      const html = capture();
      await generateEirPrint({ ...base, product_name: "2-Bedroom Container House", source_containers: "TGHU 8339174 + WHLU5591123" }, template);
      const out = html();
      expect(out).toContain("2-Bedroom Container House");
      expect(out).toContain("TGHU 8339174 + WHLU5591123");
      expect(out).toContain("Made from");
      expect(out).toContain("Firmcop Limited");
      expect(out).toContain("Naibor Stores Ltd");
      expect(out).toMatch(/Prev(ious|\.) Owner/);
    });
  }

  it("a unit sold as it is has no product line", async () => {
    const html = capture();
    await generateEirPrint(base, "standard");
    expect(html()).not.toContain("Made from");
  });
});
