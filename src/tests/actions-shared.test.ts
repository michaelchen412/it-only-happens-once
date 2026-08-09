// `src/actions/_shared.ts` is the layer every action module validates and
// authorizes through, and it had no unit test — the whole 3,900-line actions
// tree was covered only by e2e. Added 2026-08-07 during a quality audit.
//
// These pin the three things that are cheap to test and expensive to get wrong:
// the form-encoding coercions (where '' must mean ABSENT, except when it
// doesn't), the admin guard, and slug uniqueness. The handlers themselves stay
// with the e2e suite, which is the right tool for them — they need a session, a
// database and RLS, and faking those would only test the fake.
//
// `astro:actions` is a virtual module; see src/tests/stubs/astro-actions.ts.
import { describe, it, expect } from 'vitest';
import {
  blankToUndef,
  constellationStatus,
  fail,
  fragmentStatus,
  idList,
  optHhmm,
  optInt,
  optText,
  optUrl,
  optUuid,
  optYmd,
  requireAdmin,
  uniqueSlug,
} from '../actions/_shared';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('blankToUndef', () => {
  it('treats an empty form field as ABSENT, not as a value', () => {
    // Astro's form→object step gives '' for an untouched input. Left alone it
    // would overwrite a stored value with an empty string.
    expect(blankToUndef('')).toBeUndefined();
    expect(blankToUndef(null)).toBeUndefined();
    expect(blankToUndef(undefined)).toBeUndefined();
  });

  it('leaves anything real alone, including falsy things that are not blank', () => {
    expect(blankToUndef('a')).toBe('a');
    expect(blankToUndef(0)).toBe(0);
    expect(blankToUndef(false)).toBe(false);
  });
});

describe('the optional scalars', () => {
  it('optText: blank is absent, text is text', () => {
    expect(optText.parse('')).toBeUndefined();
    expect(optText.parse('hello')).toBe('hello');
  });

  it('optInt: coerces the string a form actually sends', () => {
    expect(optInt.parse('42')).toBe(42);
    expect(optInt.parse('')).toBeUndefined();
    expect(() => optInt.parse('4.5')).toThrow();
    expect(() => optInt.parse('abc')).toThrow();
  });

  it('optUuid: a bad id is rejected here rather than at the database', () => {
    expect(optUuid.parse(UUID)).toBe(UUID);
    expect(optUuid.parse('')).toBeUndefined();
    expect(() => optUuid.parse('not-a-uuid')).toThrow();
  });

  it('optUrl: says what is wrong in words a person can read', () => {
    expect(optUrl.parse('https://example.com')).toBe('https://example.com');
    expect(optUrl.parse('')).toBeUndefined();
    expect(() => optUrl.parse('nonsense')).toThrow(/doesn’t look like a URL/);
  });
});

describe('optYmd', () => {
  it('accepts the wire shape and rejects everything else', () => {
    expect(optYmd.parse('2026-08-07')).toBe('2026-08-07');
    expect(optYmd.parse('')).toBeUndefined();
    expect(() => optYmd.parse('7 August 2026')).toThrow(/YYYY-MM-DD/);
    expect(() => optYmd.parse('2026-8-7')).toThrow();
  });

  it('checks the SHAPE only — "is 31 February a day?" is parseYmd\'s job', () => {
    // Stated in the source, and worth pinning: a reader who assumed this
    // validated the calendar would drop the real check downstream.
    expect(optYmd.parse('2026-02-31')).toBe('2026-02-31');
  });
});

describe('optHhmm', () => {
  it('accepts HH:MM, and the seconds some browsers add', () => {
    expect(optHhmm.parse('23:35')).toBe('23:35');
    expect(optHhmm.parse('23:35:00')).toBe('23:35:00');
    expect(optHhmm.parse('')).toBeUndefined();
  });

  it('rejects a time that is not zero-padded or not a time', () => {
    expect(() => optHhmm.parse('9:05')).toThrow(/HH:MM/);
    expect(() => optHhmm.parse('half past')).toThrow();
  });
});

describe('idList', () => {
  it('EMPTY IS A MEANINGFUL VALUE — "belongs to no constellation"', () => {
    // The one field where blank must NOT become undefined. Astro turns an empty
    // field into null, so a bare z.string() would reject the very case we mean:
    // a piece being removed from every constellation it was in.
    expect(idList.parse('')).toBe('');
    expect(idList.parse(null)).toBe('');
    expect(idList.parse(undefined)).toBe('');
  });

  it('passes a real list through untouched', () => {
    expect(idList.parse(`${UUID},${UUID}`)).toBe(`${UUID},${UUID}`);
  });
});

describe('the two status vocabularies', () => {
  it('a fragment has three tiers and defaults to draft', () => {
    expect(fragmentStatus.parse(undefined)).toBe('draft');
    for (const s of ['note', 'draft', 'published']) expect(fragmentStatus.parse(s)).toBe(s);
  });

  it('a CONSTELLATION HAS NO NOTES TIER, and that is why they are two schemas', () => {
    // `constellations.status` is a plain text column with a CHECK for
    // ('draft','published'), not the fragment_status enum. A shared const would
    // have let a constellation be filed as a note and only failed at the
    // database.
    expect(constellationStatus.parse(undefined)).toBe('draft');
    expect(constellationStatus.parse('published')).toBe('published');
    expect(() => constellationStatus.parse('note')).toThrow();
  });

  it('neither accepts an invented tier', () => {
    expect(() => fragmentStatus.parse('archived')).toThrow();
    expect(() => constellationStatus.parse('archived')).toThrow();
  });
});

