-- Goals get NOTES — the practice, beside the reason (Michael, 2026-08-10).
--
-- `why` answers *what is this actually for*, and for the goal that prompted the
-- column — **wake up and get moving**, against the weight of an anxiety dream —
-- the why turned out to be half of it. The other half is operational, and it is
-- the half you actually reach for at 6am: *what is in the routine.* Teeth. Read
-- the day. Move, before the head starts. That is neither a reason nor a task;
-- it is a page of notes about how an intention is kept, and until now the only
-- place to put it was a task list it does not belong in.
--
-- ⚠ THIS IS NOT A SUBTASK LIST, AND NOTHING CAN TURN IT INTO ONE. The rule this
-- table was founded on stands: nothing here may be rendered as a bar. A `text`
-- column cannot be ticked, counted, scheduled or scored — the same argument
-- that keeps `progress` and `due_on` off this table, applied to the field that
-- looks most like a way around them. **The Markdown pipeline closes the last
-- inch**: `- [ ]` renders as a plain bullet, because `sanitize-html` drops the
-- `<input>` that `marked` emits, so even a checklist typed in on purpose comes
-- back unstruck and untickable. Nothing reads these notes but your eyes. If a
-- line in here wants ticking it wants to be a task, and `tasks` is one table
-- over — with `goal_id` already pointing back here.
--
-- Named `notes` to match `tasks.notes`: same shape, same promise, and a second
-- word for the same thing is how two fields start drifting apart. The pile at
-- /admin/notes is a different noun and always was.
alter table public.goals add column notes text;

comment on column public.goals.notes is
  'Markdown: how the intention is actually kept. Prose, never a checklist — see this migration and docs/adr/0013.';
