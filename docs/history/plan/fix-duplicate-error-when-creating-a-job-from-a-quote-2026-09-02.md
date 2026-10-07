# Fix "duplicate" error when creating a job from a quote

## What is actually happening

Quote QTE-MT2SBB7I (Evans Okemwa, KES 540,000) has **no** conversion job attached — confirmed, there are zero rows in `container_conversions` for that quote. The "duplicate" message is not about the quote at all; it is a database unique-key violation on the job number.

The job number is built by `next_conversion_number(org, customer)`, which keeps a counter per (organization, customer slug) in `conversion_number_sequences`. Four counter rows were written against the legacy organization instead of the live one:

```text
slug        counter row org                                   real job that exists
EVANS       00000000-0000-0000-0000-000000000001  last_seq 1  CNV-EVANS-0001     (org 6b29b65b…)
PETER       00000000-…-000000000001               last_seq 1  CNV-PETER-0001     (org 6b29b65b…)
EVERFLORA   00000000-…-000000000001               last_seq 1  CNV-EVERFLORA-0001 (org 6b29b65b…)
ENG         00000000-…-000000000001               last_seq 1  CNV-ENG-0001       (org 6b29b65b…)
```

So when a new Evans job is created under the live org, no counter exists for that org, the counter starts at 1 again, and the generated number `CNV-EVANS-0001` collides with the existing job — `container_conversions_conversion_number_key` is unique across all organizations, so the insert is rejected as a duplicate.

## Fix

1. **Make numbering collision-proof.** Rewrite `next_conversion_number` so that after bumping the counter it also takes into account the highest number already in use for that slug (across the whole table, since the unique index is global), and retries until it produces a free number. A new Evans job then becomes `CNV-EVANS-0002`.
2. **Repair the four stray counter rows** so the live organization owns them with the correct `last_seq` (matching the highest existing job per slug), and drop the legacy-org duplicates.
3. **Show a readable message instead of "duplicate".** In `src/lib/quote-conversion.ts` / `src/pages/QuoteDetail.tsx`, map a unique-violation on `conversion_number` to "Could not allocate a job number, please retry" rather than surfacing the raw Postgres error — the current text wrongly suggests the quote was already converted.

After the migration, converting QTE-MT2SBB7I creates a normal job (no containers on this quote, so it becomes a fabrication-type job carrying the KES 540,000 quoted price).

## Technical notes

- Migration: `CREATE OR REPLACE FUNCTION public.next_conversion_number` with a loop of at most ~50 attempts, `SECURITY DEFINER`, `SET search_path = public`; plus a data patch of `conversion_number_sequences` seeding each slug's counter from `max(substring(conversion_number from '\d+$')::int)`.
- No schema changes, no new tables, so no new grants or RLS needed.
- Frontend change is error-message mapping only; the existing idempotency guard on `quote_id` stays as is.
