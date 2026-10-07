# Fix "invalid_financial_account" when recording a payment

## What's happening

Confirmed from the database:

- All 3 active bank/cash accounts (ABSA KES, KCB KES, MPESA) belong to the live organization `6b29b65b…`.
- 5 invoices still belong to the legacy "Default Organization" (`00000000-…-0001`); the other 49 belong to the live org.
- `record_customer_payment` stamps the new payment with the **invoice's** organization, then a validation trigger rejects any account that doesn't belong to that same organization.

So paying one of the 5 legacy invoices always fails: the payment is created under the legacy org, but every selectable account lives in the live org. The account dropdown itself is fine — the mismatch is in the invoice's ownership.

## Fix

1. **Adopt the leftover legacy invoices** (and their line items, payments and related finance rows) into the live organization, using the existing `adopt_legacy_org_data` routine so nothing is orphaned.
2. **Guard against recurrence**: when the target invoice belongs to the legacy default org, have `record_customer_payment` resolve the organization from the caller's active org instead of blindly copying the invoice's.
3. **Make the error readable**: map `invalid_financial_account` / `financial_account_required` to a plain-English toast on the payment dialogs ("The selected account belongs to a different organization…") instead of showing the raw code.

## Technical notes

- Migration: run the legacy adoption for remaining `invoices` rows in `00000000-0000-0000-0000-000000000001`, then update `record_customer_payment` to use `COALESCE(NULLIF(_inv.organization_id, legacy_org), current_org_id(), _inv.organization_id)`.
- Frontend: error mapping in `src/pages/Payments.tsx` (customer receipts tab) and the shared payment dialogs that call the RPC; no business-logic changes beyond the message.

## Verification

- Re-query invoices grouped by organization to confirm zero legacy rows remain.
- Record a payment against a previously failing invoice in the preview and confirm it posts and the balance drops.
