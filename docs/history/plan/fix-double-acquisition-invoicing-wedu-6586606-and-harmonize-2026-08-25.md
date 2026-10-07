# Fix double acquisition invoicing (WEDU 6586606) and harmonize the rule

## What is actually wrong

Confirmed from the data for WEDU 6586606:

- The container was already acquired: `PINV-20260823-ddf842`, JJ MES DMCC, USD 700, reason **purchase** (plus transport KES 32,500 and offloading KES 2,000).
- Marking the sale `SLE-MT8B8BEB` as sold raised **two more** acquisition invoices to JJ MES DMCC, USD 983.27 each (`PINV-20260825-1ac9d6` at 06:53:54 and `PINV-20260825-71eb89` at 06:54:12), each with its own PO and its own payable ledger entry.

Two separate defects:

1. **No idempotency.** `acquire_container_from_owner` has no guard on (container, reason, reference), so a retried/second click of "Mark sold" creates a second PO + invoice + payable. The sale row is still `listed` while the container is `sold`, which is what a half-failed-then-retried run looks like.
2. **No "already acquired" guard.** Once a container carries a `purchase` acquisition invoice, the box is ours — selling it must not raise a second acquisition liability to the owner. The sale-time acquisition path only made sense for boxes that were never purchase-invoiced.

This is system-wide, not one row:

- 8 (container, reason, reference) groups have more than one invoice.
- 23 containers carry both a `purchase` acquisition invoice and one or more sale/gate-out/conversion acquisition invoices.

## The rule to enforce (harmonization)

**One acquisition liability per container, ever.** The acquisition cost is the purchase invoice plus its transport and offloading invoices. Sale, gate-out-sale and conversion never create a new acquisition invoice for a container that already has one — they only *read* the acquisition cost as the entry price.

## Backend work

1. Migration on `acquire_container_from_owner`:
   - Return the existing PO id (no-op) when an invoice already exists for the same container + reason + reference, in any non-cancelled state.
   - Return the existing PO id when the container already has a non-cancelled `purchase` acquisition invoice and the incoming reason is `sale` / `gate_out_sale` / `conversion`, writing a `finance_audit_log` entry explaining the skip.
   - Add a partial unique index on (organization_id, container_id, reason, reference) for non-cancelled, non-adjustment invoices so a race can never duplicate again.
2. New admin RPC `reverse_duplicate_acquisition_invoice(_invoice_id, _reason)`:
   - Cancels the invoice and its PO, reverses the `container_acquisition_payable` ledger entry with a contra transaction, and logs to `finance_audit_log`. No hard deletes.
3. New read-only RPC `duplicate_acquisition_audit()` returning, per container: purchase invoice, redundant sale/conversion acquisition invoices, duplicate-reference groups, and the payable amount to be reversed.

## Data correction

- Reverse `PINV-20260825-71eb89` and `PINV-20260825-1ac9d6` for WEDU 6586606 (both redundant — the container was already purchase-invoiced), leaving the JJ MES DMCC USD 700 purchase invoice as the acquisition.
- Reconcile the `SLE-MT8B8BEB` sale row so its status matches the container's `sold` state and its entry price reads from the acquisition invoices.
- Review the other 22 affected containers through the audit screen and reverse the redundant sale-time acquisition invoices in a batch. Existing `PINV-ADJ-...` correction pairs are left alone — those are intentional adjustments, not duplicates.

## Frontend work

- `src/pages/ContainerSales.tsx`: disable "Mark sold" while the mutation is in flight and short-circuit when the sale is already sold, so a double click can't fire the flow twice.
- `src/pages/EIRRecords.tsx`: same guard on the gate-out-sale path, and skip the acquisition call when the container already has a purchase acquisition invoice.
- New admin page `/finance/acquisition-duplicates` listing what `duplicate_acquisition_audit()` finds, with per-row and bulk "Reverse" actions and a reason field.
- Supplier Invoices list: badge invoices that are cancelled reversals so the double rows in the screenshot read clearly.

## Tests

- Extend `src/lib/container-acquisition.test.ts` with cases asserting the helper is a no-op on repeat calls and when a purchase acquisition already exists.
