# Make "Mark paid" on a PO create a real payment in Finance

## What's happening now

Marking a purchase order as **Paid** in Procurement only changes the PO's status text. It does not create a payment record, does not move money out of any bank/cash account, and does not post to the ledger. Finance > Payments > **Vendor Payments** lists actual payment vouchers only, so those POs never appear there.

Confirmed in the database: 19 purchase orders currently sit at status `paid` with no matching vendor payment (18 in the active organisation, 1 legacy). They do show up in the existing **Needs Payment Record** tab of the Payments page, which is the last tab and easy to miss.

## What to build

1. **Paying a PO becomes a finance action.**
   In Procurement, "Mark paid" opens a small dialog asking for: paying account (bank/cash), amount (defaults to the PO balance), payment date, method, and reference. On confirm it calls the existing `record_vendor_payment` routine, which creates the vendor payment voucher, reduces the account balance, posts the ledger entry, and sets the PO to paid. Partial amounts leave the PO in its current status with a visible balance.

2. **No more silent status flip.**
   The status pipeline can no longer jump straight to `paid` without a payment record behind it. Admins keep the existing override path (reason required) for corrections.

3. **Backlog is made obvious.**
   The Payments page opens on the outstanding work: the "Needs Payment Record" tab gets a count badge and a banner on the Vendor Payments tab pointing at it, so the 19 already-marked POs can be reconciled one by one (choose account, date, reference).

4. **Received but unpaid POs are visible.**
   Add an "Awaiting payment" list on the Vendor Payments tab: POs at `received`/`partially_received` with an outstanding balance, each with a Pay button that opens the same dialog.

## Existing records

The 19 already-marked POs are left as-is in the backlog rather than auto-creating payments, because the paying account, date and reference are unknown and inventing them would corrupt bank balances and the P&L. They are cleared through the reconcile flow above.

## Technical notes

- Frontend: `src/pages/PurchaseOrders.tsx`, `src/components/procurement/PoStatusCell.tsx` (new pay dialog), `src/pages/Payments.tsx` (badge, banner, awaiting-payment list).
- Backend: reuse `record_vendor_payment`; tighten `enforce_po_status_transition` so `paid` requires an existing `vendor_payments` row unless set by the admin override RPC.
- `v_unrecorded_payments` stays as the backlog source; it is already readable and org-scoped.
