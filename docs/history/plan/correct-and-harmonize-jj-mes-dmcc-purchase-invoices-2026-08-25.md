# Correct and harmonize JJ MES DMCC purchase invoices

## Verified findings

- `PINV-20260716-7d2c06` is wrong: it bills **USD 260,000** for 40ft container **TGHU 6447457** through the sale path. The same container already has the correct acquisition invoice `PINV-20260823-abad7c` for **USD 1,700**.
- `PINV-ADJ-20260716-67e7a9` is wrong: it is a **USD -32,500** adjustment for 20ft container **KKTU 7470816**. That container already has the correct purchase invoice `PINV-20260823-11ac86` for **USD 700**; two KES 700 sale invoices are also duplicates.
- The current active JJ MES DMCC records contain **15 containers with duplicate supplier acquisition invoices** and **24 redundant active invoices**. One duplicate invoice is paid, so its payment must be preserved and moved to the retained invoice rather than discarded.
- The five USD 1,650 invoices are all 40ft units added from **20 August 2026 onward** and match the stated latest-gate-in discount. They will be retained as legitimate discounted purchase prices.
- Transport and crane/offloading invoices are separate acquisition components and will not be cancelled by this correction.

## Correction

### 1. Establish the retained supplier invoice per container
- Keep one JJ MES DMCC purchase-price invoice per original acquired container.
- Standard price: **20ft = USD 700** and **40ft = USD 1,700**.
- Discount exception: retain the existing **USD 1,650** purchase invoices for the five latest 40ft gate-ins.
- Do not create purchase invoices for split-child containers; they inherit apportioned cost from the mother unit.

### 2. Cancel and reverse redundant invoices
- Cancel the two named invoices and every other active sale/EIR/conversion-generated JJ MES DMCC invoice where a valid purchase invoice already exists.
- Cancel each linked redundant purchase order and create balanced reversing ledger entries; do not delete financial history.
- Record the retained invoice, cancelled invoice, container, original call path, reason, actor, and timestamp in the finance audit trail.
- For the one paid duplicate, relink its payment to the retained USD invoice and preserve the KES-paying-account settlement with its effective FX rate before reversing the duplicate document.

### 3. Correct malformed retained records
- Fix any retained invoice whose size/rate is wrong, including the 20ft record currently carrying USD 1,700.
- Ensure invoice, invoice line, purchase order, container acquisition component, FX/base amount, and downstream sale/conversion entry cost all agree after correction.
- Leave legitimate USD 1,650 discount invoices unchanged and mark their pricing basis as a supplier discount so future audits do not flag them.

### 4. Prevent recurrence at the database boundary
- Strengthen acquisition-invoice creation so sale, EIR, conversion, backfill, and inventory intake all resolve the same canonical purchase invoice before creating a liability.
- Enforce supplier currency/rate rules for JJ MES DMCC: USD 700/1,700 by container size, with an explicit discount override and mandatory reason rather than silently using sale price or organisation currency.
- Block negative supplier invoices such as `PINV-ADJ-...` for acquisition-cost corrections; corrections will use controlled credit/reversal records instead.
- Keep transport and offloading idempotency separate by service type and supplier.

### 5. Make supplier invoicing clear in the UI
- On purchase invoices and reconciliation, show **Purchase price**, **Transport**, and **Offloading** as distinct components.
- Show container number, size, source call path, pricing basis (`Standard USD 1,700`, `Standard USD 700`, or `Supplier discount USD 1,650`), retained invoice, and cancellation/reversal status.
- Add warnings for wrong currency, wrong size/rate, multiple active purchase-price invoices, split-child invoicing, and sale/EIR/conversion invoices created after a canonical purchase invoice.

### 6. Validate the corrected position
- Re-run reconciliation and require exactly one active JJ MES DMCC purchase-price liability per eligible original container.
- Confirm the two named invoices are cancelled and fully reversed.
- Confirm all retained 20ft invoices are USD 700; all retained 40ft invoices are USD 1,700 except the five documented USD 1,650 discounted gate-ins.
- Confirm AP, purchase orders, ledger balances, container acquisition costs, sales entry prices, and conversion container costs reconcile after the cleanup.

## Technical notes

- Apply the guard and controlled correction/reversal logic through a database migration.
- Apply the identified row corrections as a separately reviewed data operation after the guard is active.
- Extend the existing invoice reconciliation dashboard rather than creating another finance screen.
