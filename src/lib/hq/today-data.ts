// What Today and the tasks room ASK FOR, separated from what they decide
// (docs/plans/archive/00-groundwork.md · Piece 3).
//
// ⚠ WHY THIS IS NOT IN `today.ts`. That module holds the RULES — `announces`,
// `progressLabel`, `PAST_DUE_CAP` — and opens by promising **NO SUPABASE
// IMPORT**, as `tasks.ts` does. Both promises are load-bearing: `tasks.ts`
// reaches the browser through `task-sheet.ts`, and keeping the rule modules
// free of a client is what lets the editor and the server run the same
// functions. So the fetching lives here, one layer out, and imports them.
//
// The split to hold on to: **`today.ts` decides, `today-data.ts` gathers, the
// page renders.** Before this file existed the middle job was done in
// `admin/index.astro` — ~170 lines of it — which meant the most important page
// in the application had its data logic reachable only through Playwright.
//
// ⚠ AND THE TASK MERGE WAS WRITTEN TWICE. `admin/index.astro` and
// `admin/agenda/tasks.astro` each ran the same two queries and each built the
// same `Row` shape, comment for comment. `liveAndAnswered` is that merge, once
// — which is the rule `today.ts` states in its own header: *no zone invents its
// own answer.*
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '../database.types';
import { attention, checkinSettled, dueToday, type Attention } from './attention';
import { birthdayItem, eventItem, holidayItem, mirroredBetween, seenOn, type CalendarItem } from './calendar';
import { holidaysBetween } from './holidays';
import type { Checkin } from './checkin';
import { briefsFor, type Brief } from './brief';
import { driftList, type Drift } from './drift';
import { OBSERVATION_DAYS, observationFor, type Observation } from './goals';
import { lastContactMap } from './interactions';
import { PERSON_CARD_COLUMNS, signPhotos, upcomingBirthday, type PersonCard } from './people';
import { staleness, type Staleness } from './mirror';
import { announces, publishedSignal, type Signal } from './today';
import { shiftYmd, type Ymd } from './time';
import type { Outcome } from './tasks';

type DB = SupabaseClient<Database>;
type Task = Tables<'tasks'>;

/**
 * A task as a room shows it: the row, plus WHICH occurrence it is standing on
 * and whether that occurrence has already been answered for.
 *
 * `shownDueOn` is not always `due_on`. Answering a recurring task advances the
 * row's date immediately, so the only honest record of what you ticked is
 * `task_events.for_due_on` — which is why an answered row is rebuilt from the
 * event rather than from the task.
 */
export type TaskRow = Task & {
  answeredAs: Outcome | null;
  shownDueOn: string | null;
};

/**
 * Every task a room needs for `today`, in one shape — and every task appears
 * exactly once.
 *
 * TWO QUERIES, MERGED. The live list is everything unarchived; the second is
 * today's dispositions, and it carries the embedded task row rather than a
 * second lookup **because a one-off answered this morning is already archived**
 * and so is missing from the first query — while still having to stay on screen
 * until midnight (10-hq.md §10f).
 *
 * `answeredToday` is returned alongside because the zones want it keyed by id
 * on its own, and deriving it twice from `rows` is how the two fall out of step.
 *
 * ⚠ `error` IS RETURNED RATHER THAN THROWN, and the tasks room is why: it puts
 * "Couldn't load the list: …" above the page and carries on. A throw here would
 * turn a failed read into a 500 on a surface whose whole job is to still be
 * there on a bad morning. Today ignores it and renders empty zones, which is
 * the same answer that page gives to a quiet day.
 *
 * ⚠ `window` MAKES IT SERVE A GRID INSTEAD OF A LIST (plans/29 · §1), and it
 * changes two things rather than one — see the note on the dedupe below. It was
 * added because `/admin/agenda` had grown its own answer to this exact
 * question and got it wrong: a raw windowed `tasks` query beside an `answered`
 * set keyed by **task id**, which struck through the occurrence a tick had just
 * moved the row TO and dropped the one you actually ticked. The page was
 * rebuilding the loader only because no loader took a window.
 */
