import { describe, it, expect } from "vitest";
import {
  parseStatement,
  normalizeContainer,
  similarity,
  classifyStatement,
  bundleSummaries,
  planHistoricalBundles,
  JJ_MES_STATEMENT,
  type OurContainer,
  type OurInvoice,
} from "./supplier-statement";

const container = (id: string, number: string): OurContainer => ({
  id,
  container_number: number,
  size: "20",
  status: "available",
  owner: "JJ MES DMCC",
});

const invoice = (id: string, containerId: string, amount: number, status = "issued"): OurInvoice => ({
  id,
  invoice_number: `PINV-${id}`,
  container_id: containerId,
  total_amount: amount,
  currency: "USD",
  status,
  supplier_ref: null,
  reason: "purchase",
});

describe("normalizeContainer", () => {
  it("strips spaces and casing", () => {
    expect(normalizeContainer("wedu 6586606")).toBe("WEDU6586606");
    expect(normalizeContainer(null)).toBe("");
  });
});

describe("parseStatement", () => {
  it("parses comma rows and skips junk", () => {
    const rows = parseStatement("DD-1,700,wedu 6586606,20DV\n\nbad row\nDD-1,700,TRKU2030787,20DV");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      supplierRef: "DD-1",
      bundleAmount: 700,
      containerNumber: "WEDU6586606",
      type: "20DV",
    });
  });

  it("parses the preloaded JJ MES statement", () => {
    expect(parseStatement(JJ_MES_STATEMENT)).toHaveLength(89);
  });
});

describe("similarity", () => {
  it("scores a truncated number as a near match", () => {
    expect(similarity("AMFU8671919", "AMFU867191")).toBeGreaterThan(0.85);
  });
  it("scores unrelated numbers low", () => {
    expect(similarity("AMFU8671919", "TRKU2030787")).toBeLessThan(0.5);
  });
});

describe("classifyStatement", () => {
  const containers = [
    container("c1", "WEDU 6586606"),
    container("c2", "AMFU 867191"), // typo of AMFU8671919
    container("c3", "TRKU 2039974"),
    container("c4", "FSCU 6765059"),
  ];
  const invoices = [
    invoice("a", "c1", 700),
    invoice("b", "c2", 1700),
    invoice("c", "c3", 700),
    invoice("d", "c3", 700), // duplicate
    invoice("e", "c1", 700, "cancelled"), // ignored
  ];
  const lines = parseStatement(
    [
      "DD-1,1400,WEDU6586606,20DV",
      "DD-1,1400,SUDU1467534,20DV",
      "DD-2,1700,AMFU8671919,40HC",
      "DD-3,700,TRKU2039974,20DV",
      "DD-4,1700,FSCU6765059,40HC",
    ].join("\n"),
  );
  const rows = classifyStatement({ lines, containers, invoices });

  it("matches, flags typos, duplicates, missing invoices and pre-system units", () => {
    expect(rows.map((r) => r.status)).toEqual([
      "matched",
      "not_in_inventory",
      "likely_typo",
      "duplicate",
      "no_invoice",
    ]);
    expect(rows[2].ourContainerNumber).toBe("AMFU 867191");
    expect(rows[3].invoices).toHaveLength(2);
  });

  it("ignores cancelled invoices in our total", () => {
    expect(rows[0].ourAmount).toBe(700);
  });
});

describe("bundleSummaries and planHistoricalBundles", () => {
  const containers = [container("c1", "WEDU6586606")];
  const invoices = [invoice("a", "c1", 700)];
  const lines = parseStatement(
    ["DD-1,3200,WEDU6586606,20DV", "DD-1,3200,SUDU1467534,20DV", "DD-1,3200,SUDU1432630,20DV"].join("\n"),
  );
  const rows = classifyStatement({ lines, containers, invoices });

  it("reports the gap per bundle", () => {
    const [b] = bundleSummaries(rows);
    expect(b).toMatchObject({ supplierRef: "DD-1", theirTotal: 3200, ourTotal: 700, gap: 2500, missingLines: 2 });
  });

  it("shares the residual across the containers we never received", () => {
    const [draft] = planHistoricalBundles(rows);
    expect(draft.postable).toBe(true);
    expect(draft.lines).toEqual([
      { containerNumber: "SUDU1467534", amount: 1250 },
      { containerNumber: "SUDU1432630", amount: 1250 },
    ]);
    expect(draft.lines.reduce((s, l) => s + l.amount, 0)).toBe(draft.residual);
  });

  it("refuses to post a bundle with nothing left to bill", () => {
    const fully = classifyStatement({
      lines: parseStatement(["DD-9,700,WEDU6586606,20DV", "DD-9,700,SUDU1467534,20DV"].join("\n")),
      containers,
      invoices,
    });
    const [draft] = planHistoricalBundles(fully);
    expect(draft.postable).toBe(false);
    expect(draft.blockedReason).toMatch(/already fully invoiced/i);
  });
});
