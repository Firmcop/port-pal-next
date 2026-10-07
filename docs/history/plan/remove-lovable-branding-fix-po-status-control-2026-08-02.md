# Remove Lovable branding + fix PO status control

## 1. Remove "Edit with Lovable" badge and Lovable favicon

- Turn off the published-site badge via publish settings (requires your approval; Pro plan or higher).
- Replace `public/favicon.ico` with a Port Pal / depot-branded icon and reference a PNG icon plus `apple-touch-icon` in `index.html`, so the browser tab and domain no longer show the Lovable mark.

## 2. Purchase Order status: remove the free dropdown

Today the status cell is a dropdown that lets anyone set any status, including moving a received PO back to `draft`. That is wrong for an ERP: status must follow the document lifecycle and be driven by the actions that actually happen (send, confirm, receive, pay, cancel).

### New behaviour

- The status cell becomes a **read-only badge** — no dropdown.
- Next to it, a single contextual action button offers only the legal next step:

```text
draft              -> [Send to supplier]      => sent
sent               -> [Mark confirmed]        => confirmed
confirmed          -> [Receive] (existing)    => partially_received / received (set by receipt)
partially_received -> [Receive] (existing)    => partially_received / received
received           -> [Mark paid]             => paid   (only if fully invoiced/received)
paid               -> no action (terminal)
cancelled          -> no action (terminal)
```

- **Cancel** is available only from `draft`, `sent`, `confirmed` (never after goods are received), shown in an overflow menu with a confirmation dialog.
- `partially_received` and `received` are never set manually — they remain computed from goods receipts.
- Backward moves are removed entirely. If a genuine correction is needed, an **admin-only "Reset status"** action (in the overflow menu, admin/owner role) allows a single step back with a mandatory reason, recorded to the audit trail.

### Guardrail

Add a database trigger on `purchase_orders` that rejects any status change not in the allowed transition map, so the rule holds regardless of where the update comes from. Admin resets pass a reason and are logged.

## Technical notes

- `src/pages/PurchaseOrders.tsx`: replace the `Select` in the status column with a `Badge` plus contextual action buttons; keep the existing `Receive` flow untouched. Repurpose the `updateStatus` mutation into a `transitionStatus` helper that only accepts allowed targets.
- New migration: `trg_enforce_po_status_transition` (BEFORE UPDATE, `SECURITY DEFINER` validation function with pinned `search_path`) plus an audit row on each transition.
- Admin reset uses a dedicated RPC (`admin_reset_po_status`) restricted to admin/owner with a required reason, so the trigger can distinguish it from normal flow.