export async function liveAndAnswered(
  sb: DB,
  today: Ymd,
  window?: { from: Ymd; to: Ymd },
): Promise<{ rows: TaskRow[]; answeredToday: Map<string, Outcome>; error: PostgrestError | null }> {
  // The window has to be applied twice, in two different places, because the
  // two queries carry the date on different columns — `due_on` on the task,
  // `for_due_on` on the disposition — and that difference IS the reason this
  // function exists. Narrowing only the live query is the bug, one layer down.
  const liveQuery = sb.from('tasks').select('*').is('archived_at', null);
  const [{ data: live, error: liveErr }, { data: events, error: eventErr }] = await Promise.all([
    window ? liveQuery.gte('due_on', window.from).lte('due_on', window.to) : liveQuery,
    sb.from('task_events').select('for_due_on, outcome, tasks(*)').eq('occurred_on', today),
  ]);

  const dispositions = (events ?? []).filter((e): e is typeof e & { tasks: Task } => !!e.tasks);
  // An answer with no date, or one about a day off this grid, has no cell to
  // sit on. Backfilling last Friday while the calendar is on September is the
  // real case: the disposition happened today, the day it is ABOUT did not.
  const answered = window
    ? dispositions.filter((e) => !!e.for_due_on && e.for_due_on >= window.from && e.for_due_on <= window.to)
    : dispositions;
  const answeredIds = new Set(answered.map((e) => e.tasks.id));

  // ⚠ THE DEDUPE IS A LIST RULE, AND A GRID IS NOT A LIST. Unwindowed, this
  // answers *what do I owe*, so a task appears exactly once and the live row
  // loses to the disposition — otherwise every answered chore renders twice,
  // once ticked and once not. A window is asked by the CALENDAR, whose question
  // is *what is on this day*, and there the two rows are two different days:
  // the occurrence you ticked this morning, and the one the tick moved the task
  // to. Dropping the live twin there would empty next Friday's cell for the
  // rest of today — trading one half of §1's bug for the other, which is why
  // the alternative (filter the window, keep the list's dedupe) was rejected.
  const shownLive = window ? (live ?? []) : (live ?? []).filter((t) => !answeredIds.has(t.id));

  const rows: TaskRow[] = [
    ...shownLive.map((t) => ({ ...t, answeredAs: null, shownDueOn: t.due_on })),
    ...answered.map((e) => ({ ...e.tasks, answeredAs: e.outcome, shownDueOn: e.for_due_on })),
  ];

  return {
    rows,
    // ⚠ NEVER NARROWED BY THE WINDOW. This map means "answered today", full
    // stop — it is what the badge and Today's zones read, and a count that
    // changed because you had stepped the calendar to September would be the
    // same class of bug as the one this parameter fixes.
    answeredToday: new Map(dispositions.map((e) => [e.tasks.id, e.outcome])),
    error: liveErr ?? eventErr ?? null,
  };
}

/**
 * What the building is still waiting for — the badge's entire read (20 · §2).
 *
 * ⚠ IT COMPOSES `liveAndAnswered` RATHER THAN ASKING ITS OWN NARROWER QUESTION,
 * and that is the decision worth keeping. The obvious cheaper read is
 * `tasks where due_on = today and archived_at is null`, two columns, no second
 * query — and it gives the right answer today only because `dispose()` moves
 * `due_on` past today the instant you tick something. Counting the same rows the
 * rooms RENDER means the badge cannot drift from the list: if the two ever
 * disagree it is because `liveAndAnswered` changed, and then they change
 * together. It also picks up the one state the cheap read gets wrong — a
 * `dispose` whose event landed and whose `tasks` update then failed, which
 * leaves a row that reads answered on screen and unanswered in the column.
 *
 * ⚠ NEVER CALL THIS FOR A DATE OFF THE DATE BAR. The badge always means TODAY —
 * stepping back to backfill last Tuesday must not change the number in the
 * sidebar, and must not let that backfill decrement it. Same distinction
 * `admin/index.astro` already draws for the whole page: *only the check-in
 * follows the date bar.* Middleware is the only caller, and it passes the day it
 * resolved itself.
 *
 * A failed read degrades rather than throwing, like everything else here: no
 * rows means no tasks counted, and a check-in that could not be read counts as
 * unasked — which sends you to Today, where the real error is visible.
 */
