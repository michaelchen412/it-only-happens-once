-- Tasks and their dispositions (docs/plans/13-agenda.md §3, §3a, §4; ADR-0013).
--
-- ⚠ THIS IS THE SCHEMA-LEVEL ENFORCEMENT OF "ABSENCE NEVER ACCUMULATES"
-- (10-hq.md §3, ADR-0013). A recurrence is a RULE plus exactly ONE materialised
-- date. A row is written only when a task is DISPOSED OF. Forty-seven overdue
-- rows cannot be rendered on a bad morning because forty-seven rows were never
-- created — safety by construction, not by remembering a filter.
--
-- ── THREE READINGS OF §7's SKETCH ────────────────────────────────────────────
--
-- 1. ONE DATE COLUMN, NOT TWO. §7 sketches `due_on` AND `next_due_on`. Both
--    would be a bug farm: every read path would have to decide which one is
--    authoritative for a recurring task. `due_on` IS the current occurrence and
--    the disposition advances it — still exactly one materialised date, so
--    ADR-0013 holds unchanged.
--
-- 2. RECURRENCE AS COLUMNS, NOT `jsonb`. The CHECK below makes the invalid
--    state UNREPRESENTABLE: `fixed` must carry an rrule and no interval,
--    `after_completion` an interval and no rrule, a one-off neither.
--
-- 3. `task_events.for_due_on` — WHICH occurrence this disposed, alongside
--    `occurred_on`, the day you pressed the button. They differ routinely. It
--    is what makes undo exact rather than recomputed.
--
-- NO `goal_id` (Piece 2's table does not exist yet), NO `note` on task_events
-- (a one-tap disposition has nowhere to type), and no sub-tasks, dependencies,
-- tags, time-blocking, contexts or energy levels (§3).

create type public.task_priority   as enum ('low', 'normal', 'high');
create type public.task_effort     as enum ('quick', 'sitting', 'block', 'project');
create type public.task_outcome    as enum ('done', 'skipped');
create type public.recurrence_mode as enum ('after_completion', 'fixed');
create type public.recurrence_unit as enum ('days', 'weeks', 'months');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  title text not null check (length(btrim(title)) > 0),

  -- Optional, Markdown. The list never renders it; the sheet does.
  notes text,

  -- ⚠ A DATE AND A TIME, NOT A `timestamptz` (§3, settled 2026-08-01). A single
  -- timestamp silently gives every date-only task a midnight deadline that is
  -- wrong and then has to be hidden. Nullable time keeps "sometime that day" as
  -- an honest state — and a date-only task must not shift when you travel
  -- (11-checkin.md §2), which is exactly what a timestamptz would do.
  --
  -- NULL `due_on` is the Unscheduled list: a permanently valid state.
  due_on date,
  due_time time,

  -- PRIORITY IS PROMINENCE, EFFORT IS LEAD (§3a).
  priority public.task_priority not null default 'normal',
  effort   public.task_effort   not null default 'sitting',

  -- NULL = derive the lead from `effort` (quick 1 · sitting 3 · block 7 ·
  -- project 21, bumped one bucket by high priority). Set = an explicit
  -- override, which always wins.
  lead_days int check (lead_days is null or (lead_days between 0 and 365)),

  -- ── the recurrence RULE (§4) ───────────────────────────────────────────────
  --   `fixed`            an RRULE (RFC 5545) — the language Google speaks.
  --   `after_completion` a plain interval. Deliberately NOT an RRULE: "two
  --                      weeks after I actually did it" is not a calendar rule.
  --
  -- ⚠ THE RRULE IS ALWAYS GENERATED SERVER-SIDE from (preset, due_on) — see
  -- src/lib/hq/recurrence.ts. The client sends which preset it picked, never a
  -- rule string, so this column can only hold something the expander understands.
  recur_mode  public.recurrence_mode,
  recur_rrule text,
  recur_every int,
  recur_unit  public.recurrence_unit,

  -- Disposition archives a one-off task; a recurring task is never archived by
  -- disposition — its date simply advances.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A CASE on a NULL `recur_mode` falls to ELSE, which is the one-off row.
  constraint tasks_recurrence_shape check (
    case recur_mode
      when 'fixed' then
        recur_rrule is not null and recur_every is null and recur_unit is null
      when 'after_completion' then
        recur_every is not null and recur_unit is not null and recur_rrule is null
        and recur_every between 1 and 366
      else
        recur_rrule is null and recur_every is null and recur_unit is null
    end
  ),

  -- A recurrence with no date has nothing to advance FROM and nothing to
  -- surface: it would sit in Unscheduled for ever, quietly repeating nothing.
  constraint tasks_recurrence_needs_a_date check (recur_mode is null or due_on is not null),

  -- 4:30 on no particular day is not a time anybody can act on.
  constraint tasks_time_needs_a_date check (due_time is null or due_on is not null)
);

comment on table public.tasks is
  'Personal tasks. A recurrence is a RULE plus ONE materialised date (due_on), advanced on disposition — see ADR-0013.';

-- The disposition log (§4, ADR-0013 §2). BOTH outcomes are rows: a skip
-- inferred from silence would make the log lie, since a day the app was never
-- opened would be indistinguishable from a deliberate decision.
create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,

  -- The LOCAL date you disposed of it. No default: `current_date` evaluates on
  -- a server whose clock is UTC, so a task ticked at 5pm in California would be
  -- dated tomorrow — silently, and only after 4pm.
  occurred_on date not null,

  -- WHICH occurrence this disposed. NULL for an unscheduled task.
  for_due_on date,

  outcome public.task_outcome not null,

  created_at timestamptz not null default now()
);

comment on table public.task_events is
  'One row per disposition. occurred_on is the day you answered; for_due_on is the occurrence you answered ABOUT.';

create index task_events_occurred on public.task_events (occurred_on desc);
create index task_events_task on public.task_events (task_id, occurred_on desc);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function extensions.moddatetime(updated_at);

alter table public.tasks enable row level security;
alter table public.task_events enable row level security;

-- The admin, and nobody else. NO `anon` POLICY OF ANY KIND — private by
-- omission (ADR-0012).
create policy tasks_all_admin on public.tasks
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy task_events_all_admin on public.task_events
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_events to authenticated;
