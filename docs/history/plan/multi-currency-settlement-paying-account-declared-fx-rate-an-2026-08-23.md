# Multi-currency settlement: paying account, declared FX rate, and bank charges

Payments can leave a KES or a USD account regardless of the document currency. Every outgoing settlement should let you choose the account, declare the actual exchange rate used when the currencies differ, and record bank charges that land in operating expenses.

## 1. Contra settlement: offset, then settle the remainder in cash

The contra screen currently only nets AR against AP. It gets a second, optional step:

- After the set-off amount is chosen, the preview shows the **residual supplier balance** in the document currency.
- Optionally pay all or part of that residual: pick the bank/cash account, payment date, method and reference.
- If the account currency differs from the document currency (KES account paying a USD supplier), an **exchange rate field is required** — the same manual-rate pattern already used on acquisition costs, pre-filled from the stored FX table but always editable. The screen shows the resulting amount in the account currency before posting.
- A **bank charges** field (in the paying account's currency) can be entered with an optional description.
- Everything posts in one transaction: the IAS 32 offset, the cash payment with its locked FX rate, and the bank-charge expense.

## 2. Same options on the other payment flows

The lumpsum supplier payment dialog and the Pay PO dialog get the same three controls: paying account (already present), declared exchange rate when account currency differs from the document currency, and bank charges. The FX warning currently shown on Pay PO is replaced by a real rate input.

## 3. Bank charges go to OPEX

- A **Bank Charges** expense category is created for organisations that don't have one.
- Each charge auto-posts a paid operating expense against the same bank account on the payment date, referencing the payment or settlement number, so it appears in OPEX, the P&L and the account balance without extra work.
- Bank charges are shown as a separate line on the settlement/payment record — never rolled into the supplier's invoice balance.

## Technical notes

- Schema: add `fx_rate`, `settlement_account_id`, `cash_amount`, `bank_charge_amount`, `bank_charge_expense_id` to `contra_settlements`; add `bank_charge_amount` / `bank_charge_expense_id` to `vendor_payments`.
- `post_contra_settlement` gains `_account_id`, `_cash_amount`, `_fx_rate`, `_bank_charge`, `_bank_charge_note`; it validates that a rate is supplied whenever the account currency differs, records the residual payment via the existing on-account allocation path (FIFO across open supplier invoices), and calls a new `post_bank_charge_expense` helper.
- `post_bank_charge_expense(_org, _account_id, _amount, _date, _ref, _note)` ensures the Bank Charges category and GL account exist, then calls `post_operating_expense` in "paid" mode so the ledger, bank balance and P&L stay in sync.
- `record_supplier_onaccount_payment` and `record_vendor_payment` take the same optional `_fx_rate` / `_bank_charge` arguments; existing callers keep working since all new arguments default to null.
- FX rates are stored on the payment row so revaluation and reporting use the declared rate, not a later table rate.
- UI: reuse `FxRateInput` in `ContraSettlements.tsx`, `LumpsumPaymentDialog.tsx` and `PayPoDialog.tsx`; add a shared bank-charge field component.
