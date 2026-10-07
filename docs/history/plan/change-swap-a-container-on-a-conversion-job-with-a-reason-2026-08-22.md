# Change (swap) a container on a conversion job, with a reason

Today a job's containers can only be attached, and only non-primary containers show a Detach button. There is no way to replace a wrong container — including the primary one — and no record of why it changed.

## What you'll be able to do

- On a job's container list, every attached container gets a **Change** action (admin/owner and staff with job edit rights).
- The dialog lets you pick the replacement container, carry over or edit the purchase price and transport/offloading cost, and requires a **reason** (minimum 10 characters).
- Swapping is atomic: the old container returns to Available, the new one moves to In Conversion, costs move with the link, and the job's primary container reference is updated when the primary is the one being swapped.
- A **Container change history** section on the job shows old container, new container, reason, who changed it and when.
- Detach also asks for a reason and is allowed for the primary container as long as the job is still editable.

## Rules

- Allowed while the job is in Planning or In progress.
- For Completed jobs, only admin/owner may swap, and the reason is mandatory — costs already posted are re-pointed to the new container rather than re-posted.
- The replacement must be a container in the same organization, not already attached to this job, and not sold / on lease / booked for repatriation.
- Cancelled jobs cannot be changed.

## Technical notes

Database migration:
- New table `public.conversion_container_audit` (conversion_id, organization_id, old_container_id, new_container_id, action `swap|detach`, old_costs, new_costs, reason, changed_by, changed_at) with org-scoped RLS + GRANTs, mirroring `conversion_revenue_audit`.
- New RPC `swap_conversion_container(_conversion_id, _link_id, _new_container_id, _reason, _container_cost, _transport_offloading_cost)`, SECURITY DEFINER, `search_path = public`: validates reason length, job status (admin override for `completed` via `has_role`), container eligibility; updates the `conversion_containers` row in place (preserving `role`), mirrors to `container_conversions.container_id/container_cost/transport_offloading_cost` when the row is primary, flips both container statuses, and inserts the audit row.
- Extend `detach_container_from_conversion` with a `_reason text` argument (defaulted so existing callers keep working) that writes the same audit row, and drop the primary-only restriction.

Frontend (`src/pages/ConversionDetail.tsx`):
- `LinkedContainersCard`: add **Change** per row; existing Detach gains a reason prompt and is no longer hidden for `role = 'primary'`.
- New `ChangeContainerDialog` (same shape as `AttachContainerDialog`): container select, purchase price, transport cost, reason textarea, submit disabled until a container and a valid reason are supplied.
- New `ContainerChangeHistory` list fed by a `conversion-container-audit` query, invalidated together with the existing job queries.

Note: the current Detach button calls `detach_container_from_conversion` with `_conversion_id` / `_container_id`, but the function's only parameter is `_link_id` — so detach fails today. This will be corrected as part of the work.
