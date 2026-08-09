// /admin/library — the merge dropdown, the delete confirm, the inline save
// (27 · §5, inherited from 26 · §5 when that plan closed).
//
// ⚠ MERGE IS THE ONE CONTROL ON THIS SITE THAT DELIBERATELY DESTROYS A ROW, and
// until today nothing drove it. `actions-vocabulary.test.ts` proves the handler
// delegates to the right function with the right two ids; plan 26 rehearsed the
// SQL against live data inside a transaction that rolled itself back. **What
// nothing covered is the path between them** — a `<select>` whose `change` event
// is the trigger, a confirm dialog that has to gate it, and a page that reloads
// on success.
//
// A `<select>` as a destructive trigger is worth a spec on its own: there is no
// button to not-press, the gesture is one the browser also fires on keyboard
// arrow-keys, and the only thing between "browsing the options" and "that work
// is gone" is the dialog. The first two tests are about the dialog.
//
// ── WHAT IS STUBBED AND WHAT IS NOT ────────────────────────────────────────
//
// Four tests stub `/_actions/**` and assert what the page SENDS. They run on
// every `npm run test:e2e` and write nothing.
//
// The fifth seeds real rows and merges for real. It is skipped unless
// `E2E_ALLOW_WRITES=1`, because this suite runs against the live project and
// `auth.setup.ts` states the rule: *fixtures are DISCOVERED, never seeded —
// creating rows is a hazard that outlives a failed teardown.* That rule is right
// for a suite you run without thinking, and this is the one assertion that
// cannot be made without breaking it, so it is the one you opt into:
//
//     E2E_ALLOW_WRITES=1 npx playwright test library
//
// What only it can prove: that a person's shelf link SURVIVES the merge, still
// carrying its note. Before 2026-08-08 that link was deleted outright by the
// FK cascade, silently, and the merge reported success — plan 26 · §1.
import { test, expect, allowActions, formFields, stubActions } from './fixtures';
import { serviceDb, sweepThrowaways, writesAllowed, THROWAWAY } from './db';

/** The row for one entity, addressed the way the page addresses it. */
const row = (page: import('@playwright/test').Page, entity: string, id: string) =>
  page.locator(`.lib-row[data-entity="${entity}"][data-id="${id}"]`);

/** The shared confirm dialog AdminLayout renders once. */
const dialog = (page: import('@playwright/test').Page) => page.locator('#confirm-dialog');

/**
 * Any two works already in the Library, for the stubbed tests.
 *
 * Discovered, never created — the stubbed half of this file obeys the standing
 * rule exactly, and it can, because nothing it does reaches the database.
 */
async function twoWorks(page: import('@playwright/test').Page): Promise<[string, string] | null> {
  const ids = await page
    .locator('.lib-row[data-entity="work"]')
    .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.id!));
  return ids.length >= 2 ? [ids[0], ids[1]] : null;
}

test.describe('the Library — what the controls send', () => {
  test('⚠ merge asks first, and refusing sends nothing at all', async ({ page }) => {
    await page.goto('/admin/library');
    const works = await twoWorks(page);
    test.skip(!works, 'needs two works in the Library');
    const [from, into] = works!;

    const seen = await stubActions(page, {});
    await row(page, 'work', from).locator('.lib-merge').selectOption(into);

    // The dialog is the only thing standing between an arrow-key and a deleted
    // row, so it must be up before anything is sent.
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#confirm-ok')).toHaveText('Merge');
    expect(seen(), 'a merge was sent before the confirm was answered').toEqual([]);

    await page.locator('#confirm-cancel').click();
    await expect(dialog(page)).toBeHidden();
    expect(seen(), 'cancelling still sent something').toEqual([]);

    // ⚠ AND THE SELECT GOES BACK TO ITS PROMPT. A cancelled merge that leaves
    // the target selected is a control lying about its state: the next arrow
    // key would re-fire `change` from a row that looks armed.
    await expect(row(page, 'work', from).locator('.lib-merge')).toHaveValue('');
  });

  test('confirming sends works.merge with the two ids, and nothing else', async ({ page }) => {
    await page.goto('/admin/library');
    const works = await twoWorks(page);
    test.skip(!works, 'needs two works in the Library');
    const [from, into] = works!;

    let payload: Record<string, string> = {};
    const seen = await stubActions(page, {
      'works.merge': (req) => {
        payload = formFields(req);
        return { ok: true };
      },
    });

    await row(page, 'work', from).locator('.lib-merge').selectOption(into);
    await page.locator('#confirm-ok').click();

    await expect.poll(() => seen()).toEqual(['works.merge']);
    // The direction is the half that cannot be seen by looking at the page, and
    // getting it backwards destroys the wrong row while reporting success.
    expect(payload.from).toBe(from);
    expect(payload.into).toBe(into);
  });

  test('delete asks first, and a refusal deletes nothing', async ({ page }) => {
    await page.goto('/admin/library');
    const works = await twoWorks(page);
    test.skip(!works, 'needs a work in the Library');

    const seen = await stubActions(page, {});
    await row(page, 'work', works![0]).locator('.lib-delete').click();

    await expect(dialog(page)).toBeVisible();
    // ⚠ Destructive prompts focus CANCEL, so a stray Enter is a refusal rather
    // than a deletion. The `danger` flag is what does it, and it is easy to drop.
    await expect(page.locator('#confirm-cancel')).toBeFocused();
    expect(seen()).toEqual([]);

    await page.locator('#confirm-cancel').click();
    await expect(dialog(page)).toBeHidden();
    expect(seen()).toEqual([]);
  });

  test('the inline save sends the whole row, not just the field you touched', async ({ page }) => {
    await page.goto('/admin/library');
    const works = await twoWorks(page);
    test.skip(!works, 'needs a work in the Library');
    const target = row(page, 'work', works![0]);

    let payload: Record<string, string> = {};
    const seen = await stubActions(page, {
      'works.update': (req) => {
        payload = formFields(req);
        return { ok: true };
      },
    });

    await target.locator('[data-field="title"]').fill('A renamed work');
    await target.locator('.lib-save').click();

    await expect.poll(() => seen()).toEqual(['works.update']);
    expect(payload.id).toBe(works![0]);
    expect(payload.title).toBe('A renamed work');
    // ⚠ `author_id`, `year` and `kind` ride along on every save, and they must:
    // the action writes all four columns, so a field left out of the payload is
    // a field cleared in the database. `kind` is a hidden input for exactly
    // this reason and is the one a refactor would drop.
    expect(Object.keys(payload).sort()).toEqual(['author_id', 'id', 'kind', 'title', 'year']);
  });
});

