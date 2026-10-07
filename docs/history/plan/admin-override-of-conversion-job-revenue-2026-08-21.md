# Admin override of conversion job revenue

Let admins correct the revenue (quoted price) of a conversion job after the fact, with a mandatory reason and a full audit trail. Everything downstream — the job's margin, the linked project's revenue/margin rollup — follows the corrected figure.

## What you get

- An **Edit revenue** button on the conversion job detail page, visible only to admins / org owners.
- A dialog showing the current quoted price and currency, a field for the new amount, and a required reason (min 10 characters). Saving without a reason is blocked.
- Every override is recorded: who changed it, when, old value, new value, currency, and the reason. Shown as a "Revenue change history" list on the job page.
- If the job already has revenue posted to the ledger, the system posts a balancing journal entry for the difference (in the job's own currency, with the locked FX rate) so accounting stays in balance instead of being silently rewritten.
- Project Detail and the Projects list pick up the new figure automatically through the existing rollup.

## Rules

- Admin / org owner only, enforced in the database (not just hidden in the UI).
- Reason is mandatory; the update is rejected without one.
- Currency is not changed by this action — only the amount.
- Cancelled jobs cannot be edited.

## Technical notes

- New table `conversion_revenue_audit` (job id, organization_id, old_amount, new_amount, currency, reason, changed_by, changed_at) with GRANTs, RLS: select for finance/admin roles in the same org, insert only via the RPC.
- New RPC `admin_adjust_conversion_revenue(_conversion_id, _new_amount, _reason)`, `SECURITY DEFINER`, pinned `search_path`, `REVOKE EXECUTE FROM PUBLIC/anon`, granted to `authenticated`. It:
  1. asserts caller is admin/org_owner in the job's org, job not cancelled, reason length >= 10;
  2. updates `container_conversions.quoted_price`;
  3. inserts the audit row;
  4. if revenue transactions exist for the job, posts a balancing pair of `accounting_transactions` rows for the delta, tagged with the job's `project_id`, currency and locked `fx_rate`.
- Frontend: `src/components/conversions/EditConversionRevenueDialog.tsx` plus a gated button and history section in `src/pages/ConversionDetail.tsx`; gating via `useUserStaffRole().isOwnerOrAdmin`. React Query invalidation for the job, `project-pnl`, and `project-job-costs` keys.
