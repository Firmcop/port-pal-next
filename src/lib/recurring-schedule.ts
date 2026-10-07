import { addDays, addWeeks, addMonths } from "date-fns";

export type Frequency = "daily" | "weekly" | "monthly" | "quarterly";

export function nextOccurrences(
  start: Date,
  frequency: Frequency,
  intervalCount: number,
  count: number,
  endDate?: Date | null
): Date[] {
  const out: Date[] = [];
  let d = new Date(start);
  for (let i = 0; i < count; i++) {
    if (endDate && d > endDate) break;
    out.push(new Date(d));
    switch (frequency) {
      case "daily": d = addDays(d, intervalCount); break;
      case "weekly": d = addWeeks(d, intervalCount); break;
      case "monthly": d = addMonths(d, intervalCount); break;
      case "quarterly": d = addMonths(d, intervalCount * 3); break;
    }
  }
  return out;
}
