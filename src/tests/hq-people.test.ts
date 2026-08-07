// The roster's derivations (12 · Piece 1).
//
// Pure functions, which is why they live in a module rather than in two pages —
// and it means the cases that actually bite can be asserted here rather than
// discovered on somebody's birthday. Three of these guard bugs the people lab
// found by prototyping the query rather than the pixels:
//
//  · a birthday window that does not wrap December → January silently drops
//    everyone born in the first weeks of the year, in the exact month you would
//    most want the warning;
//  · a cadence entered in months and stored in days that does not round-trip
//    changes a value nobody touched, every time the edit sheet is saved;
//  · `name[0]` on a name whose first character JavaScript stores as two code
//    units renders half a character.
import { describe, expect, it } from 'vitest';
import {
  byKnownSince,
  daysToMonths,
  hueFor,
  knownFor,
  monogram,
  monthsToDays,
  personSlug,
  rosterOrder,
  searchText,
  upcomingBirthday,
} from '../lib/hq/people';
// Shared, so a new column breaks one builder rather than four fixtures.
import { person } from './stubs/person';

describe('upcomingBirthday', () => {
  it('shows a birthday inside the lead window', () => {
    const p = person({ birth_month: 8, birth_day: 20 });
    expect(upcomingBirthday(p, '2026-08-02')).toEqual({ ymd: '2026-08-20', days: 18 });
  });

  it('says nothing outside it — a cake for 340 days a year is noise', () => {
    const p = person({ birth_month: 12, birth_day: 25 });
    expect(upcomingBirthday(p, '2026-08-02')).toBeNull();
  });

  it('counts today as zero days away, not as passed', () => {
    const p = person({ birth_month: 8, birth_day: 2 });
    expect(upcomingBirthday(p, '2026-08-02')).toEqual({ ymd: '2026-08-02', days: 0 });
  });

  it('rolls to next year the day after it passes', () => {
    const p = person({ birth_month: 8, birth_day: 1 });
    expect(upcomingBirthday(p, '2026-08-02')).toBeNull();
    expect(upcomingBirthday(p, '2027-07-20')?.ymd).toBe('2027-08-01');
  });

  // THE ONE THAT BREAKS A NAIVE IMPLEMENTATION. Comparing month/day numerically
  // against "today + 30 days" fails across the year boundary, and it fails in
  // December — when the warning matters most.
  it('wraps December into January', () => {
    const p = person({ birth_month: 1, birth_day: 8 });
    expect(upcomingBirthday(p, '2026-12-20')).toEqual({ ymd: '2027-01-08', days: 19 });
  });

  it('honours a per-person lead rather than a global one', () => {
    const eager = person({ birth_month: 10, birth_day: 1, birthday_lead_days: 90 });
    const brief = person({ birth_month: 10, birth_day: 1, birthday_lead_days: 7 });
    expect(upcomingBirthday(eager, '2026-08-02')?.days).toBe(60);
    expect(upcomingBirthday(brief, '2026-08-02')).toBeNull();
  });

  it('handles 29 February by falling back to 1 March in a common year', () => {
    const p = person({ birth_month: 2, birth_day: 29, birthday_lead_days: 60 });
    // 2027 is common — the occurrence resolves to 1 March.
    expect(upcomingBirthday(p, '2027-02-01')?.ymd).toBe('2027-03-01');
    // 2028 is a leap year — the real day exists.
    expect(upcomingBirthday(p, '2028-02-01')?.ymd).toBe('2028-02-29');
  });

  it('says nothing when there is no birthday', () => {
    expect(upcomingBirthday(person(), '2026-08-02')).toBeNull();
  });
});

describe('cadence, entered in months and stored in days', () => {
  // The reason the factor is 365.25/12 and not 30: at 30, the 365-day default
  // renders as 12 months and writes back 360, so opening the edit sheet and
  // pressing Save would move a value nobody looked at — silently, every time.
  it('round-trips the one-year default exactly', () => {
    expect(daysToMonths(365)).toBe(12);
    expect(monthsToDays(12)).toBe(365);
  });

  it('round-trips every month value the form allows', () => {
    for (let months = 1; months <= 120; months++) {
      expect(daysToMonths(monthsToDays(months))).toBe(months);
    }
  });
});

describe('monogram', () => {
  it('takes the first letter, upper-cased', () => {
    expect(monogram('devi')).toBe('D');
  });

  it('keeps a multi-code-unit first character whole', () => {
    // `'👋 Sam'[0]` is half a surrogate pair and renders as a replacement box.
    expect(monogram('👋 Sam')).toBe('👋');
  });

  it('keeps a combining mark attached to its letter', () => {
    // Decomposed on purpose: 'A' + U+030A COMBINING RING ABOVE. `name[0]` would
    // return a bare 'A' and drop the ring; the segmenter keeps them together.
    expect(monogram('Ångstrom')).toBe('Å');
  });

  it('survives a name that is only whitespace', () => {
    expect(monogram('   ')).toBe('?');
  });
});

