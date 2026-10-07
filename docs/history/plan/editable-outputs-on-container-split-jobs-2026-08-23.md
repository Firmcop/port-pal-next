# Editable outputs on container split jobs

Today a split job's "Planned outputs" table only supports adding a row, deleting a row that has produced nothing yet, and fixing a missing height class. The child containers created on completion cannot be touched at all. This adds full edit/delete on both, with an audit trail and an admin-only path after completion.

## Planned outputs (before completion)

- Each row gets an **Edit** action opening a dialog with size, category, height class, planned count, target owner and notes.
- Validation: count 1-50, height class required for dry, cannot reduce planned count below the number of children already created for that spec.
- **Delete** stays available while no child exists for that spec; when children exist the row can only be edited (count reduced to the created amount) rather than removed.
- Inline confirmation before delete instead of the current one-click bin.

## Created child containers

- Each child container card on the Outputs tab gets an **Edit** and a **Remove** action, admin-only.
- Edit changes size, category, height class and notes on the container record.
- Remove is only allowed when the container is still depot-owned, `available`, not on a lease/sale/other conversion; otherwise the action explains why it is blocked.
- Both actions require a typed reason.

## After completion

- Planned rows and child containers stay editable for admins on completed jobs, always with a reason.
- Non-admins keep the current behaviour: nothing editable once the job is completed or cancelled.

## Audit trail

- Every planned-row and child-container change writes a row (job, output, action, before/after values, reason, actor) that is shown in a collapsible "Change history" section under the Planned outputs card and inside each child container card's existing audit trail area.

## Technical notes

- New table `conversion_output_audit` (org-scoped, RLS + grants, insert via the RPCs only) or reuse of the existing `conversion_container_audit` shape.
- New security-definer RPCs, all reason-required and admin-gated when the job is completed:
  - `update_conversion_output(_id, _size, _category, _height_class, _planned_count, _target_owner, _notes, _reason)`
  - `delete_conversion_output(_id, _reason)`
  - `update_conversion_child_container(_container_id, _size, _category, _height_class, _notes, _reason)`
  - `remove_conversion_child_container(_container_id, _reason)` — guards on status/ownership/links, unlinks `parent_container_id` and marks the unit removed rather than hard-deleting when history exists.
- Frontend changes confined to `src/components/conversions/ConversionExtras.tsx` (`PlannedOutputsEditor`, `OutputsTab`, `OutputCard`): edit dialogs, reason inputs, admin gating via the existing permission hook, and query invalidation of `conversion-outputs`, `child-containers` and `conversion-output-costs`.
