// Plan 17 · the quote sheet as Who / From / Where, and a line derived from them.
//
// The report, in Michael's words: "if I'm adding a Bible verse, what is the
// process? Do I put attribution first, or do I put the work? Do I have to put an
// author, and then do I have to put the source title again?" Every one of those
// had an answer the form could not give, and one had an answer the form actively
// prevented. Seven fields became three, and the field readers actually see
// stopped being one you type.
//
// ⚠ WHAT THIS FILE USED TO TEST IS GONE ON PURPOSE. Its first version pinned the
// Attribution→Author seeding fix from ce11bc4 — that a book name typed into
// Attribution no longer seeded a phantom author. That fix narrowed a guess about
// whether text was a person's name; this rebuild DELETES THE SURFACE the guess
// lived on, because there is no free-text attribution field to type a book name
// into any more. `scopedWorks`'s authorless rule is the half that survives, and
// it still has its spec below.
//
// ⚠ These specs read the vocabulary the PAGE rendered rather than hardcoding
// "The Bible", so they assert the RULE — every authorless work stays offerable,
// a work with no author leads with its locator — rather than the datum.
import { test, expect, type Page } from '@playwright/test';
import { blockWrites, stubActions } from './fixtures';

const AUTHOR = '#quote-author';
const WORK = '#quote-work';
const WHERE = '#quote-where';
const LINE = '#quote-preview-line';
const REVEAL = '#quote-preview-reveal';
const OVERRIDE = '#quote-attr-override';
const ATTR = '#quote-form [name="attribution"]';

async function openQuoteSheet(page: Page) {
  await blockWrites(page); // nothing here saves; refuse it at the door anyway
  await page.goto('/admin/fragments');
  await page.locator('#add-btn').click(); // the quote sheet lives behind Add ▾
  await page.locator('#add-menu [data-new="quote"]').click();
  await expect(page.locator(AUTHOR)).toBeVisible();
}

/**
 * The real vocabulary this page shipped into the two combos.
 *
 * ⚠ "Me" is dropped: it is a sentinel the sheet prepends, not a row in
 * `authors`, and leaving it in made `authors[0]` mean something different from
 * one spec to the next — which is how it first went red.
 */