describe('fail', () => {
  it('defaults to a 500 and carries the message', () => {
    const e = fail('Something broke');
    expect(e.message).toBe('Something broke');
    expect(e.code).toBe('INTERNAL_SERVER_ERROR');
    expect(e.status).toBe(500);
  });

  it('maps the code to the status Astro would send', () => {
    expect(fail('nope', 'FORBIDDEN').status).toBe(403);
    expect(fail('bad', 'BAD_REQUEST').status).toBe(400);
    expect(fail('gone', 'NOT_FOUND').status).toBe(404);
  });
});

describe('requireAdmin', () => {
  const ctx = (role?: string) =>
    ({ locals: { user: role ? { app_metadata: { role } } : null } }) as unknown as { locals: App.Locals };

  it('lets the admin through', () => {
    expect(() => requireAdmin(ctx('admin'))).not.toThrow();
  });

  it('REFUSES everyone else — this guards the paid and third-party calls', () => {
    // Most actions are protected implicitly by RLS. These are the ones that
    // touch no RLS-protected table (the AI suggester, the Spotify lookup), so
    // without this they are callable by anyone at all.
    expect(() => requireAdmin(ctx())).toThrow(/Not authorized/);
    expect(() => requireAdmin(ctx('authenticated'))).toThrow(/Not authorized/);
    expect(() => requireAdmin(ctx('editor'))).toThrow(/Not authorized/);
  });

  it('refuses with FORBIDDEN, not a 500', () => {
    try {
      requireAdmin(ctx('nobody'));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as { code: string; status: number }).code).toBe('FORBIDDEN');
      expect((e as { status: number }).status).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// uniqueSlug — the one function here that talks to the database.
//
// The fake below is a SHAPE HARNESS, not a Postgres emulator: it answers the
// one query uniqueSlug makes (`select id from <table> where slug = ? [and id
// != ?] limit 1`) out of a set of taken slugs, and records which table was
// asked. Matching the real filter semantics any more closely would only be
// testing the fake.
function fakeDb(taken: string[], opts: { failOn?: string } = {}) {
  const asked: string[] = [];
  const db = {
    asked,
    from: (table: string) => {
      asked.push(table);
      let slug = '';
      let exclude: string | undefined;
      const q = {
        select: () => q,
        eq: (_col: string, val: string) => ((slug = val), q),
        neq: (_col: string, val: string) => ((exclude = val), q),
        limit: () => q,
        then: (resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown) => {
          if (opts.failOn === slug) return resolve({ data: null, error: { message: 'db exploded' } });
          // A row "belongs to" the excluded id when we are re-saving that row,
          // so its own slug stops counting as taken.
          const hit = taken.includes(slug) && exclude !== `owner-of-${slug}`;
          return resolve({ data: hit ? [{ id: `owner-of-${slug}` }] : [], error: null });
        },
      };
      return q;
    },
  };
  return db as unknown as Parameters<typeof uniqueSlug>[0] & { asked: string[] };
}

describe('uniqueSlug', () => {
  it('ASKS THE TABLE IT WAS GIVEN — the bug this argument exists for', async () => {
    // Until 2026-08-08 this function was hard-wired to `fragments`, and
    // subjects/authors/works called it anyway: their uniqueness was "checked"
    // against a table they do not share a namespace with, so a real collision
    // reached the database as a raw unique-violation string. Two other modules
    // (people, goals) had written their own probe to avoid the trap and said so
    // in a comment; a fourth copy was inlined in constellations.save. All four
    // are gone, which is only safe if the table argument is actually used.
    const db = fakeDb([]);
    await uniqueSlug(db, 'subjects', 'forgiveness');
    expect(db.asked).toEqual(['subjects']);
  });

  it('returns the slug untouched when nothing has it', async () => {
    expect(await uniqueSlug(fakeDb([]), 'fragments', 'forgiveness')).toBe('forgiveness');
  });

  it('counts up from 2, so the second one reads as the second', async () => {
    expect(await uniqueSlug(fakeDb(['forgiveness']), 'fragments', 'forgiveness')).toBe('forgiveness-2');
    expect(await uniqueSlug(fakeDb(['forgiveness', 'forgiveness-2']), 'fragments', 'forgiveness')).toBe(
      'forgiveness-3',
    );
  });

  it('a row does not collide with ITSELF when it is re-saved', async () => {
    // Without the exclusion, saving a piece twice would walk its slug to -2,
    // -3, -4 and break every link to it.
    expect(await uniqueSlug(fakeDb(['forgiveness']), 'fragments', 'forgiveness', 'owner-of-forgiveness')).toBe(
      'forgiveness',
    );
  });

  it('an empty base becomes "untitled" rather than an empty URL', async () => {
    expect(await uniqueSlug(fakeDb([]), 'fragments', '')).toBe('untitled');
    expect(await uniqueSlug(fakeDb(['untitled']), 'fragments', '')).toBe('untitled-2');
  });

  it('surfaces a database error instead of inventing a slug', async () => {
    // The vocabulary callers used to wrap this in `.catch(() => slugify(name))`,
    // which turned "the database is down" into a slug that might already be
    // taken. The catch is gone; the throw has to survive.
    await expect(uniqueSlug(fakeDb([], { failOn: 'forgiveness' }), 'subjects', 'forgiveness')).rejects.toThrow(
      /db exploded/,
    );
  });

  it('gives up rather than looping forever', async () => {
    const crowded = ['untitled', ...Array.from({ length: 60 }, (_, i) => `untitled-${i + 2}`)];
    await expect(uniqueSlug(fakeDb(crowded), 'fragments', 'untitled')).rejects.toThrow(/Could not find a free URL/);
  });
});
