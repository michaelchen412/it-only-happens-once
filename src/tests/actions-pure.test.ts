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
import { autoOccurredAtFor, firstWords, yearToISO } from '../actions/fragments';
import { oneLine } from '../actions/site';

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

// ── the contact form's one line ──────────────────────────────────────────────
//
// The only field on this site an UNAUTHENTICATED stranger controls, and it lands
// in two places where a newline means something: the mail subject (a header ends
// at its first newline) and the body's `From:` line.
describe('oneLine — a stranger’s name cannot forge a line', () => {
  it('collapses a newline, so a name cannot add a second From: line', () => {
    // The actual attack: the plain text Michael reads would otherwise carry a
    // forged sender on its own line, aimed at exactly one person who has no
    // reason to suspect it.
    expect(oneLine('Bob\nFrom: ceo@example.com')).toBe('Bob From: ceo@example.com');
  });

  it('collapses a carriage return too — CRLF is the header separator', () => {
    expect(oneLine('Bob\r\nBcc: someone@example.com')).toBe('Bob Bcc: someone@example.com');
  });

  it('takes out other control characters, not just the line breaks', () => {
    expect(oneLine('Bo\u0000b')).toBe('Bo b');
  });

  it('leaves an ordinary name exactly as typed', () => {
    // Including the ones with punctuation and non-ASCII letters, which is most
    // names — this must not become a name filter.
    expect(oneLine('Zoë O’Brien-Smith')).toBe('Zoë O’Brien-Smith');
  });

  it('collapses runs of whitespace and trims, so a padded name still reads', () => {
    expect(oneLine('  Ada   Lovelace  ')).toBe('Ada Lovelace');
  });
});

// ============================================================================
describe('autoOccurredAtFor — the day a piece is filed under', () => {
  // ⚠ THIS IS THE TEST FOR A BUG THAT WAS LIVE ON THE PUBLIC BLOG (plan 42 ·
  // §4.C.7, ADR 0039). `occurred_at` used to be `new Date().toISOString()` — an
  // INSTANT standing in for a CALENDAR DATE — so on a UTC server every evening
  // in the Americas rolled the date forward. 17 of 56 published essays were
  // dated a day late because of it, and no rendering could repair them: the
  // wrong day was already in the column.

  it('files an evening in Los Angeles under that evening, not tomorrow', () => {
    // 6pm Pacific on the 18th is 01:00 UTC on the 19th — the exact shape of the
    // defect, and the reason the old code was wrong for a third of the corpus.
    const at = new Date('2026-08-19T01:00:00Z');
    expect(autoOccurredAtFor('America/Los_Angeles', at)).toBe('2026-08-18T00:00:00.000Z');
    // What the old rule did, stated so the regression is legible:
    expect(at.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  it('files a morning in Tokyo under that morning, not yesterday', () => {
    // ⚠ THE OTHER HEMISPHERE, and it is why this is `ymdToUtc(localToday(tz))`
    // rather than `zonedTimeToUtc(today, '00:00', tz)`. The near-miss stores a
    // real local midnight — harmless at 07:00Z for Los Angeles, but 15:00Z the
    // PREVIOUS DAY for Tokyo, so the UTC read comes back a day early and the bug
    // returns wearing the opposite sign.
    const at = new Date('2026-08-18T22:00:00Z'); // 07:00 on the 19th in Tokyo
    expect(autoOccurredAtFor('Asia/Tokyo', at)).toBe('2026-08-19T00:00:00.000Z');
  });

  it('always lands on a UTC midnight, which is what makes it a calendar date', () => {
    // The invariant the reader depends on: `shortDate` and `Timestamp` both read
    // the Y-M-D back with `timeZone: 'UTC'`, and a backdated piece written by
    // `occurredAtFrom` stores the same shape. One convention, two writers.
    for (const tz of ['America/Los_Angeles', 'Asia/Tokyo', 'Europe/London', 'Pacific/Kiritimati']) {
      const iso = autoOccurredAtFor(tz, new Date('2026-08-18T22:00:00Z'));
      expect(iso).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it('agrees with what a backdated piece stores for the same day', () => {
    // ⚠ THIS ASSERTION FOUND A LATENT BUG rather than confirming a belief, which
    // is the reason it is worth its lines. `occurredAtFrom` did `new Date(local)`
    // on a `datetime-local` string — parsed in the SERVER'S zone. Vercel runs
    // UTC so production was right by accident; this suite does not, and the two
    // write paths disagreed by four hours here. `occurredAtFrom` reads the wall
    // clock as UTC now, which is a no-op in production and removes the
    // dependency on an environment variable.
    const at = new Date('2023-04-19T12:00:00Z');
    expect(autoOccurredAtFor('America/Los_Angeles', at)).toBe('2023-04-19T00:00:00.000Z');
  });
});
