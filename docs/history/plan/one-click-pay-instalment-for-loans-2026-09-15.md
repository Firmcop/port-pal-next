# One-click "Pay instalment" for loans

After the bank deducts a loan instalment, the user currently has to post principal and interest as separate manual movements. Add a single "Pay instalment" action that reads the repayment schedule, splits the payment correctly, and posts everything in one step.

## What gets built

**1. New database function `pay_loan_instalment` (SECURITY DEFINER)**

Inputs: `_loan_id`, `_schedule_line_id` (the instalment from `loan_schedule_lines`), `_txn_date` (defaults to the line's due date), `_total_amount` (optional override; otherwise the line's outstanding `total_due - paid_amount`), `_financial_account_id` (optional; falls back to the loan's account), `_external_ref`, `_description`.

Behaviour:
- Loads the schedule line and computes the outstanding principal, interest and penalty portions (proportionally scaled if the amount paid is less than the full instalment).
- Calls the existing `post_loan_transaction` for each portion — `principal_payment`, `interest_payment`, `penalty_payment` — with `_source = 'instalment'`, so the schedule, liability, interest expense and bank GL credit all update exactly as today.
- Raises a clear error if the instalment is already fully paid, the loan is cancelled/settled, or the amount is not positive.
- Returns a summary (posted portions and totals) for the confirmation toast.
- Existing rules preserved: `REVOKE ... FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated`, `SET search_path TO 'public'`.

**2. "Pay instalment" dialog on the loan detail page** (`src/pages/finance/LoanDetail.tsx`)

- New button next to "Movement", visible when the loan is active/in arrears.
- Picker listing the loan's not-fully-paid schedule lines (seq, due date, outstanding), defaulting to the next due instalment.
- Shows the split it will post: principal / interest / penalty, with an optional total override (e.g. the bank deducted a slightly different amount).
- Fields: payment date, paying bank account (defaults to the loan's account), bank reference, note. Includes the same account/currency mismatch hint used elsewhere in finance.
- Confirm posts via the new RPC; success toast summarises what was posted; loan queries invalidated (same `invalidate()` helper as today).

**3. Loans list shortcut** (`src/pages/finance/Loans.tsx`)

- A "Pay" action on rows with outstanding instalments that deep-links to the loan detail with the dialog pre-opened, so due-date alerts lead straight to payment.

## Verification

- `npx tsgo --noEmit -p tsconfig.app.json` stays clean.
- Playwright: open a real loan, use Pay instalment, confirm the schedule line flips to paid/part-paid, the movements appear under Transactions, the ledger credit hits the bank account, and Finance → Accounts balance reflects it.
