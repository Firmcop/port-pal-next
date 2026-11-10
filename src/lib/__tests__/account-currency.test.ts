import { describe, expect, it } from "vitest";
import { isForeignLine, lineInAccountCurrency } from "@/lib/account-currency";

describe("bank line amounts in the account's currency", () => {
  it("a KES line on a KES account is unchanged", () => {
    expect(lineInAccountCurrency(50000, { currency: "KES", fx_rate: 1 }, "KES")).toBe(50000);
  });
  it("a USD payment from a KES account is converted at the line's rate", () => {
    expect(lineInAccountCurrency(2500, { currency: "USD", fx_rate: 129.18 }, "KES")).toBeCloseTo(322950);
    expect(isForeignLine({ currency: "USD" }, "KES")).toBe(true);
  });
  it("a KES line on a USD account goes through the account's rate", () => {
    expect(lineInAccountCurrency(129180, { currency: "KES", fx_rate: 1 }, "USD", "KES", 129.18)).toBeCloseTo(1000);
  });
});