export async function loadAttention(sb: DB, today: Ymd): Promise<Attention> {
  const [{ data: checkin }, tasks] = await Promise.all([
    sb.from('daily_checkins').select('*').eq('log_date', today).maybeSingle<Checkin>(),
    liveAndAnswered(sb, today),
  ]);
  return attention(checkinSettled(checkin), dueToday(tasks.rows, new Set(tasks.answeredToday.keys()), today));
}

/** A past-due row, as the zone renders it. */
export interface PastDueRow {
  id: string;
  title: string;
  dueOn: Ymd;
  priority: string;
  answeredAs: Outcome | null;
}

/** A goal with something worth observing — the ones with nothing are dropped. */
export interface GoalSignal {
  id: string;
  name: string;
  slug: string;
  observation: Observation;
}

/**
 * The one goal kept on the Morning card, and what it says to do.
 *
 * ⚠ THIS EXISTS BECAUSE PRACTICE COULD NOT CARRY IT. A goal reaches the Practice
 * zone only when `observationFor` has something to say, and a routine has no
 * tasks to tick — so the goal that most wants to be read every morning is the
 * one goal that zone will never show. Loosening that guard would have put a bare
 * navigation link in a zone whose rule is that everything in it is a signal you
 * read, so the routine goes where the morning already is instead.
 *
 * `notes` is raw Markdown: the card renders it, because rendering is a view's
 * job and this module returns data.
 */
export interface Routine {
  name: string;
  slug: string;
  notes: string | null;
}

/** Everything the five zones on Today render. */
export interface TodayData {
  dayItems: CalendarItem[];
  comingItems: CalendarItem[];
  pastDue: PastDueRow[];
  answeredToday: Map<string, Outcome>;
  briefs: Brief[];
  drifting: Drift[];
  peoplePhotos: Map<string, string>;
  published: Signal | null;
  goalSignals: GoalSignal[];
  routine: Routine | null;
  stale: Staleness | null;
}

/**
 * Today, gathered.
 *
 * ⚠ CALL THIS ONLY FOR TODAY ITSELF. Every zone it fills is a statement about
 * *now* — "past due", "been a while" and "last published" are all false on a
 * Tuesday last March — so the page calls it conditionally rather than this
 * function guarding internally. That is deliberate: the guard belongs where the
 * decision is (`admin/index.astro`'s `offToday`), and hiding it in here would
 * quietly turn "one query when you step off today" into "thirteen behind an
 * `if`", which is the optimisation the page's own header is proud of.
 */
