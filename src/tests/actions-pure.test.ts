// The pure rules inside the write layer (27 · §4).
//
// ⚠ WHY THESE SAT UNTESTED, AND IT IS NOT BECAUSE THEY ARE HARD. Every function
// here is total, synchronous and side-effect free — the unit suite's exact
// specialty. They were untested because of WHERE THEY LIVE: module-private
// helpers inside `src/actions/*.ts`, reachable only by driving the whole action
// with a fake client. They are exported now for no other reason than this file,
// and the export is the smaller cost.
//
// ⚠ WHY THEY WERE NOT MOVED TO `lib/` INSTEAD, which is what plan 27 first
// proposed. Each one throws `fail(...)` — an `ActionError` carrying an HTTP
// status. That is a write-layer concern; hoisting it into `lib/hq/` would make
// the pure domain layer import `astro:actions` to say "400 Bad Request", which
// is the dependency ADR-0016's layering exists to prevent. `bedDate` and its two
// neighbours DID move, in the same sitting, precisely because they throw nothing
// — see `hq-checkin.test.ts`. The rule that separates them is whether the
// function needs to know it is answering an HTTP request.
import { describe, expect, it } from 'vitest';
import { recurrenceOf } from '../actions/tasks';
import { assertBirthday } from '../actions/people';
import { firstWords, yearToISO } from '../actions/fragments';

/** The editor's payload, as `recurrenceOf` receives it after validation. */
type TaskInput = Parameters<typeof recurrenceOf>[0];
const chose = (over: Partial<TaskInput>): TaskInput =>
  ({ title: 'A task', priority: 'normal', effort: 'sitting', repeat: 'none', ...over }) as TaskInput;

// 13 August 2026 is a THURSDAY. Every weekly assertion below depends on that,
// so it is stated once rather than implied five times.
const THURSDAY = '2026-08-13';

