# Fix operating expense submission ambiguity

## Confirmed cause
- The database currently exposes two `post_operating_expense` functions with the same parameter names but a different order for `payment_mode` and `lines`.
- The expense form sends named fields matching both functions, so the database cannot choose one and rejects the submission before any expense is saved.
- `dennisraymond714@gmail.com` is an active administrator in the organization, so this is not an access or role problem.

## Implementation
1. Remove the obsolete legacy function signature and retain the newer expense-posting function that supports both full accounting users and limited expense-entry users.
2. Reapply explicit execution permissions so only signed-in users can invoke the retained function.
3. Keep the current form payload and approval behavior unchanged; no expense amounts, accounts, or existing records will be altered.
4. Add a regression check confirming only one callable signature remains and that the exact named payload used by the expense form resolves successfully.
5. Verify both “Save as draft” and “Submit for approval” using Dennis’s signed-in role, and confirm the created expense and audit trail are stored once.

## Technical details
- Database-only corrective migration; no visual changes.
- The retained function is `post_operating_expense(date, jsonb, text, uuid, text, uuid, date, text, numeric, uuid, uuid, text, text, text, boolean)`.
- The removed overload is `post_operating_expense(date, text, jsonb, uuid, text, uuid, date, text, numeric, uuid, uuid, text, text, text, boolean)`.
