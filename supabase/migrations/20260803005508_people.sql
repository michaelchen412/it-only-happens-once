-- People — the roster (docs/plans/12-people.md §9, ADR-0012).
--
-- HQ's second entity, and the first one that is about somebody other than
-- Michael. A person is FIRST-CLASS: own table, own room, own full page. Not a
-- tag over fragments, and not a filter — the roster exists whether or not a
-- single fragment or log entry ever points at a row in it.
--
-- ⚠ WHAT THIS TABLE IS DELIBERATELY NOT FOR. Michael's own norm, and a design
-- constraint rather than a habit: "I only write nice things about people and
-- have no business putting deeply personal or sensitive info about anyone."
-- That bound is load-bearing — it is what makes the nightly backup and the
-- widened /admin/export.json safe with no exclusion and no separate encryption.
-- It only stays true if it is defended HERE, so: no health field, no
-- "concerns", no conflict log, no ratings, no sentiment score. The free-form
-- columns are for warmth and continuity, and a later migration that adds their
-- opposite has broken something it cannot see.
--
-- NO `contacts` COLUMN, and its absence is a decision (§4). Phone and email
-- already live on his phone, backed up elsewhere. A second copy buys one saved
-- tap and guarantees it goes stale — and a stale number is worse than no
-- number, because you act on it.
--
-- WHY THE SHAPES ARE THE SHAPES (a later pass should not "simplify" these):
--
--  · `birth_month` + `birth_day` + NULLABLE `birth_year`, never a `date`. The
--    year is frequently unknown; the "next 30 days" question is a month/day
--    computation anyway (mind the December→January wrap); and a sentinel year
--    is the kind of thing that silently becomes somebody's age on a screen.
--  · `birthday_lead_days` DEFAULTS TO 30, not 7. "Happy birthday on time" for
--    the people who matter means weeks of warning, because choosing and
--    shipping a gift takes them. A week is enough to send a message and not
--    enough to do anything else.
--  · `cadence_days` DEFAULTS TO 365 AND APPLIES TO EVERYONE. Drift is on by
--    default (§8). A year is long enough that being told is a favour rather
--    than a scold; this would not be a defensible default at 30 days.
--  · `circle` IS ONE FIELD, NOT TWO. Relationship kind and closeness genuinely
--    are different axes, and at a 25-person roster splitting them is structure
--    that never gets used. There is no `acquaintances` value on purpose: it
--    would be the only bucket defined by neglect, and the honest way to handle
--    someone who has fallen out of your life is `archived_at`.
--  · `archived_at` IS SET EXPLICITLY, NEVER AUTOMATICALLY, however long the
--    silence. It removes someone from the roster and from search while keeping
--    every row — putting a photo in a drawer, not a judgement.
--
-- DERIVED AND NEVER STORED: `last_contact_at` (max `occurred_at` over the
-- `interaction_people` join, arriving with Piece 2). data-model.md §7's rule
-- applies exactly — a stored copy is a copy that can disagree with its own
-- inputs. Note also what it is derived FROM: interactions only. `updated_at` is
-- deliberately not part of it, because fixing a typo in someone's record is not
-- evidence you were in touch with them, and letting it silence a one-year
-- notice would defeat the feature by the most trivial possible action (§8).

create type public.person_circle as enum ('family', 'friends', 'professional');

create table public.people (
  id uuid primary key default gen_random_uuid(),

  -- The profile URL. Unique across the roster, archived rows included: an
  -- archived person keeps their address, so an old link still resolves.
  slug text not null unique,

  -- WHAT HE CALLS THEM, which is the name on the card and in every heading.
  -- `full_name` is the formal one when it differs and is never displayed in
  -- place of this; `sort_name` exists for the day alphabetical ordering is
  -- wanted and the display name is "Mum".
  display_name text not null check (length(btrim(display_name)) > 0),
  full_name text,
  sort_name text,

  circle public.person_circle not null default 'friends',

  -- The one hand-written line on the card: "college roommate, now in Seattle".
  -- What makes a roster feel like people instead of a contacts app. Not a bio —
  -- that is `bio`, and it is clamped to two lines when rendered.
  epithet text,

  -- Markdown. The standing description: what he'd say if someone asked "tell me
  -- about Kevin". Changes maybe twice a year.
  bio text,

  -- Object path in the PRIVATE `hq` bucket — NOT a URL, because the only URLs
  -- this bucket has are signed and they expire. Sign at request time; never
  -- persist or cache a signed URL (§7).
  photo_path text,

  birth_month smallint check (birth_month between 1 and 12),
  birth_day smallint check (birth_day between 1 and 31),
  birth_year smallint check (birth_year between 1850 and 2200),

  birthday_lead_days int not null default 30 check (birthday_lead_days between 0 and 365),

  -- A YEAR is enough (settled 2026-08-01). No date + precision pair: nobody
  -- knows the day they met someone, and "2013 · 13 years" is the whole fact.
  known_since_year smallint check (known_since_year between 1850 and 2200),

  location text,

  cadence_days int not null default 365 check (cadence_days between 1 and 3650),

  -- "This is fine" — mutes the drift notice for another year. Some
  -- relationships genuinely are annual; a mentor seen once a year is not
  -- drifting, he is a mentor seen once a year.
  drift_muted_until date,

  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.people is
  'HQ''s roster (~25 people, 50 ceiling). Private by omission — no anon policy. `last_contact_at` is derived from interactions, never stored.';

-- A month without a day is not a birthday, and a day without a month is not
-- anything. They travel together or not at all.
alter table public.people
  add constraint people_birthday_is_a_pair
  check ((birth_month is null) = (birth_day is null));

-- A lone year renders nowhere: `nextOccurrence()` keys on month and day, so a
-- year on its own would be a fact the interface can never show and nobody would
-- know it had been swallowed.
alter table public.people
  add constraint people_birth_year_needs_the_day
  check (birth_year is null or birth_month is not null);

-- 31 April is not a date. The column check above only bounds the day at 31,
-- which would happily accept it — and a birthday nobody can have is a birthday
-- that never fires. February takes 29 because a leap-day birthday is real;
-- `nextOccurrence()` falls it back to 1 March in common years.
alter table public.people
  add constraint people_birthday_exists
  check (
    birth_month is null
    or birth_day <= case birth_month
      when 2 then 29
      when 4 then 30
      when 6 then 30
      when 9 then 30
      when 11 then 30
      else 31
    end
  );

-- NO INDEXES BEYOND THE PRIMARY KEY AND THE UNIQUE SLUG, deliberately. The
-- roster's ceiling is 50 rows (§3) and every query here reads all of them —
-- Postgres will sequential-scan a table this size whatever we build, and an
-- unused index is a thing that has to be maintained and explained. Add one when
-- there is a plan showing it used, not before.

create trigger people_set_updated_at
  before update on public.people
  for each row execute function extensions.moddatetime(updated_at);

alter table public.people enable row level security;

-- The admin, and nobody else. NO `anon` POLICY OF ANY KIND — private by
-- omission (ADR-0012), the same posture as `settings` and `daily_checkins`.
-- This table holds other people's information, which raises the stakes past
-- every other private table: the strongest available default, set at creation
-- rather than tightened later.
create policy people_all_admin on public.people
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.people to authenticated;
