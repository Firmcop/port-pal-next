# Loans & Recurring Commitments

Give the business a full liability picture: loan facilities (asset finance, unsecured, other), their repayment schedules, arrears alerts, and a single calendar of recurring obligations (rent, utilities, insurance, loan instalments) — all posting to the ledger so the balance sheet and P&L are complete.

Your two KCB statements are the reference structure: KES 3,000,000 unsecured @ 16.7% (ref AA24358K6P1K, monthly on day 23) and KES 6,759,243 ABF asset finance @ 18.2% (ref AA241859QRT8, monthly on day 30, matures Sep 2029).

## 1. Loan register

A new **Finance → Loans** page listing every facility with:

- Lender, loan reference, type (asset finance / unsecured / mortgage / overdraft / shareholder / other)
- Currency, principal advanced, interest rate, date granted, maturity date
- Repayment amount, frequency and payment day (e.g. "monthly on day 23")
- Current principal, accrued interest, total outstanding, arrears
- Status (current, in arrears, restructured, settled)
- Optional link to the financed asset (fixed asset record) and to the bank account the instalment is debited from

Top KPIs: total debt outstanding, principal vs interest split, total in arrears, instalments due in the next 30 days.

## 2. Loan detail: schedule + statement

Each facility opens to a detail page with three tabs:

- **Schedule** — generated amortisation plan (due date, principal, interest, instalment, running balance) with each line marked expected / paid / part-paid / overdue.
- **Transactions** — the actual movements exactly as your bank statement shows them: disbursement, arrangement charges, stamp duty, interest due, penalty interest due, principal payment, interest payment, penalty payment. Running balance is recomputed and reconciled against the bank's figure.
- **Postings** — the ledger entries each movement produced.

A **Statement import** action lets you paste or upload a KCB-style statement; the rows are parsed into loan transactions, matched against what's already recorded, and only new movements are added (no duplicates). This is how the history up to July gets loaded.

## 3. Accounting

Every movement posts automatically:

- Disbursement: debit bank, credit loan liability
- Arrangement fees / stamp duty: debit finance costs (OPEX), credit bank
- Interest due & penalty interest: debit interest expense, credit accrued interest
- Principal payment: debit loan liability, credit bank
- Interest / penalty payment: debit accrued interest, credit bank

Result: loan balances appear as liabilities on the balance sheet, interest and fees hit the P&L, and cash movements reconcile to the bank account. Existing period-close and FX rules apply unchanged.

## 4. Due-date alerts

A nightly job flags:

- Instalments due in the next 7 days
- Instalments overdue (with days in arrears and the arrears amount, matching your statement's summary block)
- Facilities maturing within 90 days
- Recurring expenses (rent, utilities, insurance) due or overdue

Alerts land in the existing notification system and on a **Commitments** calendar view showing everything the business owes over the coming weeks in one place.

## 5. Recurring expenses

Recurring expense templates already exist under Operating Expenses. This work promotes them to first-class commitments: they join the same due-date alerting and the Commitments calendar, and gain a next-due indicator plus overdue badge so rent and utilities are never missed.

## Technical notes

- New tables: `loan_facilities`, `loan_schedule_lines`, `loan_transactions`, all organisation-scoped with RLS, GRANTs, and the currency auto-fill trigger.
- New enums: `loan_type`, `loan_status`, `loan_txn_type`, `loan_schedule_status`.
- RPCs: `create_loan_facility`, `generate_loan_schedule` (reducing-balance amortisation), `post_loan_transaction` (single atomic function that writes the movement and its `accounting_transactions` journal), `import_loan_statement` (bulk, idempotent on date + type + amount), `loan_portfolio_summary`, `commitments_due` (loans + recurring expenses in one feed).
- Statement parser lives client-side in `src/lib/loan-statement-import.ts` with unit tests against the two KCB layouts; the RPC does the idempotent insert.
- Alerts reuse `push_notification_queue` / `notifications`, driven by a `loan_due_scan` function on the existing nightly pg_cron slot.
- UI: `src/pages/finance/Loans.tsx`, `src/pages/finance/LoanDetail.tsx`, `src/pages/finance/Commitments.tsx`, plus sidebar entries and i18n keys under the `accounting` module.
