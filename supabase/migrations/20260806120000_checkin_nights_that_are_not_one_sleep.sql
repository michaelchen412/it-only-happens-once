-- The night stops being one sleep, and the dream stops being one dream.
--
-- Two gaps, and they are the SAME GAP the `over_60` fix closed on 2026-08-05
-- (20260805180500) — a bucket is honest at the bottom of its scale and a lie at
-- the top. That migration said it plainly: nobody knows whether it was twelve
-- minutes or twenty, but **everybody knows when it was three hours.**
--
--  1. `awakenings` never got the same treatment. `many` carries a midpoint of
--     30 minutes, so the night that goes bed 23:00 → three hours asleep → THREE
--     HOURS AWAKE at 02:30 → two more → woke 07:30, up 07:45 derived ≈7h 15m
--     asleep at 83%. The truth is 4h 45m at 54%. Twenty-nine points, on the one
--     number CBT-I actually moves — larger than the bug already fixed, in the
--     same place, for the same reason.
--
--     And it was worse than a wrong number. CBT-I stimulus control TELLS YOU TO
--     GET OUT OF BED when you cannot sleep. Doing as instructed left the whole
--     excursion inside the efficiency denominator, so obeying the protocol
--     looked identical to lying awake ignoring it.
--
--  2. `dream_recall` was one enum on the row, so a night with an anxious dream
--     AND a distressing one collapsed to whichever was tapped last, under a
--     single intensity spanning both. Michael, 2026-08-06: *"it's important to
--     know if I have multiple types of dreams and, for each one, the severity."*
--
-- ⚠ THE FOUR DREAM VALUES ARE UNCHANGED. 20260803001431 warned that re-shaping
-- collected categorical data is the expensive migration, and it is right — so
-- this one does not touch the taxonomy. The values stop being MUTUALLY
-- EXCLUSIVE, which is a change to the cardinality of the answer and not to its
-- vocabulary. Every tone ever recorded still means exactly what it meant.
--
-- The timing is the other half of that argument: `daily_checkins` was created
-- 2026-08-03 and this lands 2026-08-06. Four rows of history is the cheapest
-- this change will ever be, and it gets more expensive every morning.

-- ── one row per TONE, not per dream ────────────────────────────────────────
--
-- The primary key IS the decision. Michael, asked whether two anxious dreams in
-- one night need to be separately recordable: *"no need for separately
-- recordable for now — enough to summarize by the average of that type."* So a
-- night holds at most one row per tone, `(checkin_id, tone)` is the key, and the
-- write path is idempotent by construction: no surrogate id to churn, no
-- ordinal to keep in sync with a list that reorders, and re-saving the same form
-- twice cannot produce a duplicate.
--
-- The tone reuses `dream_recall` rather than declaring a second enum over the
-- same three words. `none` is excluded because it is not a tone — it is the
-- ANSWER "nothing", and that lives on the parent (`dreamless`) where it belongs:
-- a dreamless night is one fact about the night, not a member of a set of
-- dreams.
create table public.checkin_dreams (
  checkin_id uuid not null references public.daily_checkins (id) on delete cascade,
  tone public.dream_recall not null check (tone <> 'none'),
  intensity smallint check (intensity between 1 and 5),

  -- WHETHER IT WOKE YOU IS THE CLINICAL LINE between an anxiety dream and a
  -- nightmare, and plan 11 opened by naming exactly that uncertainty — *"anxiety
  -- dreams most nights, not quite nightmares."* Until this column existed the
  -- data could not answer the question the instrument was built around.
  woke_you boolean not null default false,

  -- Recurrence is what a therapist asks about, and one tap is the whole cost.
  recurring boolean not null default false,

  primary key (checkin_id, tone)
);

comment on table public.checkin_dreams is
  'One row per dream TONE per night — not per dream. Two of a kind are summarised into one row.';

-- ── the night, in pieces ───────────────────────────────────────────────────
--
-- A TIMED WAKING REFINES THE BUCKET; it does not replace the scale. Exactly the
-- shape `asleep_at` has under `over_60`: the buckets below stay right, and the
-- one that cannot answer its own question gets to be asked again. Both columns
-- are nullable because the card saves as you go and a half-typed waking must be
-- allowed to sit there — the arithmetic ignores anything incomplete rather than
-- guessing at it.
--
-- `left_bed` IS NOT DECORATION. It moves the excursion out of the efficiency
-- DENOMINATOR, which is the difference between "followed the protocol" and
-- "lay there for three hours" — two nights that scored identically until today.
create table public.checkin_wakings (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.daily_checkins (id) on delete cascade,

  woke_at timestamptz,
  back_asleep_at timestamptz,
  left_bed boolean not null default false,

  -- Only orders the two when both are there; a half-filled row is legal.
  constraint checkin_wakings_forward
    check (woke_at is null or back_asleep_at is null or back_asleep_at > woke_at)
);

create index checkin_wakings_by_night on public.checkin_wakings (checkin_id, woke_at);

comment on table public.checkin_wakings is
  'Timed wakings inside one night. Refines the `awakenings` bucket; `left_bed` leaves the efficiency denominator.';

