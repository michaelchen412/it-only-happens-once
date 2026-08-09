// The merge Today and the tasks room both run (plans/00-groundwork.md · Piece 3).
//
// Until 2026-08-04 this logic existed twice — once in `admin/index.astro` and
// once in `admin/agenda/tasks.astro` — which meant it had no tests at all,
// because neither copy was reachable from anything but a browser. These are the
// first assertions ever made about it.
//
// What is being pinned down is the rule that makes a recurring task behave:
// **an answered task is rebuilt from its disposition, not from its row.**
// Answering advances `tasks.due_on` immediately, so the row no longer knows
// which occurrence you ticked — only `task_events.for_due_on` does.
import { describe, expect, it } from 'vitest';
import { liveAndAnswered } from '../lib/hq/today-data';
import { fakeDb } from './stubs/supabase';
import { task } from './stubs/task';

const TODAY = '2026-08-04';

describe('liveAndAnswered', () => {
  it('returns unanswered live tasks standing on their own due date', async () => {
    const t = task({ id: 'a', title: 'Water the plants', due_on: TODAY });
    const { rows, answeredToday } = await liveAndAnswered(fakeDb({ tasks: { data: [t] } }), TODAY);

    expect(rows).toHaveLength(1);
    expect(rows[0].shownDueOn).toBe(TODAY);
    expect(rows[0].answeredAs).toBeNull();
    expect(answeredToday.size).toBe(0);
  });

  it('shows an answered task at the occurrence it was answered FOR, not where the row now sits', async () => {
    // The heart of it. A weekly chore ticked this morning has already had its
    // date advanced to the 11th — but it must stay on today's list, struck
    // through, until midnight (10-hq.md §10f). Reading `due_on` would put it a
    // week in the future and it would vanish from the page you just used.
    const advanced = task({ id: 'a', title: 'Bins out', due_on: '2026-08-11' });
    const db = fakeDb({
      tasks: { data: [advanced] },
      task_events: { data: [{ for_due_on: TODAY, outcome: 'done', tasks: advanced }] },
    });

    const { rows, answeredToday } = await liveAndAnswered(db, TODAY);

    expect(rows).toHaveLength(1);
    expect(rows[0].shownDueOn).toBe(TODAY);
    expect(rows[0].answeredAs).toBe('done');
    expect(answeredToday.get('a')).toBe('done');
  });

  it('never lists a task twice when it is both live and answered', async () => {
    // A recurring task appears in BOTH queries by construction. The live copy
    // has to lose, or every answered chore renders once ticked and once not.
    const t = task({ id: 'a', due_on: '2026-08-11' });
    const db = fakeDb({
      tasks: { data: [t] },
      task_events: { data: [{ for_due_on: TODAY, outcome: 'skipped', tasks: t }] },
    });

    const { rows } = await liveAndAnswered(db, TODAY);

    expect(rows).toHaveLength(1);
    expect(rows[0].answeredAs).toBe('skipped');
  });

  it('keeps a one-off answered this morning, which the live query can no longer return', async () => {
    // `dispose` archives a one-off, so it is absent from `tasks`. The embedded
    // row in the disposition is the only thing keeping it on screen until
    // midnight — the reason that query embeds `tasks(*)` at all.
    const archived = task({ id: 'a', title: 'Renew passport', archived_at: '2026-08-04T09:00:00Z' });
    const db = fakeDb({
      tasks: { data: [] },
      task_events: { data: [{ for_due_on: TODAY, outcome: 'done', tasks: archived }] },
    });

    const { rows } = await liveAndAnswered(db, TODAY);

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Renew passport');
    expect(rows[0].answeredAs).toBe('done');
  });

  it('drops a disposition whose task is gone rather than rendering a hole', async () => {
    const db = fakeDb({
      tasks: { data: [] },
      task_events: { data: [{ for_due_on: TODAY, outcome: 'done', tasks: null }] },
    });

    const { rows, answeredToday } = await liveAndAnswered(db, TODAY);

    expect(rows).toEqual([]);
    expect(answeredToday.size).toBe(0);
  });

  it('reports a failed read instead of throwing — the room says so and stays up', async () => {
    const db = fakeDb({ tasks: { error: { message: 'connection refused' } } });

    const { rows, error } = await liveAndAnswered(db, TODAY);

    expect(error?.message).toBe('connection refused');
    expect(rows).toEqual([]);
  });

  it('carries an unscheduled task through with no date', async () => {
    const { rows } = await liveAndAnswered(fakeDb({ tasks: { data: [task({ due_on: null })] } }), TODAY);
    expect(rows[0].shownDueOn).toBeNull();
  });
});

