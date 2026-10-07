import { describe, it, expect } from "vitest";
import { cleanLabel, labelToKey, parseNumber, findHeaderRow, isNoiseRow, parseBoqRows } from "@/lib/boq-import";

const BOQ_ROWS: unknown[][] = [
  ["DESSERT STARS — CONTAINER PROJECT BILL OF QUANTITIES (BOQ)"],
  ["Scope: 4 x 40ft High Cube shipping containers | Currency: KES"],
  [],
  ["A. CONTAINER SHELLS & STRUCTURAL WORKS"],
  ["Item", "Description", "Unit", "Qty", "Unit Rate (KES)", "Amount (KES)"],
  ["A1", "Used 40ft High Cube shipping container", "No.", 4, 400000, 1600000],
  ["A2", "Cutting & fabrication allowance per container", "No.", 4, 150000, 600000],
  ["Subtotal — Section A", null, null, null, null, 2200000],
  [],
  ["B. ENVELOPE, INSULATION & FINISHES"],
  ["Item", "Description", "Unit", "Qty", "Unit Rate (KES)", "Amount (KES)"],
  ["B1", "Exterior surface prep + weatherproof paint", "m2", 220, 900, 198000],
  ["Subtotal — Section B", null, null, null, null, 198000],
  ["GRAND TOTAL", null, null, null, null, 2398000],
];

describe("boq-import", () => {
  it("cleans currency-suffixed labels", () => {
    expect(cleanLabel("Unit Rate (KES)")).toBe("unit rate");
    expect(cleanLabel("Qty.")).toBe("qty");
  });

  it("maps labels to column keys", () => {
    expect(labelToKey("Unit Rate (KES)")).toBe("unit_price");
    expect(labelToKey("Qty")).toBe("quantity");
    expect(labelToKey("Particulars")).toBe("description");
    expect(labelToKey("Item")).toBe("code");
    expect(labelToKey("Nonsense column")).toBeNull();
  });

  it("parses messy numbers", () => {
    expect(parseNumber("KES 1,200.50")).toBeCloseTo(1200.5);
    expect(parseNumber("(500)")).toBe(-500);
    expect(parseNumber("=D6*E6")).toBe(0);
    expect(parseNumber("")).toBe(0);
  });

  it("finds the header row below title rows", () => {
    const h = findHeaderRow(BOQ_ROWS);
    expect(h?.rowIndex).toBe(4);
    expect(h?.map[4]).toBe("unit_price");
  });

  it("flags subtotal and total rows as noise", () => {
    expect(isNoiseRow("Subtotal — Section A")).toBe(true);
    expect(isNoiseRow("GRAND TOTAL")).toBe(true);
    expect(isNoiseRow("A1")).toBe(false);
  });

  it("parses a real BOQ layout into sections", () => {
    const { sections, error } = parseBoqRows(BOQ_ROWS);
    expect(error).toBeUndefined();
    expect(sections.map((s) => s.title)).toEqual([
      "A. CONTAINER SHELLS & STRUCTURAL WORKS",
      "B. ENVELOPE, INSULATION & FINISHES",
    ]);
    expect(sections[0].items).toHaveLength(2);
    expect(sections[0].items[0]).toMatchObject({
      description: "A1 — Used 40ft High Cube shipping container",
      unit: "No.",
      quantity: 4,
      unit_price: 400000,
    });
    expect(sections[1].items).toHaveLength(1);
  });

  it("still handles the simple Section-column template", () => {
    const rows: unknown[][] = [
      ["Section", "Description", "Unit", "Quantity", "Unit Price", "Discount %", "Tax %"],
      ["Structural", "", "", "", "", "", ""],
      ["Structural", "20ft container base", "pc", 1, 2500, 0, 16],
      ["Electrical", "", "", "", "", "", ""],
      ["Electrical", "LED lighting kit", "set", 2, 120, 5, 16],
    ];
    const { sections } = parseBoqRows(rows);
    expect(sections.map((s) => s.title)).toEqual(["Structural", "Electrical"]);
    expect(sections[1].items[0]).toMatchObject({ description: "LED lighting kit", tax_pct: 16, discount_pct: 5 });
  });

  it("reports a useful error when there is no header", () => {
    const { sections, error } = parseBoqRows([["Just a note"], ["Another note"]]);
    expect(sections).toHaveLength(0);
    expect(error).toMatch(/header row/i);
  });
});
