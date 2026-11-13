import { describe, expect, it } from "vitest";
import {
  checkReceiveUnits, describeContainerLine, iso6346Valid, normalizeContainerNumber, poProgress, rowsForOutstanding,
} from "@/lib/container-po";

describe("container PO lines", () => {
  it("describes a line", () => {
    expect(describeContainerLine({ container_size: "40", container_height: "HC", container_category: "dry", container_grade: "B" }))
      .toBe("40ft HC dry container · grade B");
    expect(describeContainerLine({ container_size: "20", container_category: "reefer", container_grade: "as_is" }))
      .toBe("20ft reefer container · as is");
    expect(describeContainerLine({ container_size: "20" })).toBe("20ft dry container");
  });
});

describe("container numbers", () => {
  it("normalises", () => {
    expect(normalizeContainerNumber(" csqu 305438-3 ")).toBe("CSQU3054383");
  });
  it("checks the ISO 6346 check digit", () => {
    expect(iso6346Valid("CSQU3054383")).toBe(true);
    expect(iso6346Valid("CSQU3054384")).toBe(false);
    expect(iso6346Valid("MSKU9070323")).toBe(true);
    expect(iso6346Valid("FC-001")).toBeNull();
  });
});

describe("receive form", () => {
  const lines = [
    { id: "L1", description: "40ft HC dry container", quantity: 3, received_qty: 1 },
    { id: "L2", description: "20ft dry container", quantity: 1, received_qty: 0 },
  ];

  it("makes one row per container still to come", () => {
    const rows = rowsForOutstanding(lines, { received_at: "2026-11-13" });
    expect(rows.map((r) => r.po_item_id)).toEqual(["L1", "L1", "L2"]);
    expect(rows[0]).toMatchObject({ delivery: "yard", received_at: "2026-11-13", container_number: "" });
  });

  it("flags missing and repeated numbers, too many on a line and a direct delivery with no customer", () => {
    const issues = checkReceiveUnits([
      { po_item_id: "L2", container_number: "CSQU3054383", delivery: "yard" },
      { po_item_id: "L2", container_number: "csqu3054383", delivery: "direct" },
      { po_item_id: "L1", container_number: "", delivery: "yard" },
    ], lines);
    const blocking = issues.filter((i) => !i.warning).map((i) => `${i.row}:${i.field}`);
    expect(blocking).toEqual(expect.arrayContaining(["1:container_number", "1:customer_id", "2:container_number", "0:po_item_id"]));
  });

  it("only warns on an unusual or mistyped number", () => {
    const issues = checkReceiveUnits([{ po_item_id: "L1", container_number: "CSQU3054384", delivery: "yard" }], lines);
    expect(issues).toHaveLength(1);
    expect(issues[0].warning).toBe(true);
  });

  it("needs a vendor when a transport cost is entered", () => {
    const issues = checkReceiveUnits([{ po_item_id: "L1", container_number: "CSQU3054383", delivery: "yard", transport_cost: 15000 }], lines);
    expect(issues.map((i) => i.field)).toEqual(["transport_vendor"]);
  });
});

describe("order progress", () => {
  it("paid upfront, nothing received yet", () => {
    expect(poProgress({ status: "confirmed", total_cost: 300000, units_ordered: 2, units_received: 0, value_received: 0, billed: 300000, paid: 150000, bill_supplier_ref: "INV-77" }))
      .toEqual({ unitsToCome: 2, paidNotReceived: 150000, receivedNotBilled: 0, toPay: 150000, hasSupplierInvoice: true });
  });
  it("received but the supplier has not invoiced", () => {
    expect(poProgress({ status: "received", total_cost: 300000, units_ordered: 2, units_received: 2, value_received: 300000, billed: 0, paid: 0 }))
      .toMatchObject({ unitsToCome: 0, paidNotReceived: 0, receivedNotBilled: 300000, toPay: 300000 });
  });
});
