import { describe, expect, it } from "vitest";
import { quoteDiscountAmount, quoteTotals } from "@/lib/quote-totals";

const items = [
  { quantity: 2, unit_price: 100000, tax_pct: 0 },
  { quantity: 1, unit_price: 50000, tax_pct: 0 },
];

describe("whole-quote discount", () => {
  it("no discount: total is the sum of the lines", () => {
    expect(quoteTotals(items)).toEqual({ subtotal: 250000, discount: 0, net: 250000, tax: 0, total: 250000 });
  });

  it("an amount off the subtotal", () => {
    expect(quoteTotals(items, { type: "amount", value: 20000 })).toMatchObject({ discount: 20000, total: 230000 });
  });

  it("a percentage off the subtotal", () => {
    expect(quoteTotals(items, { type: "percent", value: 5 })).toMatchObject({ discount: 12500, total: 237500 });
  });

  it("is taken off before tax", () => {
    const t = quoteTotals([{ quantity: 1, unit_price: 100000, tax_pct: 16 }], { type: "percent", value: 10 });
    expect(t).toEqual({ subtotal: 100000, discount: 10000, net: 90000, tax: 14400, total: 104400 });
  });

  it("never exceeds the subtotal or goes negative", () => {
    expect(quoteDiscountAmount(1000, "amount", 5000)).toBe(1000);
    expect(quoteDiscountAmount(1000, "percent", 150)).toBe(1000);
    expect(quoteDiscountAmount(1000, "amount", -50)).toBe(0);
  });

  it("matches the converted quote QTE-MOZZOF11 (KES 35,000 off 663,751.72)", () => {
    expect(quoteTotals([{ quantity: 1, unit_price: 663751.72 }], { type: "amount", value: 35000 }).total).toBe(628751.72);
  });
});
