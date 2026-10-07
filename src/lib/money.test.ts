import { describe, it, expect } from "vitest";
import { currencyDigits, roundMoney, formatMoneyCode, assertTotalsMatch } from "@/lib/money";

describe("money", () => {
  it("returns correct digits per currency", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
    expect(currencyDigits(undefined)).toBe(2);
  });

  it("rounds to the currency digits", () => {
    expect(roundMoney(1.234, "USD")).toBe(1.23);
    expect(roundMoney(1.235, "USD")).toBeCloseTo(1.24, 5);
    expect(roundMoney(0.4, "JPY")).toBe(0);
    expect(roundMoney(0.6, "JPY")).toBe(1);
    expect(roundMoney(1.2346, "KWD")).toBeCloseTo(1.235, 5);
  });

  it("formats with the currency code prefix", () => {
    expect(formatMoneyCode(1234.5, "KES")).toMatch(/^KES 1,?234\.50$/);
    expect(formatMoneyCode(1000, "JPY")).toBe("JPY 1,000");
  });

  it("asserts totals match after rounding", () => {
    expect(() => assertTotalsMatch({ subtotal: 100, taxAmount: 21, total: 121 }, "USD")).not.toThrow();
    expect(() => assertTotalsMatch({ subtotal: 100, taxAmount: 21, total: 120 }, "USD")).toThrow(/mismatch/);
  });
});
