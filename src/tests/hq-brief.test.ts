// The brief — what you last knew, at the moment you need it (27 · §4).
//
// ⚠ THE LAST UNTESTED MODULE IN `lib/hq/`, 18 of 19 covered, and the one whose
// rules are hardest to see by reading: four sources merged into one line each,
// a cap, two orderings and a precedence. Every one of them is the kind of thing
// that looks right in the code and is wrong on the page.
//
// WHAT THIS FILE CAN AND CANNOT PROVE, because `fakeDb` fakes the BUILDER and
// not the database: the filters are not exercised. `.eq('events.starts_on',
// ymd)` and `.in('person_id', ids)` return whatever the fixture registered for
// that table, so "did it ask for the right day" is not a question this file
// answers — that is e2e's, and `today.spec.ts` has it. What IS answered is
// everything the code does with the rows once they arrive, which is where all
// four of the rules below live.
import { describe, expect, it } from 'vitest';
import { BRIEF_CAP, birthdayLine, briefsFor } from '../lib/hq/brief';
import { fakeDb } from './stubs/supabase';
import { person } from './stubs/person';
import type { Ymd } from '../lib/hq/time';

const TODAY = '2026-08-09' as Ymd;

/** One `event_people` row as the two-level embed actually arrives. */
function tag(
  p: ReturnType<typeof person>,
  event: { id?: string; title: string; at?: string | null },
): Record<string, unknown> {
  return {
    person_id: p.id,
    people: p,
    events: {
      id: event.id ?? `e-${event.title}`,
      title: event.title,
      starts_on: TODAY,
      // All-day events carry no time at all; timed ones carry `HH:MM:SS`, which
      // the module slices to `HH:MM`.
      starts_at: event.at === undefined ? '09:00:00' : event.at,
    },
  };
}

const ana = person({ id: 'p-ana', display_name: 'Ana', slug: 'ana' });
const ben = person({ id: 'p-ben', display_name: 'Ben', slug: 'ben' });
const cass = person({ id: 'p-cass', display_name: 'Cass', slug: 'cass' });

