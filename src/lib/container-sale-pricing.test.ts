import { describe, expect, it } from "vitest";
import { deriveMarkup } from "./container-sale-pricing";

describe("deriveMarkup", () => {
  it("is zero when there is no entry price", () => {
    expect(deriveMarkup(0, 1200)).toBe(0);
    expect(deriveMarkup(null, 1200)).toBe(0);
  });

  it("computes a standard markup", () => {
    expect(deriveMarkup(1000, 1150)).toBe(15);
  });

  it("goes negative when sold below cost", () => {
    expect(deriveMarkup(1000, 900)).toBe(-10);
  });

  it("rounds to two decimals", () => {
    expect(deriveMarkup(3, 10)).toBe(233.33);
  });

  it("accepts numeric strings", () => {
    expect(deriveMarkup("2000", "2500")).toBe(25);
  });
});
