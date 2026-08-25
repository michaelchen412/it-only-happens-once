// A jot becomes a quote — plan 45 · Piece 1.
//
// The pile's chooser gained a fifth destination, and it is the only one that
// LEAVES the room: `Make it a quote…` sends the jot's id to `/admin/fragments`,
// which opens the new-quote sheet already holding the words. The jot is
// consumed only when the quote is saved.
//
// ⚠ THIS SPEC SEEDS AND WRITES, so it is skipped unless `E2E_ALLOW_WRITES=1`
// (ADR 0037). There is no local Supabase stack: the rows below go into
// Michael's live project, carry the `zzz-e2e-throwaway` prefix in the one field
// this spec controls end to end — the body — and are swept before AND after.
//
//     E2E_ALLOW_WRITES=1 npx playwright test note-to-quote
//
// ⚠ WHY IT NEEDS REAL ROWS AT ALL. A stub can record that `saveQuote` was
// called. It cannot show the half this piece exists for: that the quote came
// out holding the jot's words, and that the jot then left the pile. Those are
// two rows in two states, and the ordering between them (14 §10e — write the
// destination first, consume the dump last) is the thing most likely to be got
// wrong by a later edit.
import { test, expect, allowActions } from './fixtures';
import { serviceDb, sweepThrowaways, writesAllowed, THROWAWAY } from './db';

test.describe('a jot becomes a quote', () => {
  test.skip(!writesAllowed(), 'seeds real rows — run with E2E_ALLOW_WRITES=1');

  const db = serviceDb();
  const stamp = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  // Before as well as after: a run interrupted with ⌃C leaves its rows behind,
  // and sweeping at the start means the corpus is clean even when the last
  // thing that happened was a crash.
  test.beforeEach(async () => void (await sweepThrowaways(db)));
  test.afterEach(async () => void (await sweepThrowaways(db)));

  test('⚠ the quote carries the words, and the jot leaves the pile', async ({ page }) => {
    const s = stamp();
    const BODY = `${THROWAWAY} the past is never dead ${s}`;

    const { data: jot, error: seedErr } = await db
      .from('fragments')
      .insert({ type: 'writing', status: 'note', slug: `${THROWAWAY}-jot-${s}`, body: BODY })
      .select('id')
      .single();
    expect(seedErr, `could not seed a jot: ${seedErr?.message}`).toBeNull();

    // ---- drive the real control, through the admin's own session and RLS
    await page.goto('/admin/notes');
    const card = page.locator(`[data-note="${jot!.id}"]`);
    await expect(card).toBeVisible();

    // ⚠ NAMED, NOT LIFTED. Exactly two actions may reach the live project from
    // this page — the save and the consume. Everything else the sheet could
    // call stays blocked, so a regression that starts writing somewhere new
    // fails here rather than in Michael's corpus.
    await allowActions(page, ['fragments.saveQuote', 'fragments.bulk']);
    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="quote"]').click();

    // The door leaves the room, and the sheet arrives holding the jot.
    await page.waitForURL(/\/admin\/fragments/);
    await expect(page.locator('#quote-editor')).toContainText(BODY);
    // ⚠ AND THE PARAMS ARE SCRUBBED. Left in the bar, a refresh would re-seed
    // this sheet from a jot the save is about to consume.
    expect(page.url()).not.toContain('from=');

    // Nothing has been taken from the pile yet — this is what makes abandoning
    // the sheet free, and it is the half of the ordering rule a later edit is
    // most likely to invert.
    const { data: before } = await db.from('fragments').select('deleted_at').eq('id', jot!.id).single();
    expect(before?.deleted_at, 'the jot was consumed before the quote existed').toBeNull();

    await page.locator('#quote-save').click();

    /*
      The sheet closes on success; an error holds it open instead.

      ⚠ `#sheet`, AND THE WRONG ID HERE COST A DEBUGGING ROUND. The first draft
      waited on `#quote-sheet`, which does not exist — and Playwright's
      `toBeHidden()` PASSES for an element that is absent, so the assertion was
      green while the sheet sat open behind it with the save half done. A
      selector that cannot fail is worse than no assertion; the error line below
      is asserted for the same reason.
    */
    await expect(page.locator('#sheet')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#sheet-error')).toBeHidden();

    // ---- the two halves no on-screen assertion could reach
    const { data: quotes } = await db
      .from('fragments')
      .select('id, body, status')
      .eq('type', 'quote')
      .like('body', `${THROWAWAY}%`);
    expect(quotes?.length, 'exactly one quote should have been made').toBe(1);
    expect(quotes![0].body).toContain(BODY);

    const { data: after } = await db.from('fragments').select('deleted_at').eq('id', jot!.id).single();
    expect(after?.deleted_at, 'the jot should have left the pile once the quote existed').not.toBeNull();
  });
});
