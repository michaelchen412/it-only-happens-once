-- Goals — intentions, not projects (docs/plans/13-agenda.md §4a).
--
-- ⚠ A GOAL IS A DIRECTION, NOT A SCOPED DELIVERABLE. *Get back in shape. Finish
-- the Sky. Be a better friend to the people I've drifted from.* That framing is
-- the whole reason this table can exist without turning a personal task list
-- into project management, which is where they die — and it is enforced by what
-- is ABSENT here as much as by what is present:
--
--   NO `progress`, NO `percent_complete`, NO `target_count`, NO subtask count.
--   A goal is not 60% done. That is both false and a guilt engine (ADR-0013).
--   Anything a later migration adds here that could be rendered as a bar has
--   broken something it cannot see.
--
--   NO `due_on`, NO `target_date`. The moment a goal has a deadline it is a
--   task, and `tasks` is one table over. `horizon` is an ENUM of three vague
--   values precisely so a date cannot be typed into it — the rule made
--   structural rather than left to discipline (Michael's call, 2026-08-03).
--
--   NO `sort`, though the §7 sketch has one. Nothing would write it: at a cap
--   of five there is no reorder UI to build, and a column nothing can write is
--   a column somebody later reads as broken. Same reasoning that kept `title`
--   off `interactions` and `note` off `task_events`.
--
-- THE CAP OF FIVE ACTIVE GOALS IS ENFORCED IN THE ACTION, NOT HERE. A partial
-- unique index cannot express "at most five", and a trigger that refused the
-- sixth would fail at the database, where the error cannot be a sentence. §4a
-- caps goals harder than `vision.md` caps constellations (7–12) because they
-- are about attention, and attention is scarcer than taxonomy.

create type public.goal_status  as enum ('active', 'paused', 'achieved', 'let_go');
create type public.goal_horizon as enum ('this_season', 'this_year', 'next_few_years');

create table public.goals (
  id uuid primary key default gen_random_uuid(),

  name text not null check (length(btrim(name)) > 0),

  -- Minted once from the name and never re-minted, like `people`: a goal being
  -- renamed is ordinary, and a rename must not move its page.
  slug text not null unique,

  -- Markdown: what this is actually for, in prose. The one place a goal is
  -- allowed to be long.
  why text,

  horizon public.goal_horizon not null default 'this_year',

  -- ⚠ `let_go` IS A FIRST-CLASS STATUS, beside active/paused/achieved.
  -- Abandoning a goal should be a dignified act you take, not a row you delete
  -- or a thing that rots in a list (§4a).
  status public.goal_status not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.goals is
  'An intention, not a project. No completion, by design — see docs/adr/0013 and 13-agenda.md §4a.';

-- ⚠ ON DELETE SET NULL, NEVER CASCADE. Letting a goal go — or deleting one
-- outright — must not delete the tasks that were done toward it. What you
-- actually did stays done; only the intention it was filed under goes.
alter table public.tasks
  add column goal_id uuid references public.goals(id) on delete set null;

comment on column public.tasks.goal_id is
  'Optional. A task with a goal and no date is not a graveyard item — it is part of something you care about, not scheduled yet.';

-- No index on `goals`, and none on `tasks.goal_id`. Five active rows and a
-- personal task list are both small enough that Postgres will sequential-scan
-- whatever we build, and an unused index is a thing to maintain and explain.

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function extensions.moddatetime(updated_at);

alter table public.goals enable row level security;

create policy goals_all_admin on public.goals
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.goals to authenticated;

-- ── the observation: DERIVED, never stored ──────────────────────────────────
--
-- §4a's argument for why a goal is more than a folder: for each one, an honest
-- observation over the last 30 days — "4 tasks done" / "nothing in 6 weeks".
-- It answers "am I actually spending time on what I said mattered?", which is
-- the HQ correlation thesis and something no to-do app will tell you.
--
-- ⚠ NOTE WHAT THIS VIEW DELIBERATELY DOES NOT COMPUTE: the 30-day count. That
-- needs a window, a window needs a date, and `current_date` here would evaluate
-- on a server whose clock is UTC — the exact trap `interactions.occurred_on`
-- has no default for. The boundary is computed by `localToday()` in the app and
-- passed as a filter, so the count is asked in the zone the day is lived in.
-- What a view CAN answer without a date is the part that has no window at all.
--
-- ⚠ `security_invoker = true` IS LOAD-BEARING, exactly as on
-- `person_last_contact`: without it the view would read `task_events` as its
-- owner and hand the results to whoever asked, bypassing the policy above.
create view public.goal_last_done
  with (security_invoker = true) as
select
  t.goal_id,
  max(e.occurred_on) as last_done_on,
  count(*)::int as done_total
from public.task_events e
join public.tasks t on t.id = e.task_id
where e.outcome = 'done' and t.goal_id is not null
group by t.goal_id;

comment on view public.goal_last_done is
  'DERIVED. The half of a goal observation that needs no window; the 30-day count is asked with a locally-computed boundary. security_invoker=true so RLS still applies.';

grant select on public.goal_last_done to authenticated;
