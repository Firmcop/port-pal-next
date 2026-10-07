# Fix split-job completion failure

## Confirmed cause

For `CNV-NOCUST-0005`, the job is still `in_progress`, has two planned 10-ft outputs, and has no generated child containers, confirming that the failed completion rolled back atomically.

The completion call path is:

```text
ConversionDetail → complete_conversion(job id)
  → create split child containers
  → apply_split_output_allocation(job id)
  → DELETE FROM _split_kids
  → database safety guard rejects DELETE without WHERE
  → entire completion transaction rolls back
```

The offending statement is the unqualified cleanup of the function’s temporary `_split_kids` table. It is not deleting business data, but it still violates the database-wide safe-delete rule.

## Changes

1. **Correct temporary-table cleanup**
   - Replace the unqualified `DELETE FROM _split_kids` in `apply_split_output_allocation()` with `TRUNCATE TABLE _split_kids`.
   - Preserve the current size-weighted cost allocation, child acquisition costs, mother-container status update, and completion audit logic unchanged.

2. **Apply through a database migration**
   - Redefine only `apply_split_output_allocation()` with the safe cleanup statement.
   - Keep its security-definer settings, organization scoping, validation, and return contract unchanged.

3. **Add failure-friendly UI messaging**
   - Map this completion failure and the existing split validation codes to clear messages instead of exposing raw database errors.
   - Keep the completion action retryable after a failed transaction.

4. **Regression verification**
   - Execute completion for `CNV-NOCUST-0005` after the migration.
   - Confirm exactly two child containers are created, the mother container becomes `converted`, the job becomes `completed`, and output costs equal the full mother/job cost without duplication.
   - Retry the completion RPC and confirm it refuses with `already_completed` rather than creating duplicate children.
   - Confirm non-split product and sub-assembly completion paths remain unchanged.

## Technical notes

- Database: `public.apply_split_output_allocation(uuid, text)` only.
- Frontend: focused error mapping in `src/pages/ConversionDetail.tsx` if the existing toast currently renders raw backend messages.
- No cleanup of partial child records is required for this incident because the transaction rollback left zero children.
