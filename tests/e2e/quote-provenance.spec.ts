// Plan 17 · step 1 — the seeding trap, and the two dead fields.
//
// The reported symptom, in Michael's words: "if I'm adding a Bible verse, what
// is the process?" The answer was that from several states there wasn't one.
// Typing a book name into Attribution seeded a PHANTOM author, and an
// uncommitted author owns no works — so the Work list emptied and "The Bible"
// could no longer be chosen. The only way forward was to type it again, creating
// a second, duplicate, authorless work. The Ecclesiastes 9:11 row in the live
// corpus is very likely that scar: filed under no work at all, with the Bible as
// a loose string in `details`.
//
// ⚠ These specs read the vocabulary the PAGE rendered rather than hardcoding
// "The Bible", so they assert the RULE — every authorless work stays offerable —
// rather than the datum. A rename can't make them lie, and they still fail if
// the rule breaks. (`entity-combo.spec.ts` drives `setOptions()` instead; that
// can't work here, because the scoping logic reads `allWorks` from the combo's
// `data-options` once at module load.)
import { test, expect, type Page } from '@playwright/test';
import { blockWrites } from './fixtures';

const ATTR = '#quote-form [name="attribution"]';
const AUTHOR = '#quote-author';
const WORK = '#quote-work';

async function openQuoteSheet(page: Page) {
  await blockWrites(page); // nothing here saves; refuse it at the door anyway
  await page.goto('/admin/fragments');
  await page.locator('#add-btn').click(); // the quote sheet lives behind Add ▾
  await page.locator('#add-menu [data-new="quote"]').click();
  await expect(page.locator(AUTHOR)).toBeVisible();
}

/** The real vocabulary this page shipped into the two combos. */
async function vocab(page: Page) {
  return page.evaluate(() => {
    const parse = (sel: string) => JSON.parse((document.querySelector(sel) as HTMLElement).dataset.options || '[]');
    const authors = parse('#quote-author') as { id: string; name: string }[];
    const works = parse('#quote-work') as { id: string; name: string; authorId: string | null }[];
    const attributed = works.find((w) => w.authorId) ?? null;
    return {
      authors,
      authorless: works.filter((w) => !w.authorId),
      attributed,
      attributedAuthor: authors.find((a) => a.id === attributed?.authorId) ?? null,
    };
  });
}

/** What a combo has actually COMMITTED — through its own public API. */
const committed = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement & { getId(): string; getName(): string };
    return { id: el.getId(), name: el.getName() };
  }, sel);

const workRows = (page: Page) => page.locator(`${WORK} .entity-combo__opt:not(.entity-combo__opt--create)`);

async function openWorkMenu(page: Page) {
  await page.locator(`${WORK} input[role="combobox"]`).click();
  await expect(page.locator(`${WORK} .entity-combo__menu`)).toBeVisible();
}

/** Type into Attribution and blur, which is what fires its `change` handler. */
async function typeAttribution(page: Page, text: string) {
  await page.locator(ATTR).fill(text);
  await page.locator(ATTR).press('Tab'); // the blur is what fires `change`, and `change` is what seeds
  // ⚠ Tab lands in the Author combo, which opens its menu on focus — and that
  // menu is absolutely positioned over the Work field directly below it, so the
  // next click gets intercepted by an <li>. Park focus on something inert first.
  await page.locator('#sheet-title').click();
}

test.describe('a typed attribution can no longer strand the Work list', () => {
  test('a bare book name seeds no author, and the Bible stays choosable', async ({ page }) => {
    await openQuoteSheet(page);
    const v = await vocab(page);
    test.skip(!v.authorless.length, 'needs at least one authorless work in the corpus');

    // The exact input that used to break: a book name with no chapter:verse, so
    // the old `/\d+\s*:\s*\d+/` exemption did not catch it.
    const bookName = 'Ecclesiastes';
    expect(
      v.authors.some((a) => a.name.toLowerCase() === bookName.toLowerCase()),
      'the premise of this spec is that this is NOT an author',
    ).toBe(false);

    await typeAttribution(page, bookName);

    // Nothing seeded — so nothing to empty the list, and nothing for
    // `resolveAuthor` to turn into a real `authors` row on save.
    expect(await committed(page, AUTHOR)).toEqual({ id: '', name: '' });

    // And the work it actually belongs to is still on offer. This is the
    // assertion that was RED before the fix.
    await openWorkMenu(page);
    for (const w of v.authorless) {
      await expect(workRows(page).filter({ hasText: w.name })).toHaveCount(1);
    }
  });

  test('a chapter:verse locator is never mistaken for a person', async ({ page }) => {
    await openQuoteSheet(page);
    await typeAttribution(page, 'Matthew 5:43-48');
    expect(await committed(page, AUTHOR)).toEqual({ id: '', name: '' });
  });

  // ⚠ Green against the OLD source too, and deliberately so: it guards the half
  // of the behaviour that was worth keeping. Attribution still fills Author when
  // it names someone real — that is the no-double-entry convenience, and the fix
  // narrowed the rule without removing it.
  test('an author who exists still seeds, and commits an id rather than a name', async ({ page }) => {
    await openQuoteSheet(page);
    const v = await vocab(page);
    test.skip(!v.authors.length, 'needs at least one author in the corpus');

    const a = v.authors[0];
    await typeAttribution(page, a.name);

    // An ID, not just text: a name-only commit is what "phantom author" means,
    // and it is what `resolveAuthor` would have created a duplicate row from.
    expect(await committed(page, AUTHOR)).toEqual({ id: a.id, name: a.name });
  });
});

test('authorless works are offered even when an author IS committed', async ({ page }) => {
  await openQuoteSheet(page);
  const v = await vocab(page);
  test.skip(
    !v.authorless.length || !v.attributed || !v.attributedAuthor,
    'needs an authored work and an authorless one',
  );

  // Commit the author through the UI, so `combo:change` fires and the Work list
  // actually re-scopes — the thing under test.
  const field = page.locator(`${AUTHOR} input[role="combobox"]`);
  await field.click();
  await field.fill(v.attributedAuthor!.name);
  await field.press('Enter');
  expect((await committed(page, AUTHOR)).id).toBe(v.attributedAuthor!.id);

  await openWorkMenu(page);
  // Their own work is there — the scoping still scopes.
  await expect(workRows(page).filter({ hasText: v.attributed!.name })).toHaveCount(1);
  // And so is the work that belongs to nobody. `w.authorId === aid` can never
  // match a null, so this was excluded from EVERY committed-author state.
  for (const w of v.authorless) {
    await expect(workRows(page).filter({ hasText: w.name })).toHaveCount(1);
  }
});

test('the two dead fields are gone from the form', async ({ page }) => {
  await openQuoteSheet(page);
  // 0 rows in 76 quotes each. `source_author` never had an input at all — it was
  // written to `details` and read back into a field that did not exist.
  await expect(page.locator('#quote-form [name="source_author"]')).toHaveCount(0);
  await expect(page.locator('#quote-form [name="work_year"]')).toHaveCount(0);
  // Page survives: it is a locator, and it merges into "Where in it" later.
  await expect(page.locator('#quote-form [name="page"]')).toHaveCount(1);
});
