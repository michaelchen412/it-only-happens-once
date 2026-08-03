-- Interactions — the log (docs/plans/12-people.md §6 and §9, ADR-0012).
--
-- This is the piece that makes the roster pay for itself. Piece 1 stored facts
-- and gave nothing back, which is exactly how every personal CRM dies: logging
-- is work and the payoff is years away, so by March the database is empty. The
-- defence is that logging pays out AT THE MOMENT OF USE — you open a profile
-- before seeing someone and read what you last knew, in your own words.
--
-- ⚠ AN INTERACTION HAS PARTICIPANTS, NOT AN OWNER. One dinner with three
-- friends is ONE row appearing on three profiles. A `person_id` column here
-- would force writing it three times or losing two of the three records — and
-- it would quietly destroy the group dimension, which comes free from the join:
-- who you actually see together, and who you only ever see through somebody
-- else.
--
-- ⚠ `occurred_on` IS A DATE, NOT A TIMESTAMPTZ — reversing the §9 sketch,
-- settled 2026-08-03. Every consumer asks a LOCAL DATE question: "3 weeks ago"
-- on the card, `now - last_contact > cadence_days` for drift, "Last contact"
-- in the brief. A `timestamptz` would make every one of those readers redo a
-- zone conversion, which is the exact shape of the cross-midnight bug class the
-- check-in had to be careful about. `localToday()` (src/lib/hq/time.ts) is
-- already the single source of "what day is it", so the column simply stores
-- what that returns.
--
-- AND IT HAS NO DEFAULT, deliberately. `default current_date` would evaluate on
-- the SERVER, whose clock is UTC — so an entry logged at 5pm in California
-- would be dated tomorrow, silently, and only after 4pm. The action always
-- supplies the value through the configured home zone. A column with no default
-- is a column nobody can get wrong by forgetting.
--
-- NO `title` COLUMN, though §9 sketches one. The log box has no title field and
-- must not grow one: §6's whole argument is that logging has to cost fifteen
-- seconds, and a title is a second decision before you have written the first
-- word. Same reasoning that kept `full_name` out of the add sheet in Piece 1 —
-- a column nothing can write is a column that reads as an oversight later.
--
-- NO `location` COLUMN (§6, settled 2026-08-01). Where you were is either
-- irrelevant or it is part of the story, and if it is part of the story it
-- belongs in the words. A structured field would be empty on most rows and
-- would invite filtering by something nobody filters by.

create type public.interaction_kind as enum ('hangout', 'call', 'message', 'gift', 'shared', 'note');

create table public.interactions (
  id uuid primary key default gen_random_uuid(),

  -- The LOCAL date it happened. See the note above: no default, on purpose.
  occurred_on date not null,

  kind public.interaction_kind not null default 'hangout',

  -- Markdown, and required. An entry with no words is not an entry — it is a
  -- row that will mean nothing to you in three years, which is precisely the
  -- span this table exists to survive. The log box enforces the same rule by
  -- refusing to offer Save until something is typed.
  body text not null check (length(btrim(body)) > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.interactions is
  'One logged contact. Participants live in interaction_people — an interaction has no owner. `occurred_on` is a LOCAL date; see src/lib/hq/time.ts.';

create table public.interaction_people (
  interaction_id uuid not null references public.interactions(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  primary key (interaction_id, person_id)
);

comment on table public.interaction_people is
  'Many-to-many: one dinner with three friends is one interaction on three profiles.';

-- The primary key indexes (interaction_id, person_id), which serves
-- "who was at this?" and cannot serve "what did I do with this person?" — the
-- direction BOTH consumers actually read: the profile timeline and the
-- last-contact rollup. This one earns itself, unlike anything on `people`.
create index interaction_people_person on public.interaction_people (person_id);

create trigger interactions_set_updated_at
  before update on public.interactions
  for each row execute function extensions.moddatetime(updated_at);

alter table public.interactions enable row level security;
alter table public.interaction_people enable row level security;

-- The admin, and nobody else. NO `anon` POLICY OF ANY KIND — private by
-- omission (ADR-0012), the same posture as `people`, `settings` and
-- `daily_checkins`. These rows are the most detailed record of other people's
-- lives in the database, and the strongest available default is set here at
-- creation rather than tightened later.
create policy interactions_all_admin on public.interactions
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy interaction_people_all_admin on public.interaction_people
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.interactions to authenticated;
grant select, insert, update, delete on public.interaction_people to authenticated;

-- ── last contact: DERIVED, never stored ─────────────────────────────────────
--
-- data-model.md §7's rule applies exactly: a stored copy is a copy that can
-- disagree with its own inputs, and this one would drift every time an entry
-- was edited, deleted, or backdated. A view cannot drift.
--
-- ⚠ `security_invoker = true` IS LOAD-BEARING AND MUST NOT BE REMOVED. A
-- Postgres view runs with its OWNER's privileges by default, so without this
-- the view would read `interactions` as the owner and hand the results to
-- whoever queried it — bypassing the RLS above and turning the one derived
-- surface into the leak that every policy on this page exists to prevent.
-- With it, the view sees exactly what the caller may see: for `anon`, nothing.
--
-- Note what it is derived FROM: interactions only. `people.updated_at` is
-- deliberately not part of it (§8) — fixing a typo in somebody's record is not
-- evidence you were in touch with them, and letting it silence a one-year
-- notice would defeat the feature by the most trivial possible action.
create view public.person_last_contact
  with (security_invoker = true) as
select
  ip.person_id,
  max(i.occurred_on) as last_contact_on,
  count(*)::int as interaction_count
from public.interaction_people ip
join public.interactions i on i.id = ip.interaction_id
group by ip.person_id;

comment on view public.person_last_contact is
  'DERIVED, never stored. security_invoker=true so RLS on the base tables still applies.';

grant select on public.person_last_contact to authenticated;
