# JJ MES DMCC supplier statement reconciliation

I compared the 89 container lines on the supplier's bundled invoices against our purchase invoices for JJ MES DMCC (103 issued, USD 140,850 total). Findings first, then what to build.

## What the comparison shows

**1. Container numbers on the supplier list that do not exist in our inventory (18)**

Four look like typos on our side (our record is truncated or mistyped):

| Supplier list | Our record | Our status |
|---|---|---|
| AMFU8671919 | AMFU 867191 | sold |
| YMLU8143948 | YMLU 814394 | available |
| BSIU9373300 | BSIU 937260 | booked for repatriation |
| WEDU3561055 | WEDU 3561590 (needs confirming) | available |

The other fourteen have no plausible match and appear to be genuinely un-received units: BMOU2021982, BSIU9500128, BSIU9512936, CAIU2689652, GESU5820352, LMCU7000753, MSKU3302139, MSKU5056414, MSKU7610839, MSKU7943824, SUDU1432630, SUDU1467534, TCKU3839695, WEDU3192851.

Two more of ours look mistyped against the list as well: TCNU 729431 (vs TCNU7294319) and TDRU 7496991 (vs TRLU7496991).

**2. Container in inventory with no purchase invoice at all**

FSCU 6765059 (supplier invoice DD-SE20260716-0161, 40HC) — owned by JJ MES DMCC, booked for repatriation, no PINV raised.

**3. Duplicate live invoice**

TRKU 2039974 has two issued PINVs of USD 700 (PINV-20260823-ab51d9 and PINV-20260729-55675d).

**4. Amount mismatches per supplier invoice** (ours vs theirs, USD)

| Supplier invoice | Theirs | Ours | Gap |
|---|---|---|---|
| DD-SE20260227-0250 | 3,300 | 1,700 | 1,600 |
| DD-SE20260417-0146 | 1,750 | 1,700 | 50 |
| DD-SE20260428-0210 | 1,750 | 1,700 | 50 |
| DD-SE20260519-0160 | 5,400 | 4,800 | 600 |
| DD-SE20260523-0216 | 10,500 | 10,200 | 300 |
| DD-SE20260529-0263 | 5,600 | 6,300 | -700 |
| DD-SE20260612-0134 | 13,600 | 11,900 | 1,700 |
| DD-SE20260620-0192 | 6,500 | 5,900 | 600 |
| DD-SE20260710-0119 | 4,200 | 2,800 | 1,400 |
| DD-SE20260716-0161 | 3,400 | 1,700 | 1,700 |
| DD-SE20260803-0012 | 2,800 | 700 | 2,100 |
| DD-SE20260804-0015 | 5,100 | 1,700 | 3,400 |
| DD-SE20260821-0226 | 6,850 | 6,800 | 50 |

Two causes: containers missing from our inventory, and our flat 700 / 1,700 pricing where the supplier billed 1,650 / 1,750 / 800 on some lines. Seven bundles match exactly.

Also note we hold roughly 55 JJ MES DMCC containers that appear nowhere on this statement (repatriated units plus split children) — expected, but listed in the screen so nothing is silently ignored.

## What to build

**1. Correct our container numbers to the supplier's spelling**

Six audited corrections through `admin_update_container`, with the reason "Container number corrected to match supplier invoice <DD-...>":

| Ours | Corrected to | Supplier invoice |
|---|---|---|
| AMFU 867191 | AMFU8671919 | DD-SE20260612-0134 |
| YMLU 814394 | YMLU8143948 | DD-SE20260324-0176 |
| BSIU 937260 | BSIU9373300 | DD-SE20260804-0015 |
| TCNU 729431 | TCNU7294319 | DD-SE20260612-0134 |
| TDRU 7496991 | TRLU7496991 | DD-SE20260821-0226 |
| WEDU 3561590 | WEDU3561055 | DD-SE20260803-0012 |

WEDU 3561590 is the one I am not fully sure of — DD-SE20260729-0276 also lists a WEDU3561590, so this row is presented for confirmation before it is applied rather than corrected blind.

Their existing purchase invoices follow the container automatically (they are linked by container id); the invoice `reference` field, which currently carries the old container number, is updated in the same step.

**2. Bundled historical purchase invoices for the fourteen pre-system units**

