import { describe, it, expect } from "vitest";
import { computeVat } from "@/lib/vat";

describe("computeVat", () => {
  it("no VAT leaves the amount untouched", () => {
    expect(computeVat(100000, "none", "KES")).toEqual({ subtotal: 100000, taxRate: 0, taxAmount: 0, total: 100000 });
  });
  it("adds 16% on top of a net amount", () => {
    expect(computeVat(100000, "added", "KES")).toEqual({ subtotal: 100000, taxRate: 16, taxAmount: 16000, total: 116000 });
  });
  it("splits a VAT-inclusive amount without changing the total", () => {
    expect(computeVat(116000, "included", "KES")).toEqual({ subtotal: 100000, taxRate: 16, taxAmount: 16000, total: 116000 });
    const r = computeVat(170000, "included", "KES");
    expect(r.total).toBe(170000);
    expect(r.subtotal + r.taxAmount).toBeCloseTo(170000, 2);
  });
});
