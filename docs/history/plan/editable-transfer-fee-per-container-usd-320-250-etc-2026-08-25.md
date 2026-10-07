# Editable transfer fee per container (USD 320 / 250 / etc.)

## Current state (verified)

- `generate_repatriation_transfer_invoice` takes a single `_amount` applied to every eligible container; the dialog sends one flat fee (default 320) for all units.
- Each billed unit is recorded in `repatriation_transfer_invoice_lines` (amount, currency, rate card) and snapshotted on `repatriations.transfer_fee_applied`, alongside one `invoice_line_items` row per container.
- There is no way to set a different fee per container, and no way to change a fee once the transfer invoice exists.

## 1. Per-container fee before invoicing

- In the transfer invoice dialog, each eligible row gets its own editable amount input, pre-filled from the rate card / snapshot / the flat default.
- A "set all to" box stays at the top for the common case (e.g. all 320), applying to every row in one click; individual rows can then be overridden (e.g. 250).
- Running total and line count update live; generate is blocked if any eligible row has a zero or negative amount.
- The generate call passes an explicit per-repatriation amount list instead of one flat number.

## 2. Editing the fee after the invoice is raised

- New "Edit transfer fees" action on a transfer invoice (`RPT-…`), available while the invoice is not paid or cancelled.
- Table of the invoice's container lines with editable amounts; saving restates in one atomic step:
  - the invoice line item amounts and the invoice subtotal/total/balance,
  - the `repatriation_transfer_invoice_lines` amounts,
  - the `transfer_fee_applied` snapshot on each repatriation.
- A reason note is required and written to the audit trail, and the change is logged as an org event; already-received payments are preserved and the balance recomputed from the new total.
- Blocked when the invoice is paid, cancelled, or partly settled beyond the new total, with a clear message.

## 3. Rate history

- Rate Cards keep driving the default: a card with a USD 250 transfer fee and its own validity window explains historic 250 charges, while the current card stays 320. Nothing already invoiced is restated when a card changes.

## Technical notes

- Migration: change `generate_repatriation_transfer_invoice` to accept an optional `_amounts numeric[]` aligned to `_repatriation_ids` (falls back to `_amount` when absent); add `set_repatriation_transfer_line_amounts(_invoice_id uuid, _repatriation_ids uuid[], _amounts numeric[], _reason text)` as SECURITY DEFINER with execute revoked from public/anon and granted to authenticated.
- Frontend: `src/components/repatriation/RepatriationTransferInvoiceDialog.tsx` (per-row inputs, bulk-set, per-row payload), new `EditTransferFeesDialog.tsx`, entry point from the invoice row in `src/pages/Invoices.tsx` and from the Transfer badge in `src/pages/Repatriation.tsx`.
- No records deleted; every fee change carries a reason and an audit entry.