describe('personSlug', () => {
  it('slugifies an ordinary name', () => {
    expect(personSlug('Rosalind Park')).toBe('rosalind-park');
  });

  it('falls back rather than leaving somebody unaddressable', () => {
    // `slugify` correctly refuses to invent a transliteration, which would
    // otherwise produce an empty slug and a profile with no URL.
    expect(personSlug('文')).toBe('person');
    expect(personSlug('!!!')).toBe('person');
  });
});

describe('hueFor', () => {
  it('is stable for the same id', () => {
    const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    expect(hueFor(id)).toBe(hueFor(id));
  });

  it('only ever returns a hue that exists in the ramp', () => {
    const ramp = ['cn-violet', 'cn-ice', 'cn-azure', 'cn-gold', 'cn-amber', 'cn-sand', 'cn-ember', 'cn-rose'];
    for (let i = 0; i < 200; i++) {
      expect(ramp).toContain(hueFor(`id-${i}`));
    }
  });
});

describe('knownFor', () => {
  it('reads as a year and a duration', () => {
    expect(knownFor(2013, '2026-08-02')).toBe('2013 · 13 years');
  });

  it('says "1 year", not "1 years"', () => {
    expect(knownFor(2025, '2026-08-02')).toBe('2025 · 1 year');
  });

  it('does not claim "0 years" for somebody met this year', () => {
    expect(knownFor(2026, '2026-08-02')).toBe('2026 · this year');
  });

  it('is absent when unknown', () => {
    expect(knownFor(null, '2026-08-02')).toBeNull();
  });
});

describe('byKnownSince', () => {
  // The tiebreak the roster actually passes is `byLastContact`. Here it is a
  // marker instead, so these assertions pin WHEN the fallback is reached rather
  // than re-testing what it does once it is.
  const never = () => 0;
  const marker = () => -1;

  it('puts the longest-known first', () => {
    const order = [
      person({ display_name: 'Colleague', known_since_year: 2022 }),
      person({ display_name: 'Mum', known_since_year: 1997 }),
      person({ display_name: 'Friend', known_since_year: 2011 }),
    ]
      .sort(byKnownSince(never))
      .map((p) => p.display_name);
    expect(order).toEqual(['Mum', 'Friend', 'Colleague']);
  });

  it('leaves the same year to the tiebreak — three people at 1997 is no answer', () => {
    const a = person({ display_name: 'A', known_since_year: 1997 });
    const b = person({ display_name: 'B', known_since_year: 1997 });
    expect(byKnownSince(marker)(a, b)).toBe(-1);
  });

  // NOT FIRST. Null is "not filled in", and reading it as year zero would hand
  // the top of the section to whoever was added most carelessly.
  it('sinks a missing year to the bottom', () => {
    const order = [
      person({ display_name: 'Unknown', known_since_year: null }),
      person({ display_name: 'Colleague', known_since_year: 2022 }),
      person({ display_name: 'Mum', known_since_year: 1997 }),
    ]
      .sort(byKnownSince(never))
      .map((p) => p.display_name);
    expect(order).toEqual(['Mum', 'Colleague', 'Unknown']);
  });

  it('leaves two missing years to the tiebreak as well', () => {
    const a = person({ display_name: 'A' });
    const b = person({ display_name: 'B' });
    expect(byKnownSince(marker)(a, b)).toBe(-1);
  });
});

describe('rosterOrder', () => {
  it('sorts by name, case-insensitively', () => {
    const names = [person({ display_name: 'devi' }), person({ display_name: 'Arun' })]
      .sort(rosterOrder)
      .map((p) => p.display_name);
    expect(names).toEqual(['Arun', 'devi']);
  });

  it('prefers sort_name when there is one', () => {
    const mum = person({ display_name: 'Mum', sort_name: 'Abbott, Jane' });
    const arun = person({ display_name: 'Arun' });
    expect([arun, mum].sort(rosterOrder).map((p) => p.display_name)).toEqual(['Mum', 'Arun']);
  });
});

describe('searchText', () => {
  it('covers name, epithet and location, lower-cased', () => {
    const p = person({ display_name: 'Tobias', epithet: 'College roommate', location: 'Seattle' });
    expect(searchText(p)).toBe('tobias college roommate seattle');
  });

  it('does not include the bio — a hit the card cannot show reads as a bug', () => {
    const p = person({ display_name: 'Tobias', bio: 'Reads constantly, mostly fiction.' });
    expect(searchText(p)).not.toContain('fiction');
  });

  it('skips the fields that are null rather than printing gaps', () => {
    expect(searchText(person({ display_name: 'Ren' }))).toBe('ren');
  });
});
