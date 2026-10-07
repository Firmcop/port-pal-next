# Fix: received materials not showing in stock

## What I found (verified against the live database)

Two separate root causes, both confirmed:

**1. Your most recent receipt had no material linked.**
PO-MSC7FJ5U ("KIDANI BOX MATTE GREY G30", qty 117.6) was received at 19:39 today and marked auto-posted, but the PO line is a free-text line with no material attached. The receipt routine only moves stock when a line points at a catalogue material, so nothing was added anywhere. This is the receipt you are looking for.

**2. The system keeps material stock in two places that never talk to each other.**

- Goods receipts write to `material_stock.qty_available`.
- Conversion jobs / production consumption and stock adjustments write to `materials.on_hand_qty`.

Result, from live data:

```text
Material              on_hand_qty   material_stock
RHS 40*25*1.5MM           -139           116
SHS 40*40*1.5MM            -52            52
SHS 25*25*1.0mm              0           296
RHS 100*50*2.5               0            78
```

Receipts pile up on one side, consumption pushes the other side negative. Screens disagree depending on which column they read (Materials page reads `material_stock`; Conversions, Catalog Picker, Sub-assembly and Stock Adjustments read `on_hand_qty`).

**3. Duplicate receipt of the same PO.** PO-MRYZUDWB was received twice (19:18 and 19:21) and both postings added stock — SHS 25*25 shows 296 instead of 130. There is no check on quantity already received.

## The fix

**A. One source of truth for material quantity**
Make `materials.on_hand_qty` the single authoritative quantity and keep `material_stock.qty_available` in sync automatically via a database trigger, so no screen has to change how it reads. Every posting path (goods receipt, approved variance receipt, store issue, store return, stock adjustment, conversion consumption) writes through the same helper, so both columns always agree.

**B. Reconcile existing balances**
One-off correction: for each material, compute the true balance from its history (receipts in, issues/consumption out, adjustments) and set both columns to that figure. Negative balances that come from consumption never matched by a receipt are surfaced in a short reconciliation report rather than silently zeroed, so you can decide what to write on.

**C. Un-linked PO lines**
- Require a material selection on PO lines that are stockable, with an explicit "non-stock / service" option for lines that genuinely should not touch inventory.
- At receipt time, warn clearly on each line that will not move stock ("no material linked — will not update inventory") instead of silently posting nothing.
- Add a "Link to material" action on an existing receipt line so the KIDANI BOX line can be attached to a material (creating it if needed) and posted retroactively, with an audit entry.

**D. Prevent duplicate receipts**
Track received-to-date per PO line. Receipt dialog defaults to the outstanding quantity, not the full ordered quantity, and blocks receiving against a fully received line unless it is deliberately entered as an over-receipt (which follows the existing variance approval route).

**E. Visibility**
Add a stock movement history per material (date, source document, in/out, running balance) so any future discrepancy is traceable to the document that caused it.

## Technical notes

- New `post_material_stock(material_id, delta, source_type, source_id, note)` SECURITY DEFINER function; `receive_po_with_variances`, `decide_goods_receipt_variance`, store issue/return, and `adjust_stock` all call it instead of writing tables directly.
- Trigger on `materials.on_hand_qty` mirrors into `material_stock.qty_available` (upsert) to keep older read paths working.
- `material_movements` table (material_id, delta, balance_after, source_type, source_id, org, actor, created_at) with org-scoped RLS and the standard GRANT block.
- `po_items.received_qty` maintained by the receipt routine; UI reads it for outstanding quantity.
- Backfill migration recomputes balances from `goods_receipt_items`, store issues/returns, `conversion_materials`, and `stock_adjustments`, and seeds `material_movements`.
