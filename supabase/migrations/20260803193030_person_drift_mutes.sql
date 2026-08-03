-- Drift: counting the mutes (docs/plans/12-people.md §8, 12 · Piece 4).
--
-- `drift_muted_until` shipped with Piece 1 and carries "This is fine" — it
-- silences the notice for another cadence. What it cannot answer is HOW MANY
-- TIMES you have said that, because by the time you say it again the previous
-- value has already expired. §8 wants the answer:
--
--   "Repeated use of this on the same person is the signal to give them a
--    longer personal cadence, and the UI should offer that after the second
--    time."
--
-- ⚠ THE COLUMN LANDS NOW; THE OFFER DOES NOT. At a one-year cadence, muting
-- twice takes two years — so the branch that reads this cannot fire before
-- 2028, and building UI against a rule nothing can exercise is exactly what
-- the plans' own re-test rule warns off. But the COUNT has to start accruing
-- from the first mute or it starts at zero on the day it becomes useful.
-- Deciding to build the offer later is cheap; deciding to have counted from
-- the beginning is not.
--
-- Deliberately NOT a `person_drift_mutes` table with one row per dismissal.
-- The only question anyone will ever ask is "how many?", the answer is a small
-- integer, and a whole table would be a third private thing to keep correct in
-- the export, the backup and the RLS for a number that fits in a smallint.
alter table public.people
  add column drift_mutes smallint not null default 0
  check (drift_mutes >= 0);

comment on column public.people.drift_mutes is
  'How many times "This is fine" has been used. §8 wants a longer cadence offered after the second; the offer is not built yet, the count is.';
