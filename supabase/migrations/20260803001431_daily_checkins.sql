-- The morning check-in (docs/plans/11-checkin.md §3 and §6, ADR-0012).
--
-- ONE ROW PER LOCAL DATE, UPSERTED. This is not a form that gets submitted: the
-- phone captures times and ratings at 7am and the desktop appends the longer
-- dream text at 9am, and both are the same row. "Have I done today's?" is a
-- property of THE DATE, not of a session or a device — which is why `log_date`
-- is unique and why every other column is nullable.
--
-- `log_date` IS THE LOCAL DATE YOU WOKE UP ON, computed through
-- `localToday()` over the configured home timezone (src/lib/hq/time.ts). Going
-- to bed at 1am on the 31st and waking at 8am the same morning is ONE record,
-- keyed to the 31st. Postgres has no notion of "today", so this column is the
-- only thing that does — do not derive it from `created_at`.
--
-- `bed_at` AND `woke_at` ARE FULL TIMESTAMPS, not times, and that is the whole
-- reason the cross-midnight case is unambiguous rather than inferred: 23:35 →
-- 06:25 spans two calendar dates, and a `time` column would leave every reader
-- guessing which. The instants are computed from the wall-clock times in the
-- configured zone.
--
-- WHY THE SHAPES ARE THE SHAPES (§3 — a later pass should not "simplify" these):
--
--  · `sleep_latency` and `awakenings` are BUCKETS, not numbers. A number is a
--    guess at 7am; a bucket is honest and just as useful for a trend. Nobody
--    knows how many times they woke.
--  · `sleep_quality` and `restedness` ARE TWO FIELDS ON PURPOSE. Eight solid
--    hours that still leave you wrung out is the signature of the thing being
--    investigated, and one "how did you sleep" score erases it. DO NOT MERGE.
--  · `valence` and `arousal` are TWO AXES, not one mood score. A single scale
--    cannot tell "calm but hollow" from "wired and afraid", and those call for
--    different responses on the morning they happen.
--  · `skipped` IS RECORDED, NEVER INFERRED. A missing row means nothing was
--    said; `skipped = true` means "not today", which is real data and a real
--    answer. Nothing counts either, and nothing ever will: absence never
--    accumulates, so there are no streaks here to break.
--
-- Deliberately absent from v1: caffeine, alcohol, exercise, naps, screen time.
-- They are the classic correlates, but each is another tap every morning, and
-- the agenda workstream is meant to supply behavioural context for free. Do not
-- add them by hand until that has been tried and found wanting.
--
-- Derived and NEVER stored: time in bed, estimated sleep, sleep efficiency.
-- They are computed from the columns above (src/lib/hq/checkin.ts) so they can
-- never disagree with their own inputs.

-- ⚠ The taxonomy is the expensive part to change. Re-shaping months of
-- collected categorical data is miserable in a way that re-labelling a 1–5
-- scale is not. These four values ship as drawn and settled 2026-08-01; if a
-- therapist ever wants a different shape, that is a migration and it should be
-- agreed knowing this.
create type public.dream_recall as enum ('none', 'neutral', 'anxious', 'distressing');

-- Minutes to fall asleep, and how broken the night was.
create type public.sleep_latency as enum ('under_15', '15_30', '30_60', 'over_60');
create type public.awakenings as enum ('none', 'few', 'many');

create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),

  -- The LOCAL date you woke up on. Unique: one row per day, always.
  log_date date not null unique,

  -- Full timestamps, because the night crosses midnight.
  bed_at timestamptz,
  woke_at timestamptz,

  sleep_latency public.sleep_latency,
  awakenings public.awakenings,
  sleep_quality smallint check (sleep_quality between 1 and 5),
  restedness smallint check (restedness between 1 and 5),

  -- 1 unpleasant ↔ 5 pleasant, and 1 calm ↔ 5 activated.
  valence smallint check (valence between 1 and 5),
  arousal smallint check (arousal between 1 and 5),

  dream_recall public.dream_recall,
  dream_intensity smallint check (dream_intensity between 1 and 5),
  dream_body text, -- Markdown, optional, and the one field that summons a keyboard
  note text,

  -- An explicit tap, never an inference about a day nobody opened.
  skipped boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.daily_checkins is
  'One upserted row per local wake date. `log_date` is the local date — see src/lib/hq/time.ts.';

-- Intensity and the dream text only mean anything once a dream was recalled.
-- Enforced here rather than trusted to the form, because the form is not the
-- only thing that will ever write this table.
alter table public.daily_checkins
  add constraint daily_checkins_dream_details_need_a_dream
  check (
    dream_recall is distinct from 'none'
    or (dream_intensity is null and dream_body is null)
  );

-- The prefill query ("the median of the last ~14 rows") and the trend view both
-- read newest-first. The unique constraint's index is on `log_date` ascending;
-- Postgres can walk it backwards, so this is the only index needed.
create index daily_checkins_recent on public.daily_checkins (log_date desc);

create trigger daily_checkins_set_updated_at
  before update on public.daily_checkins
  for each row execute function extensions.moddatetime(updated_at);

alter table public.daily_checkins enable row level security;

-- The admin, and nobody else. NO `anon` POLICY OF ANY KIND — private by
-- omission (ADR-0012), the same posture as `fragment_versions`. This is the
-- most personal table in the database and the one whose privacy is least
-- negotiable, so it gets the strongest available default rather than a
-- predicate someone could later widen.
create policy daily_checkins_all_admin on public.daily_checkins
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.daily_checkins to authenticated;
