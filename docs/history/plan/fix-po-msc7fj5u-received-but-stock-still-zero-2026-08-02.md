# Fix: PO-MSC7FJ5U received but stock still zero

## What the data shows

- PO-MSC7FJ5U has one line, "KIDANI BOX MATTE GREY G30", ordered 117.6, received 117.6, receipt not voided.
- That PO line has **no material linked** (`material_id` is empty), so the receipt had nothing to post stock against.
- A catalogue material with the exact same name already exists ("KIDANI BOX MATTE GREY G30", unit m) and its on-hand is 0.
- This is not a one-off: 3 received PO lines across 3 POs have no material linked.

So the receipt is recorded correctly; it just never reached inventory because the line was free text.

## What to do

1. **Fix this PO now** — link the receipt line to the existing "KIDANI BOX MATTE GREY G30" material and post the 117.6 into stock through the existing material ledger, so the movement is traceable rather than a silent balance edit.
2. **Fix the other 2 unlinked received lines** the same way where an exact catalogue match exists; leave any without a clear match for manual linking.
3. **Surface the problem instead of hiding it**:
   - In Goods Receipts, show a clear "not in stock — no material linked" marker on affected lines (the "Link material" action already exists there).
   - Add a banner at the top of the Procurement page counting receipted lines that never hit stock, linking to the Goods Receipts tab.
4. **Prevent recurrence**: when creating or editing a PO line for a stockable item, require picking a catalogue material (with the option to create it inline), and warn before posting a receipt for any line that still has none.

## Technical notes

- Correction uses the existing `link_receipt_item_to_material(_receipt_item_id, _material_id)` RPC, which links the line and posts the ledger movement; balances mirror to `material_stock` via existing triggers.
- Historic backfill for the 3 lines runs as a one-off migration calling that same RPC path, so `material_movements` records the correction with a reason.
- UI work is limited to `src/pages/PurchaseOrders.tsx` (Goods Receipts tab badge/banner, PO line material requirement in the create/edit dialog).