describe('briefsFor', () => {
  it('says nothing on a day with no tagged event — the common morning', async () => {
    // The gate, and the reason the module is cheap on the days it does nothing:
    // an empty first query means the other three never run at all. Asserting on
    // the tables TOUCHED is the only way to see that from out here — the return
    // value is `[]` either way, so a version that queried all four first would
    // look identical while costing five round trips on the commonest morning.
    const db = fakeDb({ event_people: { data: [] } }, { record: true });

    const briefs = await briefsFor(db.client, TODAY);

    expect(briefs).toEqual([]);
    expect(db.tables()).toEqual(['event_people']);
  });

  it('gives one brief per PERSON, not per tag', async () => {
    // Two events with the same person is one person to prepare for. Reading
    // this wrong puts the same face on the page twice on exactly the busy day
    // when that is most annoying.
    const db = fakeDb({
      event_people: {
        data: [tag(ana, { title: 'Coffee', at: '09:00:00' }), tag(ana, { title: 'Dinner', at: '19:00:00' })],
      },
    });

    const briefs = await briefsFor(db, TODAY);

    expect(briefs).toHaveLength(1);
    // The header names whichever thing arrives FIRST, so the brief is read
    // before the earliest of the day's meetings rather than the last.
    expect(briefs[0].event.title).toBe('Coffee');
    expect(briefs[0].event.at).toBe('09:00');
  });

  it('puts all-day before timed, then the clock — the same order the agenda uses', async () => {
    const db = fakeDb({
      event_people: {
        data: [
          tag(ana, { title: 'Dinner', at: '19:00:00' }),
          tag(ben, { title: 'Ben’s birthday', at: null }),
          tag(cass, { title: 'Standup', at: '09:00:00' }),
        ],
      },
    });

    const briefs = await briefsFor(db, TODAY);

    // An all-day event has no time to sort by, and sorting it as though it were
    // midnight would be an accident rather than a decision. It leads.
    expect(briefs.map((b) => b.person.display_name)).toEqual(['Ben', 'Cass', 'Ana']);
    expect(briefs[0].event.at).toBeNull();
  });

  it('never lists more than three, and keeps the earliest three', async () => {
    // ⚠ A dinner party of nine must not become a wall of people — 10-hq.md §3
    // forbids exactly that, and three is what fits in the head on the way out
    // of the door.
    //
    // The cap is applied BEFORE the remaining queries, so nine guests cost
    // three people's history rather than nine. That is a cost property and this
    // stub cannot see it: applying the cap after the queries would produce an
    // identical return value. What is asserted here is the half that shows —
    // that it is the first three by the ordering above, not an arbitrary three.
    const guests = ['Dana', 'Eve', 'Finn', 'Gus', 'Hana'];
    const db = fakeDb({
      event_people: {
        data: guests.map((name, i) =>
          tag(person({ id: `p-${name}`, display_name: name, slug: name.toLowerCase() }), {
            title: `Table ${i}`,
            at: `${String(18 + i).padStart(2, '0')}:00:00`,
          }),
        ),
      },
    });

    const briefs = await briefsFor(db, TODAY);

    expect(briefs).toHaveLength(BRIEF_CAP);
    expect(briefs.map((b) => b.person.display_name)).toEqual(['Dana', 'Eve', 'Finn']);
  });

  it('leaves out someone who was archived', async () => {
    // They were deliberately taken off the roster, and a brief is the roster
    // speaking. The event itself still renders in the agenda zone — this is
    // about the face, not about the appointment.
    const db = fakeDb({
      event_people: {
        data: [
          tag(person({ ...ana, archived_at: '2026-01-01T00:00:00Z' }), { title: 'Coffee' }),
          tag(ben, { title: 'Coffee' }),
        ],
      },
    });

    const briefs = await briefsFor(db, TODAY);

    expect(briefs.map((b) => b.person.display_name)).toEqual(['Ben']);
  });

  it('carries YOUR last words verbatim, from the newest entry', async () => {
    // ⚠ The line the whole surface is for. It is never summarised, never
    // generated, and never the second-newest — a brief quoting last year while
    // a month-old entry exists is worse than no brief.
    const db = fakeDb({
      event_people: { data: [tag(ana, { title: 'Coffee' })] },
      interaction_people: {
        data: [
          { person_id: 'p-ana', interactions: { occurred_on: '2025-11-02', body: 'Talked about the move.' } },
          { person_id: 'p-ana', interactions: { occurred_on: '2026-06-14', body: '  She started the PhD.  ' } },
        ],
      },
    });

    const [brief] = await briefsFor(db, TODAY);

    expect(brief.lastOn).toBe('2026-06-14');
    // Trimmed, because the textarea keeps whatever whitespace you left — but
    // otherwise exactly what was typed.
    expect(brief.then).toBe('She started the PhD.');
  });

  it('distinguishes “no logged entry” from “long ago”', async () => {
    // `null` here means nothing has ever been written down, which is NOT the
    // same as a stale entry — the rendered line says something different for
    // each, and conflating them would invent a fact.
    const db = fakeDb({ event_people: { data: [tag(ana, { title: 'Coffee' })] } });

    const [brief] = await briefsFor(db, TODAY);

    expect(brief.lastOn).toBeNull();
    expect(brief.then).toBeNull();
  });

  it('⚠ a work beats a fragment on the shelf, always', async () => {
    // The two-hop edge that makes the shelf worth having (12 · §5):
    // "Piranesi — Susanna Clarke" is what they GAVE you, where a single quote
    // out of it is one thing that came from it.
    const db = fakeDb({
      event_people: { data: [tag(ana, { title: 'Coffee' })] },
      person_works: {
        data: [
          {
            person_id: 'p-ana',
            created_at: '2026-01-01',
            works: { title: 'Piranesi', authors: { name: 'Susanna Clarke' } },
          },
        ],
      },
      person_fragments: {
        data: [
          {
            person_id: 'p-ana',
            created_at: '2026-07-01', // NEWER, and still loses
            fragments: { type: 'quote', title: null, body: 'A quote out of it', attribution: null, deleted_at: null },
          },
        ],
      },
    });

    const [brief] = await briefsFor(db, TODAY);

    expect(brief.shelf).toBe('Piranesi — Susanna Clarke');
  });

  it('names a work with no author by its title alone', async () => {
    const db = fakeDb({
      event_people: { data: [tag(ana, { title: 'Coffee' })] },
      person_works: {
        data: [{ person_id: 'p-ana', created_at: '2026-01-01', works: { title: 'A pamphlet', authors: null } }],
      },
    });

    const [brief] = await briefsFor(db, TODAY);

    expect(brief.shelf).toBe('A pamphlet');
  });

  it('falls back to a fragment, flattened to one line', async () => {
    // The shelf line sits in a fixed-height slot, so markdown and newlines are
    // stripped rather than rendered — a `>` blockquote marker arriving as a
    // literal character is how this looked wrong the first time.
    const db = fakeDb({
      event_people: { data: [tag(ana, { title: 'Coffee' })] },
      person_fragments: {
        data: [
          {
            person_id: 'p-ana',
            created_at: '2026-07-01',
            fragments: {
              type: 'quote',
              title: null,
              body: '> **Some**\n  words\n',
              attribution: null,
              deleted_at: null,
            },
          },
        ],
      },
    });

    const [brief] = await briefsFor(db, TODAY);

    expect(brief.shelf).toBe('Some words');
  });

  it('a fragment in the trash is not on the shelf', async () => {
    // The same rule `sharedFor` keeps, so the brief and the profile can never
    // disagree about what is there — which would read as one of them lying.
    const db = fakeDb({
      event_people: { data: [tag(ana, { title: 'Coffee' })] },
      person_fragments: {
        data: [
          {
            person_id: 'p-ana',
            created_at: '2026-07-01',
            fragments: {
              type: 'writing',
              title: 'Deleted essay',
              body: null,
              attribution: null,
              deleted_at: '2026-07-02T00:00:00Z',
            },
          },
        ],
      },
    });

    const [brief] = await briefsFor(db, TODAY);

    expect(brief.shelf).toBeNull();
  });

  it('costs the brief and not the page when a query fails', async () => {
    // "Never throws" is in the module's contract, and it is load-bearing: this
    // runs on Today, which is the front door of HQ. A failed shelf lookup must
    // not take the morning down with it.
    const db = fakeDb({
      event_people: { data: [tag(ana, { title: 'Coffee' })] },
      person_works: { data: null, error: { message: 'boom' } },
      interaction_people: { data: null, error: { message: 'boom' } },
    });

    const briefs = await briefsFor(db, TODAY);

    expect(briefs).toHaveLength(1);
    expect(briefs[0].shelf).toBeNull();
    expect(briefs[0].then).toBeNull();
  });
});

describe('birthdayLine', () => {
  it('is a bare day and month, never a year', () => {
    // The register of the line: "2 Nov" is a reminder; "2 Nov 1987" is a
    // dossier. The year is stored and is deliberately not shown here.
    expect(birthdayLine({ birth_month: 11, birth_day: 2 })).toBe('2 Nov');
  });

  it('handles the leap day, which is a real birthday', () => {
    expect(birthdayLine({ birth_month: 2, birth_day: 29 })).toBe('29 Feb');
  });

  it('says nothing at all when either half is missing', () => {
    // A month with no day has nowhere to show, and half a birthday rendered as
    // a whole one is an invented fact.
    expect(birthdayLine({ birth_month: 11, birth_day: null })).toBeNull();
    expect(birthdayLine({ birth_month: null, birth_day: 2 })).toBeNull();
    expect(birthdayLine({ birth_month: null, birth_day: null })).toBeNull();
  });
});