The statement covers the whole year to date, so these units predate the system and were never received into inventory: BMOU2021982, BSIU9500128, BSIU9512936, CAIU2689652, GESU5820352, LMCU7000753, MSKU3302139, MSKU5056414, MSKU7610839, MSKU7943824, SUDU1432630, SUDU1467534, TCKU3839695, WEDU3192851.

For each affected supplier bundle we raise one purchase invoice payable to JJ MES DMCC carrying the supplier's own number and one line per container at the supplier's unit price — no container records are created, and no gate-in, EIR or acquisition-cost side effects fire. These are historical payables only:

| Supplier invoice | Containers | Amount (USD) |
|---|---|---|
| DD-SE20260103-0006 | SUDU1467534, SUDU1432630, MSKU5056414, MSKU3302139 | 3,200 |
| DD-SE20260227-0250 | GESU5820352 | 1,650 |
| DD-SE20260313-0106 | MSKU7610839, MSKU7943824 | 1,700 |
| DD-SE20260618-0180 | LMCU7000753 | 2,350 |
| DD-SE20260710-0119 | CAIU2689652, BMOU2021982 | 1,400 |
| DD-SE20260803-0010 | BSIU9512936 | 1,700 |
| DD-SE20260803-0012 | TCKU3839695, WEDU3192851 | 1,400 |
| DD-SE20260804-0015 | BSIU9500128 | 1,700 |

Amounts shown are the residual of each bundle after the containers we already invoiced; the screen recalculates them from the statement so nothing is double-counted, and it refuses to post a bundle whose residual is zero or negative.

**3. Supplier's own invoice number on our purchase invoices**
- New optional `supplier_ref` field (their number, e.g. `DD-SE20260612-0134`), shown as a column on the Supplier Invoices page, editable in the existing edit dialog, and settable in bulk from the reconciliation screen.
- Every existing JJ MES purchase invoice gets its `supplier_ref` set from the statement match in one bulk, audited action.

**4. Supplier statement reconciliation screen** at `/finance/supplier-statement`
- Pick the supplier, paste or upload the statement rows (supplier invoice no, amount, container no, type). The JJ MES DMCC statement is preloaded.
- Each line is classified: Matched, Amount differs, No invoice raised, Not in inventory (pre-system), Likely typo with suggested correction, Duplicate invoice.
- Per-bundle totals: theirs vs ours vs gap.
- Admin-only, reason-logged actions per row: apply the container-number correction, assign the supplier invoice number, raise the bundled historical invoice, cancel the duplicate.
- Amount mismatches are reported only — flagged with the gap, left for manual correction through the existing edit dialog, as requested.
- CSV export of the whole reconciliation.

**5. Two one-off fixes**
- FSCU 6765059: raise its missing purchase invoice under DD-SE20260716-0161.
- TRKU 2039974: cancel the duplicate PINV via the existing reversal RPC.

## Technical notes

- Migration: `supplier_invoices.supplier_ref text` (indexed per organization) mirrored onto `purchase_orders`. Extend `admin_update_supplier_invoice` to accept `supplier_ref` in its patch, still writing `supplier_invoice_audit`.
- New RPC `set_supplier_invoice_refs(_invoice_ids uuid[], _supplier_ref text, _reason text)` — admin-only, one audit row per invoice.
- New RPC `create_bundled_supplier_invoice(_supplier_id uuid, _supplier_ref text, _currency text, _lines jsonb, _issue_date date, _reason text)` — creates one `supplier_invoices` header plus `supplier_invoice_lines` (container number as free text, no `container_id`), the acquisition-payable accounting transaction and the audit row; idempotent on `supplier_id + supplier_ref` so a re-run cannot duplicate a bundle.
- New read-only RPC `reconcile_supplier_statement(_supplier_id uuid, _lines jsonb)` returning per-line classification via normalized exact match then trigram near-match for typo suggestions.
- Container-number corrections reuse `admin_update_container` (reason mandatory); the invoice `reference` update rides along in the same transaction.
- New page `src/pages/finance/SupplierStatementReconciliation.tsx` with `StatementLineTable`, `AssignSupplierRefDialog` and `BundledInvoiceDialog`; route registered in `src/App.tsx` under the accounting guard, linked from Supplier Invoices.
- Statement parsing and matching helper `src/lib/supplier-statement.ts` (CSV/paste parsing, container-number normalization, bundle residual maths) with unit tests covering normalization, near-match rules and the residual calculation.

