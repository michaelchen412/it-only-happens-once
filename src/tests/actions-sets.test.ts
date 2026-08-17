// `sets.save` cannot change a set's standing — only `setStatus` can.
//
// ⚠ THIS IS `actions-goals.test.ts`'S RULE, REACHING THE TABLE THAT SHIPPED
// WITHOUT IT. Plan 41 · §5a established it for `goals` on 2026-08-15 after two
// bugs and a UX complaint; the `sets` migration landed the SAME DAY and carried
// `status: setStatus` in `save` — a `.default('draft')` — so publishing rode a
// whole-card save and every edit named the column.
//
// ⚠ AND THE DEFAULT IS WHY THE FIELD HAD TO LEAVE THE SCHEMA, NOT JUST THE FORM.
// `_shared.ts`: an action cannot tell "cleared" from "not sent". With the
// control gone from the markup but `.default('draft')` still in the schema,
// Zod's default fires on every save — so editing a live set's description would
// have quietly UNPUBLISHED it. On `goals` that bug reset a private intention;
// here it would take a page off the public site.
//
// The invariant is narrow and load-bearing, in the words that file uses: an edit
// must not name the column at all. Not "writes the same value back" — does not
// mention it.
//
// These drive the REAL actions, `this`-bound to a hand-made context; see
// `src/tests/stubs/astro-actions.ts` for why that works.
import { describe, expect, it } from 'vitest';
import { sets } from '../actions/sets';
import { fakeDb, type FakeDb } from './stubs/supabase';

const SET = '55555555-5555-4555-8555-555555555555';
const PLAYLIST = 'https://open.spotify.com/playlist/2wQlYWCZpxDvO7UAWEUSY5';

function ctxFor(db: FakeDb) {
  return { locals: { supabase: db.client, user: { app_metadata: { role: 'admin' } } } };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

type FormAction = { orThrow: (input: FormData) => Promise<unknown> };
function run(action: unknown, db: FakeDb, fields: Record<string, string>) {
  const handler = (action as FormAction).orThrow as unknown as (this: unknown, i: FormData) => Promise<unknown>;
  return handler.call(ctxFor(db), form(fields));
}

/*
  ⚠ THE FIXTURE IS EMPTY, AND IT HAS TO BE. `sets.save` calls `uniqueSlug`
  before it branches, and that probes `.eq('slug', candidate).limit(1)` sixty
  times looking for a MISS. The stub fakes the builder and not the database —
  its own header says so — so a fixture holding any row answers every probe with
  that row, every candidate reads as taken, and the action throws "Could not
  find a free URL" before reaching the statement under test.

  The cost lands on the insert path only: `.select('id').single()` then comes
  back `null` and the handler throws on `data.id` AFTER the insert has been
  issued. That is why the create case asserts inside a `catch` — the stub has
  already recorded the statement, and the statement is the whole question here.
  (`goals`' version of this test does not hit it because `goals.save` slugs on
  the create path only.)
*/
const empty = { sets: {} };

describe('sets.save leaves the standing alone', () => {
  it('never names `status` when it updates an existing set', async () => {
    const db = fakeDb(empty, { record: true });

    await run(sets.save, db, {
      id: SET,
      title: 'If nothing else, I love you',
      playlist_url: PLAYLIST,
      description: 'edited',
    });

    const updates = db.ops('sets').filter((c) => c.method === 'update');
    expect(updates, 'the edit did not reach an update').toHaveLength(1);

    const payload = updates[0].args[0] as Record<string, unknown>;
    expect(
      Object.keys(payload).sort(),
      'sets.save wrote a column it has no business writing — status belongs to setStatus alone',
    ).toEqual(['description', 'playlist_url', 'quote_fragment_id', 'slug', 'title']);
    expect('status' in payload).toBe(false);
  });

  it('never names `status` when it creates one either', async () => {
    // ⚠ THE INSERT IS THE HALF THE `goals` TEST DOES NOT HAVE, and it is the one
    // that would fail loudly rather than quietly: a `.default('draft')` on
    // create looks harmless — a new set IS a draft — which is exactly why it
    // would survive a review and then fire on the update path too.
    const db = fakeDb(empty, { record: true });

    // Throws on the read-back, after the insert — see the fixture note above.
    await run(sets.save, db, { title: 'A curated listen', playlist_url: PLAYLIST }).catch(() => {});

    const insert = db.ops('sets').find((c) => c.method === 'insert');
    expect(insert, 'the create did not reach an insert').toBeTruthy();

    const payload = insert!.args[0] as Record<string, unknown>;
    expect('status' in payload, 'a new set takes the column default, not a value from the form').toBe(false);
  });
});

describe('sets.setStatus is the only writer', () => {
  it('a flip writes the status and NOTHING else', async () => {
    const db = fakeDb({ sets: {} }, { record: true });

    await run(sets.setStatus, db, { id: SET, status: 'published' });

    const update = db.ops('sets').find((o) => o.method === 'update');
    expect(update?.args[0]).toEqual({ status: 'published' });
  });
});