// The windowed form — what the CALENDAR asks for (plans/29 · §1).
//
// ⚠ THESE EXIST BECAUSE `/admin/agenda` HAD ITS OWN ANSWER AND IT WAS WRONG.
// The page ran a raw windowed `tasks` query beside an `answered` set keyed by
// **task id**, so a recurring chore ticked this morning struck through its NEXT
// occurrence — `dispose` advances `due_on` before the page ever renders — and
// today's cell, the one you had just used, went empty. A one-off vanished
// outright, archived by the same call. That is the "which occurrence is this
// task standing on" drift ADR 0016 says the loader layer exists to prevent, and
// the page was rebuilding the loader only because no loader took a window.
//
// ⚠ WHAT THE STUB CANNOT PROVE, said plainly: it fakes the BUILDER, so the
// `.gte`/`.lte` narrowing the live query is not exercised here. What is
// exercised is the half the bug was made of — which date each row is placed on,
// and which dispositions belong to the window at all.
describe('liveAndAnswered, windowed', () => {
  const AUGUST = { from: '2026-08-01', to: '2026-08-31' };

  it('places an answered task on the day it was answered FOR, not where the answer moved it', async () => {
    // The bug, stated as an assertion. Ticked today; `due_on` is already the
    // 11th. Today's cell must carry the struck row.
    const advanced = task({ id: 'a', title: 'Bins out', due_on: '2026-08-11' });
    const db = fakeDb({
      tasks: { data: [advanced] },
      task_events: { data: [{ for_due_on: TODAY, outcome: 'done', tasks: advanced }] },
    });

    const { rows } = await liveAndAnswered(db, TODAY, AUGUST);

    const answered = rows.filter((r) => r.answeredAs);
    expect(answered).toHaveLength(1);
    expect(answered[0].shownDueOn).toBe(TODAY);
    expect(answered[0].answeredAs).toBe('done');
  });

  it('keeps the occurrence the answer moved the task to, because a grid draws days not tasks', async () => {
    // ⚠ THE ONE PLACE THE WINDOWED FORM DELIBERATELY DIVERGES from the list
    // form, and the reason the parameter changes the dedupe rule rather than
    // only the filter. Dropping the live twin — correct for a list, which shows
    // each task once — would empty the 11th for the rest of today, trading one
    // half of the bug for the other.
    const advanced = task({ id: 'a', title: 'Bins out', due_on: '2026-08-11' });
    const db = fakeDb({
      tasks: { data: [advanced] },
      task_events: { data: [{ for_due_on: TODAY, outcome: 'done', tasks: advanced }] },
    });

    const { rows } = await liveAndAnswered(db, TODAY, AUGUST);

    expect(rows.map((r) => [r.shownDueOn, r.answeredAs])).toEqual(
      expect.arrayContaining([
        [TODAY, 'done'],
        ['2026-08-11', null],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('keeps a one-off answered this morning, which archiving took out of the live query', async () => {
    const archived = task({ id: 'a', title: 'Renew passport', archived_at: '2026-08-04T09:00:00Z' });
    const db = fakeDb({
      tasks: { data: [] },
      task_events: { data: [{ for_due_on: TODAY, outcome: 'done', tasks: archived }] },
    });

    const { rows } = await liveAndAnswered(db, TODAY, AUGUST);

    expect(rows).toHaveLength(1);
    expect(rows[0].shownDueOn).toBe(TODAY);
    expect(rows[0].answeredAs).toBe('done');
  });

  it('drops an answer for an occurrence outside the window', async () => {
    // Backfilling last Friday from the tasks room, while the calendar is on
    // September. The disposition happened TODAY, but the day it is about is not
    // on this grid, and a row has to land on a cell.
    const t = task({ id: 'a', due_on: '2026-09-04' });
    const db = fakeDb({
      tasks: { data: [] },
      task_events: { data: [{ for_due_on: '2026-07-31', outcome: 'done', tasks: t }] },
    });

    const { rows } = await liveAndAnswered(db, TODAY, AUGUST);

    expect(rows).toEqual([]);
  });

  it('drops an answer for a task with no date, which has no cell to sit on', async () => {
    const someday = task({ id: 'a', due_on: null });
    const db = fakeDb({
      tasks: { data: [] },
      task_events: { data: [{ for_due_on: null, outcome: 'done', tasks: someday }] },
    });

    const { rows } = await liveAndAnswered(db, TODAY, AUGUST);

    expect(rows).toEqual([]);
  });

  it('still reports what everything answered today, window or not', async () => {
    // `answeredToday` is the badge's and the zones' map, and it means TODAY —
    // never "today, as seen through whatever month you happen to be looking at".
    const t = task({ id: 'a', due_on: '2026-09-04' });
    const db = fakeDb({
      tasks: { data: [] },
      task_events: { data: [{ for_due_on: '2026-07-31', outcome: 'skipped', tasks: t }] },
    });

    const { answeredToday } = await liveAndAnswered(db, TODAY, AUGUST);

    expect(answeredToday.get('a')).toBe('skipped');
  });
});
