-- One answer per task per day, enforced by the database (plan 00 · Piece 2).
--
-- ⚠ THE GUARD ALREADY EXISTED AND WAS NOT A GUARANTEE. `tasks.dispose` reads
-- `task_events` for today and refuses if a row is there — and the comment above
-- it names the exact failure it is defending against:
--
--   "a double-tap on a slow connection writes two rows and advances the
--    schedule twice — silently, and by exactly the amount that makes a
--    fortnightly chore look monthly."
--
-- A read followed by a write is precisely the shape that fails under that
-- scenario: both requests read zero rows, both insert, and `advance()` runs
-- twice. The pre-check can only ever narrow the window, never close it.
--
-- ⚠ SO THE TWO ARE NOW A PAIR, AND NEITHER IS REDUNDANT. The pre-check is the
-- SENTENCE — "You've already answered for this one today." — because a unique
-- violation surfacing from Postgres is not something a person can read. This
-- index is the GUARANTEE. Deleting either one because the other exists is the
-- mistake this comment is here to prevent: without the index the guarantee is
-- gone, and without the pre-check the common case answers in SQLSTATE.
--
-- Safe to add: verified against live data on 2026-08-04 — `task_events` held
-- zero rows, and a duplicate scan (group by task_id, occurred_on having
-- count(*) > 1) returned nothing.
--
-- ⚠ NOT A PARTIAL INDEX, and `for_due_on` is deliberately NOT in the key. The
-- rule is one answer per DAY, not one answer per occurrence: ticking a task
-- early advances it, and a second tap the same day must be refused even though
-- the occurrence it would now be answering about has moved.
create unique index task_events_one_per_day
  on public.task_events (task_id, occurred_on);

comment on index public.task_events_one_per_day is
  'ADR-0013: one disposition per task per local day. The pre-check in tasks.dispose is the message; this is the guarantee.';