export async function loadToday(sb: DB, today: Ymd): Promise<TodayData> {
  const since30 = shiftYmd(today, -OBSERVATION_DAYS);

  const [
    { data: eventRows },
    tasks,
    { data: everyone },
    lastContact,
    seenToday,
    briefs,
    { data: goalRows },
    { data: lastDone },
    { data: recentDone },
    { data: lastWriting },
    mirroredToday,
    { data: syncState },
  ] = await Promise.all([
    sb.from('events').select('*, event_people(person_id, people(id, display_name))').eq('starts_on', today),
    liveAndAnswered(sb, today),
    // ⚠ COLUMNS, NOT `*` (plans/30 · §6). This is the whole roster on every
    // Today render, and `*` carried `bio` — up to 20k characters per person —
    // to answer two questions that need eleven columns: is anyone drifting,
    // and is anyone's birthday near. The projection is named once, in
    // `people.ts`, so the query and the type cannot fall out of step.
    sb.from('people').select(PERSON_CARD_COLUMNS).is('archived_at', null),
    lastContactMap(sb),
    // GUARD 2 (12-people.md §8): anyone with an event today is never drifting.
    // Asked separately from the brief even though both read today's tags — the
    // brief drops archived people and caps at three, and a guard computed from
    // a capped list would silently stop guarding on a busy evening.
    seenOn(sb, today),
    briefsFor(sb, today),
    // `notes` and `pinned` ride along on a query that already runs: at a cap of
    // five active goals this is five short strings, not the `bio` problem the
    // roster above has. One query answers both the Practice signals and the
    // Morning card's routine, and a second `.eq('pinned', true)` round trip to
    // fetch a row already in this result would be a query bought with nothing.
    sb.from('goals').select('id, name, slug, notes, pinned').eq('status', 'active').order('created_at'),
    sb.from('goal_last_done').select('*'),
    sb.from('task_events').select('tasks!inner(goal_id)').eq('outcome', 'done').gte('occurred_on', since30),
    // ⚠ WRITING ONLY. `published_at` is stamped on every published essay and is
    // honest for them; only 1 of 73 quotes carries one, and every song's stamp
    // is the day the catalogue was imported. A "last published" over all three
    // would report an import as an act of writing.
    sb
      .from('fragments')
      .select('published_at')
      .eq('type', 'writing')
      .eq('status', 'published')
      .is('deleted_at', null)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(1),
    // 13 · Piece 3. Google's copy of today — a flight, a reservation, whatever
    // somebody else put there. It arrives read-only and joins the same union.
    mirroredBetween(sb, today, today),
    // `last_error_at` is read, not shown: `staleness()` needs it to tell a live
    // failure from one the mirror has since synced past.
    sb.from('calendar_sync').select('synced_at, last_error, last_error_at').maybeSingle(),
  ]);

  const roster: PersonCard[] = everyone ?? [];

  /* ── tasks: one query, three zones ─────────────────────────────────────── */
  const pastDue: PastDueRow[] = tasks.rows
    .filter((t) => t.shownDueOn && t.shownDueOn < today)
    .sort((a, b) => a.shownDueOn!.localeCompare(b.shownDueOn!) || a.title.localeCompare(b.title))
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueOn: t.shownDueOn as Ymd,
      priority: t.priority,
      answeredAs: t.answeredAs,
    }));

  const taskItem = (t: TaskRow): CalendarItem => ({
    kind: 'task',
    id: t.id,
    on: t.shownDueOn as Ymd,
    title: t.title,
    at: t.due_time ? t.due_time.slice(0, 5) : null,
  });

  /* ── birthdays: today's belong to the day, the rest to Coming up ─────────
     Derived from `birth_month`/`birth_day` (12-people.md §8), which is why one
     can never be ticked and why the only thing it offers is a door to the
     person. */
  const birthdays = roster
    .map((person) => ({ person, birthday: upcomingBirthday(person, today) }))
    .filter((x): x is { person: PersonCard; birthday: NonNullable<typeof x.birthday> } => !!x.birthday);

  // The door is set HERE rather than in `birthdayItem` because it is this
  // page's routing: the calendar renders the same birthdays and opens nothing.
  const withDoor = (person: PersonCard, on: Ymd): CalendarItem => ({
    ...birthdayItem(person, on),
    href: `/admin/people/${person.slug}`,
  });

  const dayItems: CalendarItem[] = [
    ...(eventRows ?? []).map((e) => ({ ...eventItem(e), href: `/admin/agenda?day=${e.starts_on}#day` })),
    ...mirroredToday,
    ...tasks.rows.filter((t) => t.shownDueOn === today).map(taskItem),
    ...birthdays.filter((b) => b.birthday.days === 0).map((b) => withDoor(b.person, today)),
    /* ⚠ ON THE DAY ONLY, AND DELIBERATELY NOT IN `comingItems` BELOW. Holidays
       are computed from rules (`holidays.ts`) and carry no lead, because Coming
       up is driven ENTIRELY by each item's own lead — see the warning on
       `announces` — and a holiday has no honest one to give it. Every candidate
       number (a week? a month? forty-five days for Christmas and three for
       Halloween?) is a dial, and this file's header says what it thinks of
       dials: *"the list is short because the leads are honest, so there is no
       knob to fiddle with."*

       So the ANSWER to "what is coming" stays where it already was — the
       calendar, where you flip to December and see Christmas sitting on the
       25th. Today says only what is true today. If a lead ever earns itself,
       the honest form is a per-holiday `lead` in the definition, not a global
       window bolted on here. */
    ...holidaysBetween(today, today).map((h) => holidayItem(h.holiday, h.on)),
  ];

  const comingItems: CalendarItem[] = [
    ...tasks.rows.filter((t) => !t.answeredAs && announces({ ...t, due_on: t.shownDueOn }, today)).map(taskItem),
    ...birthdays.filter((b) => b.birthday.days > 0).map((b) => withDoor(b.person, b.birthday.ymd)),
  ];

  /* ── people ─────────────────────────────────────────────────────────────── */
  const drifting = roster.length ? driftList(roster, lastContact, today, seenToday) : [];

  // One round trip for every face the zone can show, and no more: signing the
  // whole roster would mint URLs for people who are not on this page.
  const shown = [...briefs.map((b) => b.person), ...drifting.map((d) => d.person)];
  const peoplePhotos = shown.length
    ? await signPhotos(
        sb,
        shown.map((p) => p.photo_path),
      )
    : new Map<string, string>();

  /* ── practice ───────────────────────────────────────────────────────────── */
  const published = publishedSignal((lastWriting?.[0]?.published_at ?? null)?.slice(0, 10) as Ymd | null, today);

  const lastById = new Map((lastDone ?? []).map((r) => [r.goal_id, r.last_done_on]));
  const doneIn30 = new Map<string, number>();
  for (const row of recentDone ?? []) {
    const id = (row.tasks as { goal_id: string | null } | null)?.goal_id;
    if (id) doneIn30.set(id, (doneIn30.get(id) ?? 0) + 1);
  }
  // ⚠ THE FIELDS ARE NAMED, NOT SPREAD, and the compiler is why: the row now
  // carries `notes` and `pinned`, and `{ ...g }` widened this past the type
  // predicate below. Naming them is the better shape anyway — a Practice signal
  // is a name, a link and one line, and handing that zone a goal's whole routine
  // would be a payload it has no business being able to render.
  const goalSignals = (goalRows ?? [])
    .map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      observation: observationFor(doneIn30.get(g.id) ?? 0, lastById.get(g.id) ?? null, today),
    }))
    .filter((g): g is GoalSignal => !!g.observation);

  // ⚠ FOUND AMONG THE ACTIVE GOALS, which is what makes pausing one enough. A
  // paused goal should stop greeting you every morning, and the alternative —
  // clearing `pinned` when the status changes — would silently throw the pin
  // away, so re-activating would land you on a card that has forgotten. The pin
  // survives on the row; only the card goes quiet.
  const pinned = (goalRows ?? []).find((g) => g.pinned);
  const routine: Routine | null = pinned ? { name: pinned.name, slug: pinned.slug, notes: pinned.notes } : null;

  return {
    dayItems,
    comingItems,
    pastDue,
    answeredToday: tasks.answeredToday,
    briefs,
    drifting,
    peoplePhotos,
    published,
    goalSignals,
    routine,
    // ⚠ SILENCE WHILE IT IS WORKING (ADR-0014). Today is the page that would be
    // confidently wrong if the mirror went quietly stale, so it is one of the
    // two places that says so — and says nothing at all the rest of the time.
    stale: staleness(syncState ?? null),
  };
}
