-- The two places a wakeful night had nowhere to go (docs/admin.md §11).
--
-- The original shape (20260803001431) argued that `sleep_latency` and
-- `awakenings` are BUCKETS because "a number is a guess at 7am", and it is
-- right — at the bottom of the scale. Nobody knows whether it was twelve
-- minutes or twenty. But the argument inverts at the top: **everybody knows
-- when it was three hours.** `over_60` carries a midpoint of 75, so a night
-- spent awake until 3am was estimated as an hour and a quarter, and the
-- efficiency came out ~25 points high — on the one number CBT-I actually moves.
--
-- The second gap was quieter and worse. Sleep efficiency is total sleep over
-- TIME IN BED, and time in bed ends when you get OUT of bed. `woke_at` was
-- doing both jobs, so the hour spent lying there at 5am was either erased from
-- the denominator or counted as sleep depending on which time you typed — and
-- the early-morning awakening is the classic signature this instrument exists
-- to catch. It was invisible either way.
--
-- Both columns are OPTIONAL and both stay null on an ordinary night. Nothing
-- here adds a required tap: an unfinished check-in is still a check-in.

alter table public.daily_checkins
  -- When you got OUT of bed. Time in bed is `bed_at → got_up_at`; the stretch
  -- between `woke_at` and here is awake-in-bed, which is in the denominator of
  -- efficiency and not in the numerator. Null means you got up when you woke,
  -- and every reader falls back to `woke_at` — which is exactly the behaviour
  -- every row written before today already had.
  add column got_up_at timestamptz,

  -- When you actually fell asleep, on the nights the bucket cannot say. A
  -- TIME, not a duration, because that is the form the memory takes: you
  -- remember "I finally went off around three", not "it took me 187 minutes" —
  -- and it reuses the native time picker already on the card twice rather than
  -- inventing a stepper for 7am. The latency is then `asleep_at − bed_at`,
  -- derived at render like everything else, with no ceiling at either end.
  add column asleep_at timestamptz;

-- `asleep_at` REFINES the top bucket; it does not replace the scale. Allowing
-- it beside `under_15` would create two sources of truth for the same quantity
-- and no rule for which wins. Same reasoning, and same shape, as
-- `daily_checkins_dream_details_need_a_dream`: the constraint lives here
-- because the form is not the only thing that will ever write this table.
alter table public.daily_checkins
  add constraint daily_checkins_asleep_at_needs_the_top_bucket
  check (asleep_at is null or sleep_latency = 'over_60');

comment on column public.daily_checkins.got_up_at is
  'When you got out of bed. Time in bed is bed_at → here; null falls back to woke_at.';
comment on column public.daily_checkins.asleep_at is
  'When you actually fell asleep. Only with sleep_latency = ''over_60'', where the bucket midpoint is a ceiling.';
