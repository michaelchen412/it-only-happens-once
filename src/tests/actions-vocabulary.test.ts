// The merges, at the layer that used to lose data.
//
// ⚠ WHAT THIS FILE CAN AND CANNOT PROVE, said first because the distinction is
// the whole reason the fix went where it did. The remapping is three plpgsql
// functions now (`20260809013157_vocabulary_merges_are_one_transaction.sql`),
// and a fake client cannot prove a transaction — that was rehearsed against the
// live database, inside a `DO` block that rolled itself back, before the
// migration was applied. What IS provable here is the half that lives in
// TypeScript and the half that a future edit would break:
//
//   • the handler delegates — it does NOT reach the tables itself, which is
//     exactly what the old version did and how the delete came to run after a
//     failed remap;
//   • it calls the right function with the right two ids;
//   • it refuses a non-admin, and refuses the two-of-the-same slip, BEFORE
//     spending a round trip;
//   • a refusal from the database arrives as a sentence with the right status,
//     not as a 500 with a Postgres error string in it.
//
// These drive the REAL actions, `this`-bound to a hand-made context — see
// `src/tests/stubs/astro-actions.ts` for why that works and what it costs.
import { describe, it, expect } from 'vitest';
import { subjects, authors, works } from '../actions/vocabulary';
import { fakeDb, type FakeDb, type RpcResult } from './stubs/supabase';

const FROM = '11111111-1111-4111-8111-111111111111';
const INTO = '22222222-2222-4222-8222-222222222222';

/** An action context: the session client, and who is asking. */
function ctxFor(db: FakeDb, role: string | null = 'admin') {
  return { locals: { supabase: db.client, user: role ? { app_metadata: { role } } : null } };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Run a merge action the way the server runs it. */
type MergeAction = { orThrow: (input: FormData) => Promise<unknown> };
async function runMerge(
  action: MergeAction,
  { role = 'admin' as string | null, rpc = {} as Record<string, RpcResult>, from = FROM, into = INTO } = {},
) {
  const db = fakeDb({}, { record: true, rpc });
  const result = await (action.orThrow as unknown as (this: unknown, i: FormData) => Promise<unknown>).call(
    ctxFor(db, role),
    form({ from, into }),
  );
  return { db, result };
}

const CASES = [
  { name: 'subjects', action: subjects.merge as unknown as MergeAction, fn: 'merge_subjects', word: 'subjects' },
  { name: 'authors', action: authors.merge as unknown as MergeAction, fn: 'merge_authors', word: 'authors' },
  { name: 'works', action: works.merge as unknown as MergeAction, fn: 'merge_works', word: 'works' },
] as const;

describe.each(CASES)('$name.merge', ({ action, fn, word }) => {
  it('calls the atomic function and touches no table itself', async () => {
    // THE REGRESSION THIS FILE EXISTS FOR. The old handler ran its remapping
    // writes here, unchecked, and then deleted the merged-from row — so a
    // failure mid-way left the delete to fire against half-moved data. A
    // handler that reaches a table at all has grown that shape back.
    const { db, result } = await runMerge(action);
    expect(db.calls).toEqual([{ kind: 'rpc', fn, args: { from_id: FROM, into_id: INTO } }]);
    expect(db.tables()).toEqual([]);
    expect(result).toEqual({ ok: true });
  });

  it('refuses a non-admin before spending a round trip', async () => {
    for (const role of [null, 'authenticated', 'editor']) {
      const db = fakeDb({}, { record: true });
      await expect(
        (action.orThrow as unknown as (this: unknown, i: FormData) => Promise<unknown>).call(
          ctxFor(db, role),
          form({ from: FROM, into: INTO }),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(db.calls, `role ${role} reached the database`).toEqual([]);
    }
  });

  it(`refuses merging a ${word.replace(/s$/, '')} into itself, in words, without asking the database`, async () => {
    const db = fakeDb({}, { record: true });
    await expect(
      (action.orThrow as unknown as (this: unknown, i: FormData) => Promise<unknown>).call(
        ctxFor(db),
        form({ from: FROM, into: FROM }),
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: `Pick two different ${word}` });
    expect(db.calls).toEqual([]);
  });

  it('rejects an id that is not an id, before the handler runs', async () => {
    const db = fakeDb({}, { record: true });
    await expect(
      (action.orThrow as unknown as (this: unknown, i: FormData) => Promise<unknown>).call(
        ctxFor(db),
        form({ from: 'not-a-uuid', into: INTO }),
      ),
    ).rejects.toThrow();
    expect(db.calls).toEqual([]);
  });

  // The database's refusals, each arriving as the status it means rather than
  // as a 500 carrying a raw Postgres string. Mapped by SQLSTATE so the wording
  // stays the migration's to change.
  it.each([
    { code: 'P0002', message: 'One of those no longer exists.', expected: 'NOT_FOUND' },
    { code: '22023', message: 'Pick two different ones.', expected: 'BAD_REQUEST' },
    { code: '42501', message: 'Not authorized.', expected: 'FORBIDDEN' },
    { code: '08006', message: 'connection failure', expected: 'INTERNAL_SERVER_ERROR' },
  ])('surfaces a $code refusal as $expected', async ({ code, message, expected }) => {
    await expect(runMerge(action, { rpc: { [fn]: { error: { message, code } } } })).rejects.toMatchObject({
      code: expected,
      message,
    });
  });
});
