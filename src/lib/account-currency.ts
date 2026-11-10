/**
 * A ledger line's amount in its bank account's currency — the same rule as
 * the database function amount_in_account_currency (used by
 * financial_account_balances). Lines in another currency are converted
 * through the base currency at the line's own rate.
 */
export function lineInAccountCurrency(
  amount: number,
  line: { currency?: string | null; fx_rate?: number | string | null },
  accountCurrency: string | null | undefined,
  baseCurrency = "KES",
  accountRateToBase?: number | null,
): number {
  const base = baseCurrency.toUpperCase();
  const lineCur = (line.currency ?? base).toUpperCase();
  const acctCur = (accountCurrency ?? base).toUpperCase();
  if (lineCur === acctCur) return amount;
  const inBase = amount * Number(line.fx_rate ?? 1);
  if (acctCur === base) return inBase;
  return accountRateToBase ? inBase / accountRateToBase : inBase;
}

export function isForeignLine(line: { currency?: string | null }, accountCurrency: string | null | undefined, base = "KES") {
  return (line.currency ?? base).toUpperCase() !== (accountCurrency ?? base).toUpperCase();
}