async function vocab(page: Page) {
  return page.evaluate(() => {
    const parse = (sel: string) => JSON.parse((document.querySelector(sel) as HTMLElement).dataset.options || '[]');
    const authors = (parse('#quote-author') as { id: string; name: string }[]).filter((a) => a.id !== 'self');
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

/** Commit a combo the way a person does, so `combo:change` actually fires. */
async function pick(page: Page, sel: string, name: string) {
  const field = page.locator(`${sel} input[role="combobox"]`);
  await field.click();
  await field.fill(name);
  await field.press('Enter'); // also closes the menu, which otherwise overlays the field below
}

const workRows = (page: Page) => page.locator(`${WORK} .entity-combo__opt:not(.entity-combo__opt--create)`);

async function openWorkMenu(page: Page) {
  await page.locator(`${WORK} input[role="combobox"]`).click();
  await expect(page.locator(`${WORK} .entity-combo__menu`)).toBeVisible();
}

test.describe('the form asks three questions', () => {
  test('Who, From and Where — and the fields they replaced are gone', async ({ page }) => {
    await openQuoteSheet(page);
    await expect(page.locator(AUTHOR)).toBeVisible();
    await expect(page.locator(WORK)).toBeVisible();
    await expect(page.locator(WHERE)).toBeVisible();

    // Every one of these was a duplicate of data that already existed elsewhere,
    // or a key nothing rendered. `source_title` was 42 rows, 41 of them a
    // verbatim copy of the Work above it.
    for (const dead of ['source_author', 'work_year', 'source_title', 'page']) {
      await expect(page.locator(`#quote-form [name="${dead}"]`)).toHaveCount(0);
    }

    // Attribution still exists — as the override, closed until asked for. It is
    // no longer something you fill in on the way past.
    await expect(page.locator(OVERRIDE)).toBeHidden();
  });

  // The whole self-authored request ("I don't wanna do '--Myself' at the end of
  // every quote") was blocked by nothing but this `required`. An unattributed
  // quote could not be saved through the sheet at all — which is why the one in
  // the corpus can only have arrived by import.
  test('the words are the only required field', async ({ page }) => {
    await openQuoteSheet(page);
    const save = page.locator('#quote-save');
    await expect(save).toBeDisabled();
    await page.locator('#quote-editor [contenteditable]').fill('A short snippet of truth.');
    await expect(save).toBeEnabled(); // no attribution, no author, no work
  });
});

test.describe('the line is derived, not typed', () => {
  test('silence reads as an answer, not as an empty field', async ({ page }) => {
    await openQuoteSheet(page);
    await expect(page.locator(LINE)).toHaveText('nothing — the line stays silent');
    await expect(page.locator(REVEAL)).toHaveText('nothing to reveal');
  });

  test('a person leads, and the work waits behind the reveal', async ({ page }) => {
    await openQuoteSheet(page);
    const v = await vocab(page);
    test.skip(!v.attributed || !v.attributedAuthor, 'needs an authored work in the corpus');

    await pick(page, WORK, v.attributed!.name); // picking a work snaps its author
    await expect(page.locator(LINE)).toHaveText(`— ${v.attributedAuthor!.name}`);
    await expect(page.locator(REVEAL)).toHaveText(v.attributed!.name);
  });

  // Michael: "I don't want to say the Bible because that sounds awkward. I would
  // much rather just say John 3:16." No rule of its own — with no Who to lead
  // with, the locator is the only thing the line could be. And the work still
  // files every verse together, which is what the three scripture rows never did.
  test('with no Who, the locator leads and the work goes behind', async ({ page }) => {
    await openQuoteSheet(page);
    const v = await vocab(page);
    test.skip(!v.authorless.length, 'needs an authorless work in the corpus');
    const book = v.authorless[0];

    await pick(page, WORK, book.name);
    await page.locator(WHERE).fill('John 3:16');
    await expect(page.locator(LINE)).toHaveText('— John 3:16');
    await expect(page.locator(REVEAL)).toHaveText(book.name);

    // And the Who was never touched — the thing the old `scriptureRe` existed to
    // prevent now cannot happen, because a locator is never typed where a name goes.
    expect(await committed(page, AUTHOR)).toEqual({ id: '', name: '' });
  });

  test('a locator typed into Where never becomes a person', async ({ page }) => {
    await openQuoteSheet(page);
    await page.locator(WHERE).fill('Ecclesiastes 9:11');
    expect(await committed(page, AUTHOR)).toEqual({ id: '', name: '' });
    await expect(page.locator(LINE)).toHaveText('— Ecclesiastes 9:11');
  });
});

// Michael, 2026-08-03: "what if I wanted to add quotes of my own? … I don't
// wanna do '--Myself' at the end of every quote." The answer is that Me is
// simply the first option under Who, and it stores a flag rather than a name.
test.describe('Me — your own words', () => {
  test('leads the Who list, because every quote answers "who said it"', async ({ page }) => {
    await openQuoteSheet(page);
    await page.locator(`${AUTHOR} input[role="combobox"]`).click();
    await expect(page.locator(`${AUTHOR} .entity-combo__opt`).first()).toHaveText('Me');
  });

  test('silences the line and answers the reader behind it', async ({ page }) => {
    await openQuoteSheet(page);
    await pick(page, AUTHOR, 'Me');
    // Silent, because on your own site your own words are the default voice —
    // the essays don't sign themselves either.
    await expect(page.locator(LINE)).toHaveText('nothing — on your own site your words need no byline');
    // But the reader's real question — "if I take this, who do I attribute?" —
    // still has an answer, on demand. That is what makes the reveal the right
    // control rather than two controls wearing one coat.
    await expect(page.locator(REVEAL)).toHaveText('Michael Chen');
  });

  // ⚠ THE ONE THAT MATTERS. "Me" is a sentinel id in the combo, and if it ever
  // reached the server `resolveAuthor` would upsert a real `authors` row called
  // Me — which would give the derivation a name to lead with and put
  // "— Michael Chen" under every self-authored quote on his own site. This
  // watches the wire.
  test('the sentinel never leaves the browser — it becomes `is_self`', async ({ page }) => {
    let body = '';
    await stubActions(page, {
      'fragments.saveQuote': (req) => {
        body = req.postData() ?? '';
        return { id: 'deadbeef-1111-2222-3333-444444444444', slug: 'q' };
      },
    });
    await page.goto('/admin/fragments');
    await page.locator('#add-btn').click();
    await page.locator('#add-menu [data-new="quote"]').click();
    await expect(page.locator(AUTHOR)).toBeVisible();

    await page.locator('#quote-editor [contenteditable]').fill('A short snippet of truth.');
    await pick(page, AUTHOR, 'Me');
    await page.locator('#quote-save').click();
    await expect.poll(() => body).not.toBe('');

    expect(body, 'Me must be sent as the flag').toContain('is_self');
    expect(body, 'and never as an author the server would create').not.toMatch(/name="author_name"\r?\n\r?\nMe/);
    expect(body).not.toMatch(/name="author_id"\r?\n\r?\nself/);
    // Nothing to override, either — the silence is derived, not typed.
    expect(body).not.toContain('name="attribution"');
  });
});

test.describe('the override is the exception, never the routine', () => {
  test('opens pre-filled with the derived line, and reverts to it', async ({ page }) => {
    await openQuoteSheet(page);
    const v = await vocab(page);
    test.skip(!v.authors.length, 'needs at least one author in the corpus');
    const who = v.authors[0];

    await pick(page, AUTHOR, who.name);
    await expect(page.locator(LINE)).toHaveText(`— ${who.name}`);

    // You edit the sentence you can see, rather than composing one from scratch
    // against a blank field.
    await page.locator('#quote-attr-edit').click();
    await expect(page.locator(OVERRIDE)).toBeVisible();
    await expect(page.locator(ATTR)).toHaveValue(who.name);

    await page.locator(ATTR).fill('Someone else entirely');
    await expect(page.locator(LINE)).toHaveText('— Someone else entirely');

    await page.locator('#quote-attr-revert').click();
    await expect(page.locator(OVERRIDE)).toBeHidden();
    await expect(page.locator(ATTR)).toHaveValue('');
    await expect(page.locator(LINE)).toHaveText(`— ${who.name}`);
  });

  // 74 of 76 live rows store exactly what the rule derives, so opening one must
  // not read as "this quote is an exception". The two that DO open overridden are
  // the scripture rows whose locator sits in the wrong column — that is the
  // migration's to-do list surfacing where you can act on it, not a bug.
  test('opening an existing quote whose line already derives leaves it closed', async ({ page }) => {
    await blockWrites(page);
    await page.goto('/admin/fragments');
    const row = page.locator('tr[data-type="quote"][data-fragment]');
    await expect(row.first()).toBeVisible();

    // Find one the rule already explains: its stored line is its author's name.
    const idx = await row.evaluateAll((rows) =>
      rows.findIndex((r) => {
        const d = JSON.parse((r as HTMLElement).dataset.fragment || '{}');
        return d.attribution && d.authorName && d.attribution === d.authorName;
      }),
    );
    test.skip(idx < 0, 'needs a quote whose attribution is just its author');

    await row.nth(idx).locator('td').nth(2).click();
    await expect(page.locator(AUTHOR)).toBeVisible();
    await expect(page.locator(OVERRIDE)).toBeHidden();
    await expect(page.locator(ATTR)).toHaveValue('');
  });
});

// The half of ce11bc4 that survives the rebuild. "You can't pair an author with
// someone else's book" simply does not apply to a book that belongs to nobody —
// and `w.authorId === aid` can never match a null, so The Bible used to be
// excluded from EVERY committed-author state, not just the reported one.
test('authorless works are offered even when an author IS committed', async ({ page }) => {
  await openQuoteSheet(page);
  const v = await vocab(page);
  test.skip(
    !v.authorless.length || !v.attributed || !v.attributedAuthor,
    'needs an authored work and an authorless one',
  );

  await pick(page, AUTHOR, v.attributedAuthor!.name);
  expect((await committed(page, AUTHOR)).id).toBe(v.attributedAuthor!.id);

  await openWorkMenu(page);
  await expect(workRows(page).filter({ hasText: v.attributed!.name })).toHaveCount(1); // scoping still scopes
  for (const w of v.authorless) {
    await expect(workRows(page).filter({ hasText: w.name })).toHaveCount(1);
  }
});
