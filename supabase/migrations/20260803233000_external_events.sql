-- The Google mirror (docs/plans/13-agenda.md §2 and §7; ADR-0014).
--
-- ⚠ THIS TABLE IS NEVER WRITTEN BY HAND. It is one direction only: Google owns
-- these rows, HQ copies them, and nothing in the app edits one. The additive
-- layer — who was there — lives in `event_people`, which already carries an
-- `external_id` half for exactly this and is deliberately NOT a foreign key
-- into here (see that table's own comment, and wrinkle 1 below).
--
-- ⚠ A DATE AND TIMES, NOT A `timestamptz` — the FOURTH time this workstream has
-- reversed §7's sketch, after `interactions`, `tasks` and `events`. Four is a
-- pattern, not four decisions: every consumer of this table asks a LOCAL DATE
-- question, because the calendar's whole job is "what is my day".
--
-- It is a sharper reversal here than it was there, because the source really is
-- an instant. Two facts settle it anyway:
--
--   · Google gives all-day events NO instant at all (`start.date`, a bare
--     date). Storing those as `timestamptz` means inventing a time, which is
--     precisely the `all_day boolean` mess §7 sketched and the others deleted.
--   · The grid counts days in the HOME zone. An event at 11pm New York is on
--     the previous day in California, so a mirror that stored instants would
--     make every reader redo the same conversion and get it wrong once.
--
-- ⚠ THE CONSEQUENCE, STATED SO IT IS NOT A SURPRISE: the local columns are
-- derived from `settings.home_timezone` AT INGEST. Change the home zone and the
-- mirror is wrong until it is resynced — which is why the sync exposes a full
-- resync rather than only reaching one on a `410 GONE`.

create table public.external_events (
  id uuid primary key default gen_random_uuid(),

  -- Google's id for this INSTANCE (`abc123_20260731T170000Z` for one occurrence
  -- of a series). Unique because it is what upsert keys on.
  external_id text not null unique,

  -- ⚠ WHAT A PERSON-TAG ATTACHES TO — `recurringEventId` when there is one,
  -- otherwise the event's own id (§2, wrinkle 1, settled 2026-08-01). An
  -- instance id is not a stable key: reschedule the series in Google and every
  -- annotation keyed on an instance orphans silently. A recurring personal
  -- event is a STANDING ARRANGEMENT — weekly climbing with Joon has Joon in it
  -- every time — so the series is the honest subject.
  --
  -- If occurrence-level tagging ever earns itself, the safe key is already
  -- known and is still not the instance id: Google's docs say
  -- `originalStartTime` "uniquely identifies an instance within its series,
  -- even if the instance has been rescheduled".
  series_id text not null,

  title text,

  -- Local, in the home zone. NULL `starts_at` means all day, exactly as in
  -- `events` — there is no boolean here that could contradict it.
  starts_on date not null,
  starts_at time,

  -- ⚠ MULTI-DAY IS NOT HYPOTHETICAL. Two of the nine real events on the live
  -- calendar are hotel stays: "Stay at Hyatt Grand Central" runs 29–31 August.
  -- Google's all-day `end.date` is EXCLUSIVE; the ingest subtracts a day so
  -- this column means the last day the thing actually covers.
  -- NULL = it ends on the day it starts.
  ends_on date,
  ends_at time,

  location text,

  -- `htmlLink`. It is the row's whole affordance: a mirrored event's one door
  -- is Google itself, which is a better explanation of "not yours to change"
  -- than any label could be (10-hq.md §10i).
  url text,

  -- Google's `eventType`: `default`, `fromGmail`, `birthday`, … Kept because it
  -- is what the birthday filter keys on, and because it turns out to describe
  -- what this mirror actually carries — on the live calendar, nine of the
  -- seventeen real events are `fromGmail` (flights, hotels, reservations).
  event_type text,

  -- ⚠ MARKED, NEVER DELETED (ADR-0014). Annotations reference `external_id`;
  -- deleting the row would strand or cascade them away, and an event that
  -- silently disappears from a day you have annotated is worse than one that
  -- says it was cancelled.
  cancelled boolean not null default false,

  synced_at timestamptz not null default now(),

  -- An end time with no start is not a time anybody can act on. As in `events`,
  -- there is NO check that the end is after the start: a flight that crosses
  -- midnight is a real thing, and — more to the point here — the mirror must
  -- never refuse what Google says. A constraint violation would abort a whole
  -- sync over one row.
  constraint external_events_end_needs_a_start check (ends_at is null or starts_at is not null)
);

comment on table public.external_events is
  'The read-only Google mirror (ADR-0014). Never written by hand. `starts_on` is a LOCAL date in settings.home_timezone, derived at ingest; a null starts_at means all day. Tags attach to series_id, not external_id.';

-- The calendar always reads a date RANGE, and a multi-day row has to be found
-- by any day it covers — so both ends are indexed.
create index external_events_starts_on on public.external_events (starts_on);
create index external_events_ends_on on public.external_events (ends_on) where ends_on is not null;
create index external_events_series on public.external_events (series_id);

-- ── the cursor ──────────────────────────────────────────────────────────────
-- A singleton, the same shape as `settings`, so every read is a plain
-- `select … limit 1` and no surface has to handle "configured or not".
--
-- It is a SEPARATE table from `settings` on purpose: `settings` is
-- configuration a person chooses, this is machine state a sync writes. Putting
-- a cursor in the row that defines "today" would mean a background write
-- touching the one row everything else derives its day from.
create table public.calendar_sync (
  id boolean primary key default true check (id),

  -- Google's incremental cursor. NULL means "next sync must be a full one".
  -- ⚠ `timeMin`/`timeMax` cannot be sent alongside a syncToken, so the window
  -- of the FIRST full sync is fixed for the life of this token.
  sync_token text,

  -- When the mirror last successfully reached Google. ADR-0014 names staleness
  -- as this decision's new silent failure mode and requires this be visible
  -- somewhere — Today and the Agenda room say so when it goes stale.
  synced_at timestamptz,

  -- The last failure, kept rather than logged: a sync that has been failing for
  -- three days must be able to say so on the page, and a log nobody reads is
  -- how a mirror goes quietly wrong.
  last_error text,
  last_error_at timestamptz,

  updated_at timestamptz not null default now()
);

comment on table public.calendar_sync is
  'One row. The Google Calendar incremental cursor and the mirror''s health — machine state, kept out of `settings`, which is configuration.';

create trigger calendar_sync_set_updated_at
  before update on public.calendar_sync
  for each row execute function extensions.moddatetime(updated_at);

insert into public.calendar_sync (id) values (true) on conflict (id) do nothing;

alter table public.external_events enable row level security;
alter table public.calendar_sync enable row level security;

-- The admin, and nobody else. NO `anon` POLICY OF ANY KIND — private by
-- omission (ADR-0012). This table names restaurants, flights and hotels by
-- address and date, which is a movement history.
create policy external_events_all_admin on public.external_events
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy calendar_sync_all_admin on public.calendar_sync
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.external_events to authenticated;
grant select, insert, update, delete on public.calendar_sync to authenticated;
