# Fix: saving acquisition costs fails on purchase order check constraint

## What is happening

Saving transport or crane/offloading costs raises the purchase invoice through the service-invoice routine, which creates a purchase order for that vendor and tags how the recipient was chosen as `service_vendor`.

The database rule that validates that tag only accepts three older values (`expected_owner`, `sale_original_owner`, `container_owner`). `service_vendor` was never added when the transport/crane invoices were introduced, so every save that needs a new service purchase order is rejected with:

`new row for relation "purchase_orders" violates check constraint "purchase_orders_recipient_source_chk"`

Confirmed by reading the constraint definition and the routine that writes the value.

## The fix

1. Widen the allowed values on `purchase_orders.recipient_source` to include `service_vendor` (keeping the existing three and still allowing empty).
2. Re-run the save path for a container with transport and crane amounts in different currencies to confirm the seller, transport and crane purchase invoices are all created and the acquisition total updates.
3. Re-run the bulk acquisition-cost edit on two containers to confirm the same path works in bulk.

No UI changes are needed — the dialog and preview logic are already correct; only the database validation rule is out of date.

## Technical notes

- Migration: drop and recreate `purchase_orders_recipient_source_chk` as
  `CHECK (recipient_source IS NULL OR recipient_source IN ('expected_owner','sale_original_owner','container_owner','service_vendor'))`.
- Writers involved: `record_container_service_invoice` (sets `service_vendor`) and `acquire_container_from_owner` (sets the owner-based values).
- Verification will run through the signed-in app so RLS and permissions apply, and the resulting supplier invoices/purchase orders will be inspected directly.
