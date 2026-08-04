-- HQ-native events, and the additive layer over anything on the calendar
-- (docs/plans/13-agenda.md §5 and §7; ADR-0012).
--
-- ⚠ A DATE AND A TIME, NOT A `timestamptz` — reversing the §7 sketch, settled
-- 2026-08-03, and for the same reason `tasks` and `interactions` reversed it
-- before this. The calendar's whole job is "what is my day", which is a LOCAL
-- DATE question, and `timestamptz` has no notion of a day: every reader would
-- redo a zone conversion, and that is precisely where the cross-midnight bug
-- class starts. A date-only event must not shift when you travel.
--
-- AND "ALL DAY" IS THE ABSENCE OF A TIME, not a boolean beside one. §7 sketches
-- `all_day boolean`, which makes `all_day = true` representable alongside a
-- meaningful `starts_at` — two columns that can contradict each other, with
-- nothing to say which is right. A null time cannot disagree with anything.
--
-- ⚠ NO RECURRENCE HERE, deliberately. §7 gives `events` none, `tasks` already
-- carries that machinery, and a standing weekly commitment can be a task until
-- the absence is actually felt. Adding a second recurrence implementation is
-- how two of them start disagreeing about what "every other Tuesday" means.
--
-- NOTE WHAT THIS TABLE IS NOT. It is not the Google mirror: that is
-- `external_events` (Piece 3), read-only and separate by design, because two
-- writable representations of one calendar is the problem shape ADR-0010 paid
-- to delete. HQ owns everything self-directed; Google owns events involving
-- other people.

create table public.events (
  id uuid primary key default gen_random_uuid(),

  title text not null check (length(btrim(title)) > 0),

  -- The local date it happens on. No default: `current_date` evaluates on a
  -- server whose clock is UTC, so an event created at 5pm in California would
  -- land tomorrow — silently, and only after 4pm.
  starts_on date not null,

  -- NULL = all day. The two times are wall-clock, like `tasks.due_time`.
  starts_at time,
  ends_at time,

  location text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An end with no beginning is not a time anybody can act on. There is
  -- deliberately NO check that `ends_at > starts_at`: an event that crosses
  -- midnight (a party, a flight) is a real thing, and refusing it would be the
  -- schema being confidently wrong about somebody's evening.
  constraint events_end_needs_a_start check (ends_at is null or starts_at is not null)
);

comment on table public.events is
  'HQ-native personal events. `starts_on` is a LOCAL date; a null `starts_at` means all day. Never the Google mirror — that is external_events.';

-- HQ's additive layer over anything on the calendar (§2). Tagging is the ONE
-- write HQ has against a mirrored row, and it is additive by construction, so
-- it can never create a conflict with Google.
create table public.event_people (
  -- Exactly one of these two. An HQ event points at a row; a mirrored one
  -- points at Google's id.
  event_id uuid references public.events(id) on delete cascade,

  -- ⚠ TEXT, AND DELIBERATELY NOT A FOREIGN KEY, even once `external_events`
  -- exists. §2's wrinkle 1: with `singleEvents=true` the mirror receives
  -- INSTANCES, whose ids are not stable — edit or reschedule the series in
  -- Google and a tag keyed on an instance id orphans silently. A tag attaches
  -- to the SERIES (`recurringEventId`) when there is one, which may not be a
  -- row in `external_events` at all. A foreign key here would force the wrong
  -- key on the right design.
  external_id text,

  person_id uuid not null references public.people(id) on delete cascade,

  created_at timestamptz not null default now(),

  constraint event_people_one_subject check (num_nonnulls(external_id, event_id) = 1)
);

comment on table public.event_people is
  'Who was there. Additive over both HQ events and the Google mirror — the one write HQ has against a mirrored row, and it cannot create a conflict.';

-- Not a primary key, because a composite key cannot contain a nullable column
-- and exactly one of the two subjects is always null. Two partial uniques say
-- the same thing and say it per subject.
create unique index event_people_event on public.event_people (event_id, person_id)
  where event_id is not null;
create unique index event_people_external on public.event_people (external_id, person_id)
  where external_id is not null;

-- The one read that is not "give me this event's people": the drift guard asks,
-- for everybody on the roster, whether they have an event today.
create index event_people_person on public.event_people (person_id);

-- The calendar always reads a date RANGE — a month grid is 42 days — so this is
-- the one index that earns itself on `events`.
create index events_starts_on on public.events (starts_on);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function extensions.moddatetime(updated_at);

alter table public.events enable row level security;
alter table public.event_people enable row level security;

-- The admin, and nobody else. NO `anon` POLICY OF ANY KIND — private by
-- omission (ADR-0012). `event_people` in particular says who Michael spends his
-- time with, which is the most detailed such record in the database.
create policy events_all_admin on public.events
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy event_people_all_admin on public.event_people
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.event_people to authenticated;
