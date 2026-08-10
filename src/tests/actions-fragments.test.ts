// `syncSubjects` — the reconciliation that runs on EVERY fragment save
// (plans/30 · §4), including every autosave of a draft.
//
// ⚠ WHY THIS IS THE ONE HANDLER-ADJACENT FUNCTION WITH A UNIT TEST. The rest of
// `actions/fragments.ts` needs a session, a database and RLS, and faking those
// would only test the fake — that is e2e's job and `fragments.spec.ts` has it.
// This one is different because its bug is a *sequence*: which statements run,
// in what order, and which of them are skipped. That is exactly what the
// builder stub can see and what a green save cannot.
//
// It is exported for these tests and imported by nothing else, on the same
// footing as `firstWords` and `yearToISO` above it in that file.
import { describe, expect, it } from 'vitest';
import { syncSubjects } from '../actions/fragments';
import { fakeDb } from './stubs/supabase';

describe('syncSubjects', () => {
  it('an unchanged save writes NOTHING', async () => {
    // The commonest call by a wide margin — a body edit with the tag field
    // untouched — and under the old wipe-and-rewrite it deleted every link and
    // re-inserted it. Not just wasted writes: every one of those was a window
    // in which the piece had no subjects.
    const db = fakeDb(
      { subjects: { data: [{ id: 's-grief' }] }, fragment_subjects: { data: [{ subject_id: 's-grief' }] } },
      { record: true },
    );

    await syncSubjects(db.client, 'f-1', 'grief');

    const methods = db.ops('fragment_subjects').map((o) => o.method);
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('insert');
  });

  it('moves only what changed, and names the ids it removes', async () => {
    const db = fakeDb(
      { subjects: { data: [{ id: 's-new' }] }, fragment_subjects: { data: [{ subject_id: 's-old' }] } },
      { record: true },
    );

    await syncSubjects(db.client, 'f-1', 'attention');

    // Scoped by id rather than "everything on this fragment" — that scoping IS
    // the fix, because it is what bounds the blast radius of a failed write.
    const removed = db.ops('fragment_subjects').find((o) => o.method === 'in');
    expect(removed?.args).toEqual(['subject_id', ['s-old']]);
    expect(db.ops('fragment_subjects').some((o) => o.method === 'insert')).toBe(true);
  });

  it('⚠ resolves the target set BEFORE removing anything', async () => {
    // The half a naive diff gets wrong, and the reason the old code was as bad
    // as it was: reading `subjects` after the delete puts three fallible steps
    // back inside the window it was supposed to close. Asserted on ORDER,
    // because a version that read afterwards would pass every other test here.
    const db = fakeDb(
      { subjects: { data: [{ id: 's-new' }] }, fragment_subjects: { data: [{ subject_id: 's-old' }] } },
      { record: true },
    );

    await syncSubjects(db.client, 'f-1', 'attention');

    const readSubjects = db.calls.findIndex((c) => c.kind === 'from' && c.table === 'subjects');
    const firstDelete = db.calls.findIndex(
      (c) => c.kind === 'op' && c.table === 'fragment_subjects' && c.method === 'delete',
    );
    expect(readSubjects).toBeGreaterThanOrEqual(0);
    expect(firstDelete).toBeGreaterThan(readSubjects);
  });

  it('clearing every tag removes them and touches `subjects` not at all', async () => {
    // An empty field is a meaningful value here, not absence — and there is no
    // vocabulary to resolve, so the upsert and the read must not run.
    const db = fakeDb({ fragment_subjects: { data: [{ subject_id: 's-old' }] } }, { record: true });

    await syncSubjects(db.client, 'f-1', '  ');

    expect(db.tables()).not.toContain('subjects');
    expect(db.ops('fragment_subjects').some((o) => o.method === 'delete')).toBe(true);
    expect(db.ops('fragment_subjects').some((o) => o.method === 'insert')).toBe(false);
  });

  it('two spellings of one subject insert one link, not a unique violation', async () => {
    // "Grief, grief" and "Grief, GRIEF" both slug to one row, so the id list
    // arrives with a duplicate in it. Deduped before the insert.
    const db = fakeDb({ subjects: { data: [{ id: 's-grief' }, { id: 's-grief' }] } }, { record: true });

    await syncSubjects(db.client, 'f-1', 'Grief, grief');

    const inserted = db.ops('fragment_subjects').find((o) => o.method === 'insert');
    expect(inserted?.args).toEqual([[{ fragment_id: 'f-1', subject_id: 's-grief' }]]);
  });
});
