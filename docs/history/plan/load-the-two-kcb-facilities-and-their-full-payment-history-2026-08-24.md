# Load the two KCB facilities and their full payment history

Right now the Loans screen is empty: the database has no loan facilities and no loan movements at all, so balances, interest paid and arrears show nothing. The engine is built — it just has no data. This plan loads both KCB statements end to end.

## What gets loaded

**Facility 1 — Unsecured (AA24358K6P1K)**
- KES, 16.70% p.a., granted 23 Dec 2024, matures 23 Dec 2027, KES 106,848.10 monthly on day 23
- Advanced 3,000,000.00 · statement closes at principal 1,607,078.00, outstanding 1,694,527.80, accrued interest 9,558.80
- In arrears: principal 77,157.30 + interest 733.70 = 77,891.00 (13 days)

**Facility 2 — Asset Finance, ABF Bundled (AA241859QRT8)**
- KES, 18.20% p.a., granted 03 Jul 2024, matures 03 Sep 2029, KES 179,552.20 monthly on day 30
- Advanced 6,759,243.00 · statement closes at principal 5,053,978.15, outstanding 5,249,347.05, accrued interest 15,120.40
- In arrears: principal 103,055.25 + interest 77,193.25 = 180,248.50 (6 days)

Every dated line from each statement is loaded: disbursements, stamp duty, arrangement charges, monthly interest due, penalty interest, and each principal / interest / penalty payment — through to 23 Jul 2026 and 30 Jul 2026 respectively. Bank "Loan Repayment" receipt lines are deliberately not loaded as separate movements; they are the money hitting the loan account, and the principal/interest/penalty application lines beneath them are what actually settle the balance. Loading both would double count.

## Ledger treatment

Loan movements post to the general ledger the same way any new movement does: disbursement and repayments against Loans Payable, interest and penalties to Interest Expense, fees and stamp duty to finance charges.

Because none of this history has ever been in the books, posting 19 months of interest into past months would rewrite already-reported results. So:

- One dated opening journal on 31 Jul 2026 brings each facility onto the balance sheet at its statement position (principal outstanding, accrued interest, arrears).
- The individual statement movements are recorded on the loan as history, flagged as pre-ledger, so the schedule, transaction list and interest-paid figures are complete without touching prior-period P&L.
- Everything from 01 Aug 2026 forward posts normally, movement by movement.

If you would rather see the full interest history inside the P&L by month, say so and the cut-over is moved back to the grant dates instead.

## Reconciliation check

After loading, each facility is compared against the figures printed on its statement — principal outstanding, accrued interest, total in arrears. Any facility that does not tie is flagged on the Loans list with the difference, rather than silently showing a wrong balance.

## Schedules and alerts

Amortisation schedules are generated from the grant date and instalment, then matched against actual principal payments so past instalments show as paid or part paid and future ones as expected. The daily due-scan then has real data to alert on, and the Commitments screen starts showing the 23rd and 30th instalments for both facilities.

## Technical notes

- Seed both rows in `loan_facilities` (lender KCB Bank, types `unsecured` and `asset_finance`) via data insert, then load statement rows into `loan_transactions` with `source = 'statement_import'` and an `external_ref` per row for idempotent re-import.
- Add a `posts_to_ledger` boolean (default true) on `loan_transactions` plus a `ledger_cutover_date` on `loan_facilities`; `post_loan_transaction` skips journal creation for rows dated before cut-over and stamps them accordingly. This is the only schema change.
- Opening journal per facility: debit/credit Loans Payable (2500) and Accrued Interest Payable (2510) against Retained Earnings, dated at cut-over.
- Run `generate_loan_schedule` then `apply_loan_payments_to_schedule` for each facility.
- Extend `loan_balances` with the statement-declared figures (`stmt_principal_outstanding`, `stmt_accrued_interest`, `stmt_arrears`) so the Loans list can render a variance badge.
