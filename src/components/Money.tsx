import { formatMoney } from "@/lib/app-settings";
import { useAppSettings } from "@/hooks/use-app-settings";

/**
 * Reactive money renderer. Uses the record's own currency if supplied,
 * otherwise falls back to the org's default currency from Settings.
 *
 * ```tsx
 * <Money amount={row.total} currency={row.currency} />
 * ```
 */
export function Money({
  amount,
  currency,
  className,
  dash = "—",
}: {
  amount: number | string | null | undefined;
  currency?: string | null;
  className?: string;
  /** Rendered when amount is nullish. Defaults to em-dash. */
  dash?: string;
}) {
  // Subscribe to store so symbol updates when Settings currency changes.
  useAppSettings();
  if (amount === null || amount === undefined || amount === "") {
    return <span className={className}>{dash}</span>;
  }
  return <span className={className}>{formatMoney(amount, currency ?? undefined)}</span>;
}

/**
 * Group a list of {amount, currency} into per-currency totals, then render each
 * as its own money line. Prevents silently summing across currencies.
 */
export function MoneyTotals({
  rows,
  className,
  separator = " · ",
  emptyLabel = "—",
}: {
  rows: Array<{ amount: number | string | null | undefined; currency?: string | null }>;
  className?: string;
  separator?: string;
  emptyLabel?: string;
}) {
  useAppSettings();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const n = Number(r.amount ?? 0);
    if (!Number.isFinite(n) || n === 0) continue;
    const key = (r.currency || "").toUpperCase();
    totals.set(key, (totals.get(key) ?? 0) + n);
  }
  if (totals.size === 0) return <span className={className}>{emptyLabel}</span>;
  return (
    <span className={className}>
      {Array.from(totals.entries())
        .map(([code, amt]) => formatMoney(amt, code || undefined))
        .join(separator)}
    </span>
  );
}
