// The ✚ declares where a thought is going — plan 45 · Piece 2.
//
// The capture dialog gained a tab row: Jot · Agenda · Quote · Piece. The tab
// changes nothing about what is written while you type — that is always a note,
// because only the note tier can hold a half-typed thought — it changes where
// **Done** sends you. This spec drives the Agenda door, which is the one with a
// new room at the other end of it (`scripts/jot-arrival.ts`).
//
// ⚠ THIS SPEC WRITES, so it is skipped unless `E2E_ALLOW_WRITES=1` (ADR 0037):
//
//     E2E_ALLOW_WRITES=1 npx playwright test capture-declares
//
// ⚠ IT CANNOT BE STUBBED, and that is not a preference. The ✚ writes the jot
// itself — there is nothing to seed and nothing to file until it has — so a
// stubbed run would be testing its own fixture rather than the motion. What is
// being proved is the pair of things no on-screen assertion reaches: that the
// task exists, and that the jot left the pile once it did.
//
// ⚠ AND IT DOES NOT DEPEND ON THE MODEL. `tasks.parse` is called for real, but
// nothing here asserts what it returned: 14 §6.4 says capture must never depend
// on the model, and the sheet's fallback — first line as the title — is the
// behaviour that has to hold when the key is missing or the network is down.
// The title is then overwritten by hand, so the sweep keys on a string this
// spec chose rather than one a model did.
import { test, expect, allowActions } from './fixtures';
import { serviceDb, sweepThrowaways, writesAllowed, THROWAWAY } from './db';

test.describe('the ✚ declares a destination', () => {
  test.skip(!writesAllowed(), 'writes real rows — run with E2E_ALLOW_WRITES=1');

  const db = serviceDb();
  const stamp = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  test.beforeEach(async () => void (await sweepThrowaways(db)));
  test.afterEach(async () => void (await sweepThrowaways(db)));

  test('⚠ Agenda parks the jot, opens the task sheet on it, and consumes it on save', async ({ page }) => {
    const s = stamp();
    const JOT = `${THROWAWAY} call the dentist friday ${s}`;
    const TITLE = `${THROWAWAY} task ${s}`;

    await page.goto('/admin');
    await allowActions(page, ['fragments.saveWriting', 'tasks.parse', 'tasks.save', 'fragments.bulk']);

    await page.locator('#cap-open').click();
    await page.locator('#cap-box [contenteditable="true"]').fill(JOT);
    // The box says so itself once the 700ms autosave has landed — waiting on the
    // word rather than on a timeout is what makes this deterministic.
    await expect(page.locator('#cap-status')).toHaveText('Saved', { timeout: 10_000 });

    const { data: jot } = await db
      .from('fragments')
      .select('id, status, deleted_at')
      .like('body', `${THROWAWAY}%`)
      .single();
    expect(jot?.status, 'the ✚ writes a NOTE whichever tab is lit').toBe('note');

    // ---- declare, and leave
    await page.locator('[data-cap-tab="agenda"]').click();
    await expect(page.locator('#cap-done')).toHaveText('Agenda →'); // the button says where it is taking you
    await page.locator('#cap-done').click();

    // ---- the room at the other end reads the sentence and opens on it
    await page.waitForURL(/\/admin\/agenda\/tasks/);
    const sheet = page.locator('#task-sheet');
    await expect(sheet).toBeVisible({ timeout: 20_000 }); // the parse is a real round trip
    await expect(page.locator('#task-sheet-title')).toHaveText('Make a task');
    await expect(sheet.locator('input[name="title"]')).not.toHaveValue('');
    // ⚠ Scrubbed, or a refresh re-opens the sheet on a jot the save consumed.
    expect(page.url()).not.toContain('from=');

    // Nothing has left the pile yet — abandoning here has to cost nothing.
    const { data: before } = await db.from('fragments').select('deleted_at').eq('id', jot!.id).single();
    expect(before?.deleted_at, 'the jot was consumed before the task existed').toBeNull();

    await sheet.locator('input[name="title"]').fill(TITLE);
    await sheet.locator('[data-submit]').click();

    // ---- the two halves no on-screen assertion could reach
    await expect
      .poll(async () => (await db.from('tasks').select('id').eq('title', TITLE)).data?.length ?? 0, {
        timeout: 15_000,
      })
      .toBe(1);

    await expect
      .poll(async () => (await db.from('fragments').select('deleted_at').eq('id', jot!.id).single()).data?.deleted_at, {
        timeout: 15_000,
      })
      .not.toBeNull();
  });

  /*
    The other two doors, which need no room built for them — Piece 1 already put
    the quote sheet at the end of one, and a piece is the jot itself after a
    status flip. Neither is saved here: what is new in Piece 2 is the ROUTING,
    and `note-to-quote.spec.ts` owns the quote's save and consume.
  */
  test('Quote lands in the corpus room with the sheet already holding the words', async ({ page }) => {
    const JOT = `${THROWAWAY} the past is never dead ${stamp()}`;
    await page.goto('/admin');
    await allowActions(page, ['fragments.saveWriting']);

    await page.locator('#cap-open').click();
    await page.locator('#cap-box [contenteditable="true"]').fill(JOT);
    await expect(page.locator('#cap-status')).toHaveText('Saved', { timeout: 10_000 });

    await page.locator('[data-cap-tab="quote"]').click();
    await expect(page.locator('#cap-done')).toHaveText('Quote →');
    await page.locator('#cap-done').click();

    await page.waitForURL(/\/admin\/fragments/);
    await expect(page.locator('#sheet')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#quote-editor')).toContainText(JOT);
  });

  test('⚠ Piece flips the jot to a draft before it navigates, so the sheet opens on a draft', async ({ page }) => {
    const JOT = `${THROWAWAY} something about the sky lab ${stamp()}`;
    await page.goto('/admin');
    await allowActions(page, ['fragments.saveWriting', 'fragments.bulk']);

    await page.locator('#cap-open').click();
    await page.locator('#cap-box [contenteditable="true"]').fill(JOT);
    await expect(page.locator('#cap-status')).toHaveText('Saved', { timeout: 10_000 });

    await page.locator('[data-cap-tab="piece"]').click();
    await page.locator('#cap-done').click();
    await page.waitForURL(/\/admin\/fragments/);

    // The flip is the whole motion — there is nothing to consume, because the
    // jot IS the draft now. Anything else would be a copy.
    await expect
      .poll(
        async () => (await db.from('fragments').select('status').like('body', `${THROWAWAY}%`).single()).data?.status,
        {
          timeout: 15_000,
        },
      )
      .toBe('draft');
  });
});