-- ── naps ───────────────────────────────────────────────────────────────────
--
-- 20260803001431 excluded caffeine, alcohol, exercise, naps and screen time
-- together, on the argument that the agenda workstream would supply behavioural
-- context for free. THAT ARGUMENT DOES NOT COVER NAPS, and grouping them with
-- the correlates was the mistake: a nap is not a thing that correlates with
-- sleep, **it is sleep.** It breaks the 24-hour total, and an unrecorded one is
-- precisely what defeats sleep restriction — the calendar will never know.
--
-- A nap belongs to the LOG DATE, which is the date you woke up on: a Tuesday
-- afternoon nap is on Tuesday's row. That works only because the row was never
-- a form — it is upserted all day, so an afternoon can reach a morning's record
-- without anything being reopened or resubmitted.
create table public.checkin_naps (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.daily_checkins (id) on delete cascade,

  started_at timestamptz,
  ended_at timestamptz,

  constraint checkin_naps_forward
    check (started_at is null or ended_at is null or ended_at > started_at)
);

create index checkin_naps_by_day on public.checkin_naps (checkin_id, started_at);

comment on table public.checkin_naps is
  'Daytime sleep on the log date. Never in the night''s efficiency — it is a separate window.';

-- ── what you took, and whether you dreamt at all ───────────────────────────
--
-- ⚠ THIS ENUM IS THE EXPENSIVE PART OF THIS MIGRATION — the one place it does
-- create a taxonomy rather than reuse one. Said out loud before it collects
-- months of rows, and confirmed as drawn by Michael on 2026-08-06: today it is
-- one line to change, and it never will be again.
--
-- Alcohol is in the list deliberately. It is not a medication, but the Consensus
-- Sleep Diary counts what was taken TO HELP YOU SLEEP including alcohol, and as
-- a confounder of latency and of 3am wakings it outweighs most of the others.
create type public.sleep_aid as enum (
  'melatonin',
  'antihistamine',
  'prescription',
  'cannabis',
  'alcohol',
  'other'
);

alter table public.daily_checkins
  -- NULL is unanswered; `'{}'` is "nothing tonight" and is a real answer, given
  -- by a real tap. The same rule as `skipped`: recorded, never inferred. An
  -- empty set read as "took nothing" would silently invent the control group
  -- that every correlation over this column depends on.
  add column sleep_aids public.sleep_aid[],

  -- "Nothing" — the dream answer that has no tone. Tri-state on purpose:
  -- null unanswered, true nothing recalled, false dreamt (see checkin_dreams).
  --
  -- `false` IS redundant with a non-empty child table, and that is a considered
  -- exception to "nothing derived is ever stored". It buys the one thing the
  -- child table cannot: `hasAnswers()` and the sidebar's attention badge stay a
  -- single-row read. The badge runs in middleware on every request, and the
  -- dream question is the FIRST thing on the card — so "tapped Anxious and
  -- nothing else" is the likeliest half-finished state there is, and it must
  -- not read as an untouched day. Both are written by the same save, so they
  -- cannot drift apart between requests.
  add column dreamless boolean;

comment on column public.daily_checkins.sleep_aids is
  'What was taken to help sleep. NULL unanswered; ''{}'' is an answered "nothing".';
comment on column public.daily_checkins.dreamless is
  'null unanswered · true nothing recalled · false dreamt, tones in checkin_dreams.';

-- ── moving the old dream columns into the new shape ────────────────────────
--
-- Every existing tone becomes its row; every `none` becomes `dreamless`. Order
-- matters: the CHECK below cannot be dropped until nothing depends on it, and
-- the columns cannot be dropped until their contents have been read out.
insert into public.checkin_dreams (checkin_id, tone, intensity)
select id, dream_recall, dream_intensity
  from public.daily_checkins
 where dream_recall is not null
   and dream_recall <> 'none';

update public.daily_checkins
   set dreamless = (dream_recall = 'none')
 where dream_recall is not null;

alter table public.daily_checkins
  drop constraint daily_checkins_dream_details_need_a_dream,
  drop column dream_recall,
  drop column dream_intensity;

-- The surviving half of that constraint, restated over the column that replaced
-- its subject. `dream_body` is the shared prose for the whole night's dreaming,
-- so it hangs off "did you dream at all" rather than off any one tone — and it
-- still cannot outlive the answer that there was nothing to describe.
alter table public.daily_checkins
  add constraint daily_checkins_dream_body_needs_a_dream
  check (dream_body is null or dreamless is not true);

-- ── the boundary, unchanged ────────────────────────────────────────────────
--
-- The admin and nobody else, with NO `anon` policy of any kind — private by
-- omission (ADR-0012), the same posture the parent table has. These three carry
-- what is arguably the most personal data in the database, and a child table is
-- exactly where a permissive default goes unnoticed.
alter table public.checkin_dreams enable row level security;
alter table public.checkin_wakings enable row level security;
alter table public.checkin_naps enable row level security;

create policy checkin_dreams_all_admin on public.checkin_dreams
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy checkin_wakings_all_admin on public.checkin_wakings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy checkin_naps_all_admin on public.checkin_naps
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.checkin_dreams to authenticated;
grant select, insert, update, delete on public.checkin_wakings to authenticated;
grant select, insert, update, delete on public.checkin_naps to authenticated;
