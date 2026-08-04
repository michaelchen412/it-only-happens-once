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
