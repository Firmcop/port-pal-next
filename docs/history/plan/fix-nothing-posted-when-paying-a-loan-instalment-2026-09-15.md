# Fix "nothing_posted" when paying a loan instalment

## What actually happened

Your payments did post. On the KCB 3,000,000 facility two instalment payments were recorded at 17:59 today:

- principal 45,103.31 + interest 12,621.99
- principal 84,646.95 + interest 22,201.15

The red "nothing_posted" message came from a further attempt that the system treated as a repeat of one already recorded. Loan movements are protected by a duplicate guard that blocks a second entry with the same loan, date, type and amount when no bank reference is given. That guard is right to stop an accidental double-click, but today it produced a confusing red error instead of an explanation, and it would also block two genuinely different instalments that happen to be the same amount and paid on the same day.

## What gets changed

**1. Each instalment payment carries its own reference**

When no bank reference is typed, the payment is tagged automatically with the instalment it belongs to. Two different instalments of the same amount on the same day then both post correctly, while pressing the button twice for the *same* instalment is still blocked.

**2. A clear message instead of "nothing_posted"**

If everything in the payment was already recorded, the dialog shows a plain explanation — "This instalment payment is already recorded" — with the existing entries named, rather than a red failure. Partial cases (where only one part was a repeat) report what was newly posted.

**3. Friendlier wording for the other errors**

The remaining backend codes (already paid, facility settled, amount missing) keep their existing plain-English translations in the dialog.

## Verification

- Re-run a payment for an instalment that was already paid and confirm the informative message appears and nothing is duplicated.
- Pay two different instalments of the same amount on the same date and confirm both post.
- Confirm the schedule, loan balance and bank account figures match the payments already recorded today.

## Technical notes

- `pay_loan_instalment`: default `_external_ref` to a deterministic per-line token (e.g. `INST-<schedule_line_id>`) when the caller passes none, so `loan_txn_dedupe` scopes to the instalment instead of the amount+date.
- Replace the blanket `RAISE EXCEPTION 'nothing_posted'` with a returned payload flagged `already_recorded`, listing the matching existing `loan_transactions` rows; keep SECURITY DEFINER, `SET search_path TO 'public'`, authenticated-only grants.
- `LoanPayInstalmentDialog.tsx`: handle the `already_recorded` payload as an informational toast, keep `invalidate()` running so the screen refreshes.
- No history is edited or deleted; today's two posted payments stay as they are.
