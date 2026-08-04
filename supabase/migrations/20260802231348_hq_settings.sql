-- HQ's single-row settings table (docs/plans/11-checkin.md §2, ADR-0012).
--
-- It exists to answer one question that Postgres cannot answer on its own:
-- WHAT DAY IS IT? `timestamptz` has no notion of "today". Going to bed at 1am
-- and waking at 8am the same morning is one day, and which day that is depends
-- entirely on where you are standing.
--
-- Four properties, each of which was a decision:
--
--  1. AN IANA NAME, NOT AN OFFSET. `America/Los_Angeles`, never `-08:00`. DST
--     is then Postgres's problem and `Intl`'s problem rather than ours, and a
--     hard-coded offset is wrong for half of every year.
--  2. IN THE DATABASE, NOT IN ENV. Moving cities becomes one UPDATE rather than
--     a redeploy — and env vars are invisible to SQL, so a scheduled job and
--     the UI could not agree on the day without a round trip through the app.
--  3. NEVER THE BROWSER. Server-side work (the calendar sync, the nightly
--     backup) has no browser and must agree with what the screen says. A laptop
--     with a stale clock must not be able to move the day boundary either.
--  4. ONE ROW, ENFORCED BY THE PRIMARY KEY. `id boolean primary key check (id)`
--     admits exactly one value, so "which settings row?" is not a question any
--     query has to ask, and a second row is a constraint violation rather than
--     a silent fork.
--
-- It is deliberately not a key/value bag. Columns get types, defaults, checks
-- and a generated TypeScript type; `text` values keyed by `text` get none of
-- that, and the first typo becomes a silent null at the far end.
--
-- More columns arrive with the pieces that need them (the default birthday
-- lead, the "coming up" window, cadence defaults) — one per piece, not
-- speculatively now.
create table public.settings (
  id boolean primary key default true check (id),

  -- Validated in the app, not here: a CHECK cannot run the subquery against
  -- `pg_timezone_names` that would make this airtight, and `now() at time zone
  -- home_timezone` is not immutable enough for a constraint. src/lib/hq/time.ts
  -- refuses an unknown zone and falls back rather than throwing at 7am.
  home_timezone text not null default 'America/Los_Angeles',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.settings is
  'HQ''s single configured row. `home_timezone` is the one source of "today" — see src/lib/hq/time.ts.';

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function extensions.moddatetime(updated_at);

-- The row itself, so every read is a plain `select ... limit 1` and no surface
-- has to handle "configured or not" as a second state.
insert into public.settings (id) values (true) on conflict (id) do nothing;

alter table public.settings enable row level security;

-- The admin, and nobody else. NO `anon` POLICY OF ANY KIND — private by
-- omission, which is the whole HQ posture (ADR-0012) and the same pattern
-- `fragment_versions` uses. The home timezone is not a secret, but the table it
-- lives in is about to hold the rest of HQ's configuration, and the safe
-- default is set once at creation rather than tightened later.
create policy settings_all_admin on public.settings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.settings to authenticated;
