import { describe, expect, it } from "vitest";
import { buildTaskSheetHtml, nextWorkDay, summariseByStaff, weekDays, type WorkTask } from "@/lib/work-tasks";

const t = (p: Partial<WorkTask>): WorkTask => ({
  id: Math.random().toString(36).slice(2), employee_id: "e1", assignee_name: null, work_date: "2026-11-09",
  title: "Weld door frames", details: null, conversion_id: null, project_id: null, status: "open",
  incomplete_reason: null, sheet_signed: false, recorded_at: null, carried_from_id: null,
  employee: { name: "John Kamau" }, ...p,
});

describe("work tasks", () => {
  it("lists Monday to Sunday", () => {
    const d = weekDays("2026-11-09");
    expect(d).toHaveLength(7);
    expect(d[0]).toMatchObject({ date: "2026-11-09", short: "Mon 9" });
    expect(d[6].date).toBe("2026-11-15");
  });

  it("carries over to the next working day, skipping Sunday", () => {
    expect(nextWorkDay("2026-11-09")).toBe("2026-11-10");
    expect(nextWorkDay("2026-11-14")).toBe("2026-11-16"); // Sat -> Mon
  });

  it("several tasks per person a day; completion counts recorded tasks only", () => {
    const s = summariseByStaff([
      t({ status: "complete" }), t({ status: "complete" }), t({ status: "incomplete", incomplete_reason: "Rework" }), t({}),
      t({ employee_id: "e2", employee: { name: "Peter Otieno" } }),
    ]);
    expect(s).toEqual([
      expect.objectContaining({ name: "John Kamau", total: 4, complete: 2, incomplete: 1, open: 1, completionPct: 67 }),
      expect.objectContaining({ name: "Peter Otieno", total: 1, open: 1, completionPct: null }),
    ]);
  });

  it("sign sheet has a row per task with tick boxes and a signature column, and escapes text", () => {
    const html = buildTaskSheetHtml({
      tasks: [
        t({ title: "Cut <openings>", conversion: { conversion_number: "CNV-NAIBOR-0005" }, project: { name: "Naibor Stalls" } }),
        t({ work_date: "2026-11-10", employee: { name: "Peter Otieno" }, title: "Paint" }),
      ],
      companyName: "Firmcop Limited", weekStart: "2026-11-09", weekEnd: "2026-11-15", day: null,
    });
    expect(html).toContain("Firmcop Limited");
    expect(html).toContain("Mon 9 Nov");
    expect(html).toContain("Tue 10 Nov");
    expect(html).toContain("CNV-NAIBOR-0005");
    expect(html).toContain("Signature");
    expect(html).toContain("Cut &lt;openings&gt;");
    expect(html).not.toContain("<openings>");
    expect((html.match(/☐/g) ?? []).length).toBe(4);
  });
});
