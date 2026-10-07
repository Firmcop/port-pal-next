# Archive & Delete Quotes (Admin)

Give admins/owners a way to take old or mistaken quotes off the active list, with a safe archive by default and a true delete only when the quote isn't linked to anything downstream.

## Behaviour

**Archive (reversible, any quote)**
- Admin/owner picks "Archive" from a row action menu, gives an optional reason.
- Archived quotes disappear from the default list; a "Show archived" toggle brings them back, marked with an "Archived" badge.
- "Restore" returns the quote to the active list.
- Archived quotes can't be edited, status-changed, or converted to an order/job until restored.

**Delete (permanent, restricted)**
- Only admin/owner, and only when the quote has no sales order, invoice, conversion job, or container sale attached.
- If links exist, the delete option is disabled with an explanation ("Linked to SO-XXXX — archive instead").
- Confirmation dialog requires typing the quote number plus a mandatory reason.
- Deletion removes the quote and its own items/sections/visuals; the reason and quote snapshot are kept in an audit record.

Non-admin users see neither action.

## Technical notes

Database migration:
- Add `archived_at`, `archived_by`, `archive_reason` to `quotes`.
- `archive_quote(_id, _reason)` / `unarchive_quote(_id)` RPCs — admin/owner only, org-scoped, security definer with pinned `search_path`, EXECUTE granted to `authenticated` only.
- `delete_quote(_id, _reason)` RPC — admin/owner only; raises a clear error if `sales_orders`, `invoices`, `container_conversions`, or `container_sales` reference the quote; writes a row into a new `quote_deletion_audit` table (quote number, customer, amount, reason, actor, JSON snapshot) before deleting; child rows removed in the same transaction.
- `quote_deletion_audit` gets GRANTs plus RLS: org members read, service_role full, inserts only via the RPC.
- Guard trigger on `quotes` blocking updates while `archived_at` is set (except the unarchive path).

Frontend (`src/pages/Quotes.tsx`, plus a small action-menu component and a mirrored action on `src/pages/QuoteDetail.tsx`):
- Filter query by `archived_at is null` unless "Show archived" is on.
- Row dropdown with Archive / Restore / Delete, gated by the existing role check used elsewhere (admin/owner).
- Disable status select and "Accept & Order" for archived rows.
