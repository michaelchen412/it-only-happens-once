-- One goal can sit on the Morning card (Michael, 2026-08-11).
--
-- `notes` gave a goal somewhere to say how it is kept; this is how the one that
-- matters at 6am gets in front of you without being hunted for. The path that
-- already existed went Today → Practice → the goal, and it does not work for
-- exactly the goal that asked for notes: **Practice drops any goal with nothing
-- to observe**, and a routine has no tasks to tick, so it would have stayed
-- invisible there for ever. Fixing that by loosening the observation guard
-- would have put a bare navigation link in a zone whose rule is that everything
-- in it is a signal you read. So the routine goes where the morning already is.
--
-- ⚠ ONE SLOT, AND IT IS STRUCTURAL. The Morning card is the first thing on
-- Today and its own comment insists it is *not a wall* — on a bad morning you
-- must be able to reach the day in one tap. Two routines competing for the top
-- of it is exactly the bloat that rule exists to refuse, so "at most one" is a
-- partial unique index rather than a habit.
--
-- ⚠ AND NOTE THIS DOES NOT CONTRADICT THE FIVE-ACTIVE CAP LIVING IN THE ACTION.
-- That cap is a RULE THE PERSON HITS, and it has to arrive as a sentence, which
-- a constraint cannot speak. This is a CONSISTENCY INVARIANT the person never
-- hits: pinning clears the previous pin first, so the slot is vacated before it
-- is filled and the index has nothing to refuse. It is here to make a second
-- pinned row unrepresentable, not to argue with anybody.
alter table public.goals add column pinned boolean not null default false;

comment on column public.goals.pinned is
  'The one goal whose notes sit on the Morning card. At most one row is true — see goals_one_pinned.';

-- `(pinned) where pinned` indexes the single value `true` across every pinned
-- row, so uniqueness is exactly "at most one". Unpinned rows are not indexed at
-- all, which is why this is not a check constraint and not a trigger.
create unique index goals_one_pinned on public.goals (pinned) where pinned;
