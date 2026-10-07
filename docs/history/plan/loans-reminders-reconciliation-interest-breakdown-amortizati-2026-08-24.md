# Loans: reminders, reconciliation, interest breakdown, amortization timeline

Four additions on top of the existing Loans / Commitments module.

## 1. Upcoming due reminders on the dashboard
- New "Upcoming commitments" card on the Finance Dashboard, driven by the existing `commitments_due` function (loan instalments + recurring expenses).
- Each row shows: what is due, due date, amount with currency, and days-to-due; overdue items in red, due-within-7-days in amber.
- Card shows the next 10 items with a link through to the full Commitments page and to each loan.
- Optional daily reminder notifications: a scheduled job that writes a notification for anything due within 7 days or overdue, once per item per day (no duplicate spam).

## 2. Statement vs ledger reconciliation screen
- New page `/finance/loans/:id/reconciliation` (also reachable as a tab on the loan).
- Left side: imported statement movements (loan transactions with source `statement_import`). Right side: the ledger journal postings created for those movements.
- Each row is classified:
  - Matched — statement movement has a balanced journal posting of the same date/amount.
  - Missing in ledger — statement movement recorded but never posted (e.g. pre-cutover history).
  - Amount mismatch — posted, but the journal total differs from the movement.
  - Ledger-only — a loan journal posting with no statement movement behind it.
- Header KPIs: matched count, unmatched count, total value of differences, plus statement closing balance vs system balance with the variance.
- Actions: post a missing movement to the ledger, and CSV export of the exception list.

## 3. Interest and penalty breakdown per loan
- New summary block on the loan page with three columns: Charged, Paid, Outstanding — for
  - Interest
  - Penalty interest
  - Fees / charges (stamp duty, insurance, arrangement)
- Plus a headline "Current accrued interest" figure (interest charged less interest paid) and, where a statement figure exists, the bank-declared accrued interest side by side with the variance flagged.
- Figures come from the loan transactions ledger so they always agree with the postings.

## 4. Interactive amortization timeline
- New "Timeline" tab on the loan showing every instalment in sequence.
- Chart: stacked bars per instalment (principal / interest), a cumulative outstanding-balance line, and a marker at today separating past from scheduled.
- Bars coloured by state: paid, part paid, overdue (arrears), expected.
- Hover shows instalment number, due date, principal, interest, total due, amount paid, and shortfall.
- Filter for "arrears only", and clicking an instalment scrolls to it in the schedule table.

## Technical notes
- Data sources already in place: `loan_facilities`, `loan_schedule_lines`, `loan_transactions`, `accounting_transactions` (reference type `loan_transaction`), and the `loan_balances` / `commitments_due` functions.
- Backend work: a `loan_statement_reconciliation(_loan_id)` function returning the match classification per movement, and an extension of the loan balance function to break out penalty-interest charged/paid and fee totals separately.
- Reminder notifications reuse the existing notifications infrastructure; no new delivery channel.
- Charts use Recharts, consistent with the other finance reports; all amounts render through `formatMoneyCode` with the loan's own currency.