describe('recurrenceOf', () => {
  it('clears all four columns when nothing repeats', () => {
    // The database CHECK refuses a half-filled recurrence, so this function's
    // job is to make sure the refusal never has to happen. "None" must write
    // four nulls, not three and a leftover.
    expect(recurrenceOf(chose({ repeat: 'none' }), THURSDAY)).toEqual({
      recur_mode: null,
      recur_rrule: null,
      recur_every: null,
      recur_unit: null,
    });
  });

  it('clears them even when the editor sent a leftover interval', () => {
    // Switching the segmented control back to "none" does not wipe the number
    // that was typed into the panel — the DOM keeps it. The payload therefore
    // arrives contradicting itself, and the explicit answer must win.
    expect(recurrenceOf(chose({ repeat: 'none', every: 3, unit: 'days', preset: 'weekly' }), THURSDAY)).toEqual({
      recur_mode: null,
      recur_rrule: null,
      recur_every: null,
      recur_unit: null,
    });
  });

  it('refuses to repeat from nothing, as a sentence', () => {
    // Both modes need something to repeat FROM. Left to the constraint this
    // arrives as a Postgres error string in a toast at 7am.
    expect(() => recurrenceOf(chose({ repeat: 'after', every: 2, unit: 'weeks' }), null)).toThrow(
      /needs a date to repeat from/,
    );
    expect(() => recurrenceOf(chose({ repeat: 'fixed', preset: 'weekly' }), null)).toThrow(
      /needs a date to repeat from/,
    );
  });

  it('writes the after-completion shape, and never an rrule with it', () => {
    expect(recurrenceOf(chose({ repeat: 'after', every: 3, unit: 'days' }), THURSDAY)).toEqual({
      recur_mode: 'after_completion',
      recur_rrule: null,
      recur_every: 3,
      recur_unit: 'days',
    });
  });

  it('defaults an unanswered interval to every 2 weeks', () => {
    // The panel opens with a value; this is the payload that arrives if it
    // somehow does not. A silent `null` here would fail the CHECK.
    expect(recurrenceOf(chose({ repeat: 'after' }), THURSDAY)).toMatchObject({ recur_every: 2, recur_unit: 'weeks' });
  });

  it('bounds the interval at both ends', () => {
    expect(() => recurrenceOf(chose({ repeat: 'after', every: 0 }), THURSDAY)).toThrow(/1 to 366/);
    expect(() => recurrenceOf(chose({ repeat: 'after', every: 367 }), THURSDAY)).toThrow(/1 to 366/);
    // The edges themselves are legal — an off-by-one here would reject "daily".
    expect(recurrenceOf(chose({ repeat: 'after', every: 1 }), THURSDAY)).toMatchObject({ recur_every: 1 });
    expect(recurrenceOf(chose({ repeat: 'after', every: 366 }), THURSDAY)).toMatchObject({ recur_every: 366 });
  });

  it('⚠ rebuilds the rule from the date every save, so the two cannot drift', () => {
    // The rule this file's header is about: move a weekly chore to a Thursday
    // and it becomes a THURSDAY rule — not a Monday rule quietly attached to a
    // Thursday, which is what storing the rule once and editing the date gives.
    expect(recurrenceOf(chose({ repeat: 'fixed', preset: 'weekly' }), THURSDAY)).toEqual({
      recur_mode: 'fixed',
      recur_rrule: 'FREQ=WEEKLY;BYDAY=TH',
      recur_every: null,
      recur_unit: null,
    });
    // The same task, moved to the Monday.
    expect(recurrenceOf(chose({ repeat: 'fixed', preset: 'weekly' }), '2026-08-10')).toMatchObject({
      recur_rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
  });

  it('defaults a missing preset to weekly rather than writing a null rule', () => {
    expect(recurrenceOf(chose({ repeat: 'fixed' }), THURSDAY)).toMatchObject({
      recur_mode: 'fixed',
      recur_rrule: 'FREQ=WEEKLY;BYDAY=TH',
    });
  });

  it('never carries an interval into fixed mode', () => {
    // `recur_every`/`recur_unit` belong to after-completion only. A stale pair
    // riding along would fail the CHECK that says a fixed rule owns neither.
    expect(recurrenceOf(chose({ repeat: 'fixed', preset: 'daily', every: 9, unit: 'months' }), THURSDAY)).toEqual({
      recur_mode: 'fixed',
      recur_rrule: 'FREQ=DAILY',
      recur_every: null,
      recur_unit: null,
    });
  });
});

describe('assertBirthday', () => {
  it('accepts a whole birthday, and accepts none at all', () => {
    expect(() => assertBirthday(11, 2, null)).not.toThrow();
    expect(() => assertBirthday(11, 2, 1987)).not.toThrow();
    // Name + circle is enough to add someone (12 · §10). Demanding nine fields
    // is how a roster stays empty.
    expect(() => assertBirthday(null, null, null)).not.toThrow();
  });

  it('refuses half a birthday, in either direction', () => {
    expect(() => assertBirthday(11, null, null)).toThrow(/both a month and a day/);
    expect(() => assertBirthday(null, 2, null)).toThrow(/both a month and a day/);
  });

  it('refuses a year with nowhere to show', () => {
    expect(() => assertBirthday(null, null, 1987)).toThrow(/nowhere to show/);
  });

  it('⚠ admits 29 February, which is a real birthday', () => {
    // The one every naive `DAYS_IN_MONTH` table gets wrong. Someone born on the
    // leap day would be unable to save their own date.
    expect(() => assertBirthday(2, 29, null)).not.toThrow();
    expect(() => assertBirthday(2, 30, null)).toThrow(/doesn’t exist in that month/);
  });

  it('refuses the 31st of a thirty-day month', () => {
    expect(() => assertBirthday(4, 31, null)).toThrow(/doesn’t exist in that month/);
    expect(() => assertBirthday(4, 30, null)).not.toThrow();
    expect(() => assertBirthday(12, 31, null)).not.toThrow();
  });
});

describe('firstWords', () => {
  it('takes seven words by default — the slug of a piece with no title', () => {
    expect(firstWords('one two three four five six seven eight nine')).toBe('one two three four five six seven');
  });

  it('collapses the whitespace a real body actually contains', () => {
    // Prose arrives with newlines, double spaces and a trailing return. Split
    // on a single space and the slug picks up empty segments.
    expect(firstWords('  the   quick\nbrown\t\tfox  ', 3)).toBe('the quick brown');
  });

  it('returns what there is when there are fewer words than asked for', () => {
    expect(firstWords('short')).toBe('short');
  });

  it('gives an empty string for an empty body, never throws', () => {
    // The caller does `input.slug || title || firstWords(body) || 'untitled'`,
    // so an empty string is the value that lets the fallback chain work. A
    // thrown error here would be a 500 on saving a blank draft.
    expect(firstWords('')).toBe('');
    expect(firstWords('   \n  ')).toBe('');
  });
});

describe('yearToISO', () => {
  it('puts a bare year at noon UTC on 1 January', () => {
    // ⚠ NOON, NOT MIDNIGHT, and that is the whole point. Midnight UTC is the
    // previous evening anywhere west of Greenwich, so a quote dated "1969"
    // would render as 1968 for a reader in New York. Noon has twelve hours of
    // slack in both directions.
    expect(yearToISO(1969)).toBe('1969-01-01T12:00:00.000Z');
  });

  it('is stable across the range the field can realistically hold', () => {
    // "Added (year)" defaults to the current year and is the year YOU filed the
    // song — so the honest domain here is four-digit years, and those are what
    // is pinned.
    expect(yearToISO(1900)).toBe('1900-01-01T12:00:00.000Z');
    expect(yearToISO(2026)).toBe('2026-01-01T12:00:00.000Z');
    expect(yearToISO(9999)).toBe('9999-01-01T12:00:00.000Z');
  });

  // ⚠ FOUND WHILE WRITING THIS FILE, DELIBERATELY NOT FIXED HERE, AND NOT
  // ASSERTED EITHER. `new Date('800-01-01T12:00:00Z')` is an Invalid Date —
  // ISO 8601 wants four digits — and `.toISOString()` on one THROWS
  // `RangeError: Invalid time value`. So a three-digit year in the song sheet's
  // "Added (year)" box is a 500 with a stack trace rather than a sentence.
  //
  // The input is `z.coerce.number().int()` with no bounds (actions/fragments.ts),
  // which is the actual defect: the bound belongs in the schema beside every
  // other one, not in this helper. That is the write layer's validation debt and
  // it belongs to plan 30, so it is written down here rather than fixed in a
  // plan about test coverage. **No assertion pins the broken behaviour** — a
  // test asserting a bug is a trap for whoever fixes it.
});
