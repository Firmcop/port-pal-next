# Correct acquisition invoices billed to Firmcop instead of JJ MES DMCC

## What is actually wrong

No container in inventory carries "Firmcop Limited" in its owner field — every one of the 128 containers already reads JJ MES DMCC. The wrong name is coming from the **purchase invoices behind the acquisition cost**, which is what the container detail and acquisition panels display as the seller.

Confirmed in the data:

- **2 acquisition purchase invoices** are billed from "Firmcop Limited" instead of JJ MES DMCC:
  - CAXU8155090 (20ft, depot owned) — KES 125,000
  - TRKU2039974 (20ft, depot owned) — KES 700
  Both are unpaid and still in "issued" status, so they can be corrected cleanly.
- **10 further purchase invoices** are self-billed from "Firmcop", "Firmcop Limited" or "Firmcop Mombasa Depo" with reason "sale" — the depot invoicing itself, which should never happen.
- Three near-duplicate supplier records exist for the depot itself: Firmcop, Firmcop Limited, Firmcop Mombasa Depo.

## The fix

1. **Repoint the two acquisition invoices** to JJ MES DMCC and restate both to the agreed 20ft price of **USD 700**, including the exchange-rate conversion into the base currency.
2. **Update the matching accounts-payable entries** so the liability moves off Firmcop and onto JJ MES DMCC at the restated amount, and the container's acquisition total refreshes accordingly.
3. **Handle the 10 self-billed invoices**: the ones tied to a container get repointed to JJ MES DMCC; those with no container attached get listed for your review rather than changed blindly, since we cannot tell what they were meant to be.
4. **Log every change** to the finance audit trail with the reason "owner correction — supplier is JJ MES DMCC", showing old vs new supplier, amount and currency.
5. **Add a standing check** to the inventory Data Health card that flags any future acquisition invoice billed from the depot's own company, so this cannot silently reappear.

## What you will see

- The two containers show JJ MES DMCC as the seller with a USD 700 acquisition line, and their total acquisition cost updates.
- A short on-screen summary after the correction listing what changed and which invoices need your manual decision.
- Container sales and conversions that use these containers pick up the corrected entry price automatically.

## Technical notes

- New migration adding a `correct_acquisition_invoice_supplier` admin-only RPC that reassigns `supplier_invoices.supplier_id`, restates amount/currency/fx (setting the currency-override flag and writing `invoice_currency_audit`), rewrites the linked `accounting_transactions` counterparty, and writes `finance_audit_log`.
- A one-off data run through the RPC for the identified invoices; no direct table updates.
- Guard: refuse correction on invoices that are paid, cancelled or credited, and report them instead.
- The duplicate Firmcop supplier records are left in place (they are referenced by history); only invoice ownership moves.
