import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the PO issuance rule: acquisition POs generated on sale,
 * conversion/split, and gate-out MUST target the sale's original owner,
 * never the buyer. The `expectedOwner` argument is how call sites
 * pin the resolver to the correct upstream party (JJ MES DMCC etc.).
 *
 * These tests are static-analysis guards over the three known call sites
 * so a future refactor cannot silently drop `expectedOwner` and start
 * issuing POs to the buyer again.
 */

interface CallsiteExpectation {
  file: string;
  reason: "sale" | "conversion" | "gate_out_sale";
}

const CALLSITES: CallsiteExpectation[] = [
  { file: "src/views/ContainerSales.tsx",  reason: "sale" },
  { file: "src/views/ConversionDetail.tsx", reason: "conversion" },
  { file: "src/views/EIRRecords.tsx",       reason: "gate_out_sale" },
];

function readCallBlock(file: string): string {
  const src = fs.readFileSync(path.resolve(file), "utf8");
  const idx = src.indexOf("acquireContainerFromOwner(");
  if (idx < 0) return "";
  // Grab a generous window that will contain the argument object literal.
  return src.slice(idx, idx + 800);
}

describe("PO recipient rules — buyer is never routed as expectedOwner", () => {
  for (const { file, reason } of CALLSITES) {
    it(`${file} declares reason='${reason}'`, () => {
      const block = readCallBlock(file);
      expect(block, `${file} must call acquireContainerFromOwner`).not.toBe("");
      expect(block).toContain(`reason: "${reason}"`);
    });

    it(`${file} never passes the buyer as expectedOwner`, () => {
      const block = readCallBlock(file);
      expect(block).not.toMatch(/expectedOwner:\s*[^,\n]*buyer_name/);
      expect(block).not.toMatch(/expectedOwner:\s*[^,\n]*\.buyer\b/);
    });
  }

  it("ContainerSales derives expectedOwner from original_owner or container owner (not buyer)", () => {
    const src = fs.readFileSync(
      path.resolve("src/views/ContainerSales.tsx"),
      "utf8",
    );
    // markSold must resolve originalOwner from the sale/container, then pass it.
    expect(src).toMatch(/original_owner|shipping_line|containers\?\.owner/);
    expect(src).toContain("expectedOwner: originalOwner");
  });

  it("PoRecipientPreview is mounted on the Sell dialog for pre-submit visibility", () => {
    const src = fs.readFileSync(
      path.resolve("src/views/ContainerSales.tsx"),
      "utf8",
    );
    expect(src).toContain("PoRecipientPreview");
  });
});

describe("PO recipient preview — helper labels", () => {
  it("classifies each recipient source with a human label", async () => {
    const mod = await import("@/components/finance/PoRecipientPreview");
    expect(mod.sourceLabel("expected_owner")).toBe("Expected owner");
    expect(mod.sourceLabel("sale_original_owner")).toBe("Acquisition vendor");
    expect(mod.sourceLabel("container_owner")).toBe("Container owner");
    expect(mod.sourceLabel(null)).toBe("Unknown");
  });
});
