import { describe, it, expect } from "vitest";
import { customerSlugForConversion } from "@/lib/conversion-slug";

describe("customerSlugForConversion", () => {
  it("returns NOCUST for null/undefined/empty input", () => {
    expect(customerSlugForConversion(null)).toBe("NOCUST");
    expect(customerSlugForConversion(undefined)).toBe("NOCUST");
    expect(customerSlugForConversion("")).toBe("NOCUST");
    expect(customerSlugForConversion("   ")).toBe("NOCUST");
  });

  it("takes the first meaningful word for plain names", () => {
    expect(customerSlugForConversion("Acme Ltd")).toBe("ACME");
    expect(customerSlugForConversion("acme")).toBe("ACME");
  });

  it("strips punctuation and collapses whitespace", () => {
    expect(customerSlugForConversion("  Foo, Bar & Co.")).toBe("FOO");
    expect(customerSlugForConversion("!!!Zeta---Corp???")).toBe("ZETA");
    expect(customerSlugForConversion("A/B/C")).toBe("A");
  });

  it("strips diacritics from Latin script", () => {
    expect(customerSlugForConversion("Über Café")).toBe("UBER");
    expect(customerSlugForConversion("Åsa Björk")).toBe("ASA");
    expect(customerSlugForConversion("Ñoño Ltda")).toBe("NONO");
    expect(customerSlugForConversion("Straße 5")).toBe("STRASSE");
  });

  it("skips leading noise words when more remains", () => {
    expect(customerSlugForConversion("Mr. John Doe")).toBe("JOHN");
    expect(customerSlugForConversion("Dr Amina")).toBe("AMINA");
    expect(customerSlugForConversion("MRS Jane Smith")).toBe("JANE");
    expect(customerSlugForConversion("The Container Company")).toBe("CONTAINER");
    expect(customerSlugForConversion("M Kariuki")).toBe("KARIUKI");
  });

  it("keeps a noise word when it is the only token", () => {
    expect(customerSlugForConversion("Mr")).toBe("MR");
    expect(customerSlugForConversion("The")).toBe("THE");
  });

  it("truncates long tokens to 12 characters", () => {
    expect(customerSlugForConversion("Supercalifragilisticexpialidocious")).toBe(
      "SUPERCALIFRA",
    );
    expect(customerSlugForConversion("Supercalifragilisticexpialidocious").length).toBe(12);
  });

  it("falls back to CUST<id-hex> for non-latin scripts when id is supplied", () => {
    expect(
      customerSlugForConversion("株式会社", "12345678-90ab-cdef-1234-567890abcdef"),
    ).toBe("CUST123456");
    expect(
      customerSlugForConversion("شركة", "abcdef00-0000-0000-0000-000000000000"),
    ).toBe("CUSTABCDEF");
    expect(customerSlugForConversion("Ω Δ Λ", "11111111-2222-3333-4444-555555555555")).toBe(
      "CUST111111",
    );
  });

  it("falls back to NOCUST for non-latin scripts when no id supplied", () => {
    expect(customerSlugForConversion("株式会社")).toBe("NOCUST");
    expect(customerSlugForConversion("شركة")).toBe("NOCUST");
  });

  it("is deterministic and idempotent across calls", () => {
    const inputs: [string, string?][] = [
      ["Acme Ltd", undefined],
      ["Mr. John Doe", undefined],
      ["Über Café", undefined],
      ["株式会社", "12345678-90ab-cdef-1234-567890abcdef"],
      ["  Foo, Bar & Co.", undefined],
    ];
    for (const [name, id] of inputs) {
      const first = customerSlugForConversion(name, id);
      const second = customerSlugForConversion(name, id);
      const third = customerSlugForConversion(name, id);
      expect(second).toBe(first);
      expect(third).toBe(first);
      // Output is always a safe token
      expect(first).toMatch(/^[A-Z0-9]{1,12}$/);
    }
  });

  it("always returns a value that fits the CNV token grammar", () => {
    const samples = [
      "Acme",
      "  ",
      null,
      "Mr. John Doe",
      "Über Café",
      "!!!",
      "株式会社",
      "1234567890 Ltd",
    ];
    for (const s of samples) {
      const slug = customerSlugForConversion(s as any, "11111111-1111-1111-1111-111111111111");
      expect(slug).toMatch(/^[A-Z0-9]{1,12}$/);
    }
  });
});