// ── the real thing ─────────────────────────────────────────────────────────

test.describe('the Library — a real merge keeps the shelf link', () => {
  // ⚠ EVERY TEST BELOW WRITES TO THE LIVE DATABASE. See the file header.
  test.skip(!writesAllowed(), 'seeds real rows — run with E2E_ALLOW_WRITES=1');

  const db = serviceDb();
  const stamp = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  // Before as well as after: a previous run that was interrupted with ⌃C left
  // its rows behind, and collecting them at the start means the Library is
  // clean even if the last thing that happened was a crash.
  test.beforeEach(async () => void (await sweepThrowaways(db)));
  test.afterEach(async () => void (await sweepThrowaways(db)));

  test('⚠ the note on a person’s shelf survives, pointing at the survivor', async ({ page }) => {
    const s = stamp();
    const { data: works, error: workErr } = await db
      .from('works')
      .insert([
        { title: `${THROWAWAY} A ${s}`, slug: `${THROWAWAY}-a-${s}` },
        { title: `${THROWAWAY} B ${s}`, slug: `${THROWAWAY}-b-${s}` },
      ])
      .select('id, title');
    expect(workErr, `could not seed works: ${workErr?.message}`).toBeNull();
    const [from, into] = works!;

    const { data: who, error: personErr } = await db
      .from('people')
      .insert({ display_name: `${THROWAWAY} ${s}`, slug: `${THROWAWAY}-${s}`, circle: 'friends' })
      .select('id')
      .single();
    expect(personErr, `could not seed a person: ${personErr?.message}`).toBeNull();

    // The link that used to be destroyed, and the note on it — the only prose
    // that table holds.
    const NOTE = 'Lent it to me the winter we met.';
    const SHELVED = '2019-03-04T00:00:00Z';
    const { error: linkErr } = await db
      .from('person_works')
      .insert({ person_id: who!.id, work_id: from.id, note: NOTE, created_at: SHELVED });
    expect(linkErr, `could not seed the shelf link: ${linkErr?.message}`).toBeNull();

    // ---- drive the real control, through the admin's own session and RLS
    await page.goto('/admin/library');
    await expect(row(page, 'work', from.id)).toBeVisible();

    await allowActions(page); // ⚠ from here, calls reach the live project
    await row(page, 'work', from.id).locator('.lib-merge').selectOption(into.id);
    await page.locator('#confirm-ok').click();

    // The page reloads on success; the merged-from row is gone and the survivor
    // is still there. An error would have shown in #lib-error instead.
    await expect(row(page, 'work', from.id)).toHaveCount(0, { timeout: 15_000 });
    await expect(row(page, 'work', into.id)).toBeVisible();
    await expect(page.locator('#lib-error')).toBeHidden();

    // ---- and the half no assertion could reach before
    const { data: links } = await db.from('person_works').select('work_id, note, created_at').eq('person_id', who!.id);
    expect(links, 'the shelf link was destroyed by the merge').toHaveLength(1);
    expect(links![0].work_id, 'the link did not move to the survivor').toBe(into.id);
    expect(links![0].note, 'the note was lost').toBe(NOTE);
    // `created_at` travels with the row: the People brief orders the shelf by it
    // and reads it as "when this was shared", so resetting it would silently
    // move a book someone gave you in 2019 to the top of "recently".
    expect(Date.parse(links![0].created_at)).toBe(Date.parse(SHELVED));

    const { data: gone } = await db.from('works').select('id').eq('id', from.id);
    expect(gone, 'the merged-from work is still there').toHaveLength(0);
  });
});
