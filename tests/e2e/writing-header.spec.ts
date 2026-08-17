// Plan 16 · Piece 1 — the writing sheet's command row.
//
// The complaint was "very severe layout shifts", and the whole value of this
// file is that it turns that sentence into a NUMBER. A published piece with
// pending edits used to move five things in that row, three of them on the
// first keystroke and one of them on a 1.2-second timer for as long as you kept
// writing. Nothing measured it, which is why it survived so long.
//
// Everything is stubbed (`stubActions`): the row's behaviour depends on the
// publish state and on a working version landing, and inventing those is
// strictly safer than finding a real published piece in the corpus and typing
// into it.
import type { Page } from '@playwright/test';
import type { actions } from 'astro:actions';
import { test, expect, stubActions } from './fixtures';

/** Tie each canned response to the action's own return type, so a stub that
 *  drifts from the handler it imitates is a compile error rather than a spec
 *  that stays green about a shape nothing sends any more. */
type Returns<T> = T extends (...a: never[]) => Promise<infer R>
  ? R extends { data: infer D }
    ? NonNullable<D>
    : never
  : never;
type FragmentGet = Returns<typeof actions.fragments.get>;
type VersionsList = Returns<typeof actions.versions.list>;

const FRAGMENT = '11111111-2222-4333-8444-555555555555';
const ISO = '2026-07-20T10:00:00.000Z';
const LIVE_BODY = 'The published text, as readers see it.';

/** Open the sheet on a PUBLISHED piece — the exact state the complaint names. */
async function openPublished(page: Page) {
  const seen = await stubActions(page, {
    'fragments.get': (): FragmentGet => ({
      id: FRAGMENT,
      type: 'writing',
      title: 'A published piece',
      slug: 'a-published-piece',
      status: 'published',
      body: LIVE_BODY,
      excerpt: 'A blurb.',
      subjects: '',
      constellationIds: [],
      occurredIso: ISO,
      updatedAt: ISO,
      paired: null,
    }),
    'versions.list': (): VersionsList => ({
      canonical: { title: 'A published piece', preview: LIVE_BODY, updatedAt: ISO },
      versions: [],
    }),
    // The autosave a published piece really makes: into a draft version, never
    // the live row. Answering it is what drives the status line to its longest
    // message, which is the one the reserved width has to survive.
    'versions.saveWorking': () => ({ id: 'v1', updatedAt: ISO }),
    'constellations.setMembership': () => ({ ok: true }),
  });
  await page.goto(`/admin/fragments#edit=${FRAGMENT}`);
  await expect(page.locator('#wsheet')).toBeVisible();
  await expect(page.locator('#ws-editor .tiptap-doc')).toContainText(LIVE_BODY);
  await settled(page);
  return seen;
}

/**
 * ⚠ WAIT FOR THE DRAWER TO STOP MOVING BEFORE MEASURING ANYTHING.
 *
 * `.drawer-dialog` slides in from the right, so for a few hundred milliseconds
 * after it is "visible" every child's x-coordinate is still travelling — the
 * dialog's right edge was measured at 1425 mid-flight and 1256 at rest. A
 * baseline taken in that window makes an x-coordinate assertion fail with a
 * ~170px "shift" that is really the entrance animation, and it fails
 * intermittently, which is the worst kind: it looks exactly like a real layout
 * bug and it comes and goes with machine speed. Cost an hour on 2026-08-04.
 */
async function settled(page: Page) {
  const x = () => page.locator('#wsheet').evaluate((el) => Math.round(el.getBoundingClientRect().x));
  await expect
    .poll(async () => {
      const a = await x();
      await page.waitForTimeout(60);
      return (await x()) === a ? 'still' : 'moving';
    })
    .toBe('still');
}

const xOf = async (page: Page, sel: string) => {
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error(`${sel} has no box`);
  return Math.round(box.x);
};

test.describe('the command row holds still while you type', () => {
  test('Save changes and View ↗ never move, across four autosave cycles', async ({ page }) => {
    await openPublished(page);

    const saveX = await xOf(page, '#ws-save-changes');
    const viewX = await xOf(page, '#ws-view-link');

    // Type a paragraph, in pieces, through more than two 1.2s autosave debounces
    // — the spinner cycle and the "Unsaved changes" → "Kept as a draft version"
    // transition both land inside this window.
    await page.locator('#ws-editor .tiptap-doc').click();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.type('Another clause arrives, and then a few more words after it. ');
      await page.waitForTimeout(900);
      expect(await xOf(page, '#ws-save-changes'), `Save changes moved on pass ${i + 1}`).toBe(saveX);
    }
    // Long enough for a final autosave to land and the status to settle.
    await page.waitForTimeout(1600);

    // The longest message the row can hold is now on screen — the one that
    // arrives when the working version lands — and the two controls have STILL
    // not moved. That is what the shock-absorber rules in app.css buy: the
    // deficit is aimed at the tab strip, which scrolls, instead of being spread
    // across every flexible item and pushed into the buttons.
    await expect(page.locator('#ws-status-text')).toHaveText('Kept as a draft version · not public yet');
    expect(await xOf(page, '#ws-save-changes')).toBe(saveX);
    expect(await xOf(page, '#ws-view-link')).toBe(viewX);
  });

  test('the spinner keeps its width when it is not spinning', async ({ page }) => {
    await openPublished(page);
    const spinner = page.locator('#ws-spinner');
    // `hidden` was the bug: it removed the box. `visibility` keeps it, so the
    // element is never zero-width even when nothing is being saved.
    await expect(spinner).not.toHaveClass(/is-on/);
    const box = await spinner.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
  });
});

test.describe('what the row carries', () => {
  test('the secondary actions are behind ⋯, and Discard appears there rather than in the row', async ({ page }) => {
    await openPublished(page);

    // In the row: the primary and the permalink. Nothing else.
    await expect(page.locator('#ws-save-changes')).toBeVisible();
    await expect(page.locator('#ws-view-link')).toBeVisible();
    await expect(page.locator('#ws-more-menu')).toBeHidden();

    // Discard does not exist yet — the piece is clean.
    await page.locator('#ws-more-btn').click();
    await expect(page.locator('#ws-more-menu')).toBeVisible();
    await expect(page.locator('#ws-open-details')).toBeVisible();
    await expect(page.locator('#ws-unpublish')).toBeVisible();
    await expect(page.locator('#ws-discard')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ws-more-menu')).toBeHidden();

    // …and after an edit it does, without the row having changed shape.
    const saveX = await xOf(page, '#ws-save-changes');
    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.type('one more thought');
    await expect(page.locator('#ws-save-changes')).toBeEnabled();
    expect(await xOf(page, '#ws-save-changes')).toBe(saveX);

    await page.locator('#ws-more-btn').click();
    await expect(page.locator('#ws-discard')).toBeVisible();
  });

  test('Delete left the top bar for the foot of the document', async ({ page }) => {
    await openPublished(page);
    await expect(page.locator('#ws-delete-zone')).toBeVisible();
    // Not in the command row, and not in the ⋯ menu either — a destructive
    // action one arrow-key from Unpublish was the fault being fixed.
    await expect(page.locator('#ws-command-row #ws-delete')).toHaveCount(0);
    await expect(page.locator('#ws-more-menu #ws-delete')).toHaveCount(0);
    await expect(page.locator('#ws-panel-doc #ws-delete')).toBeVisible();
  });

  test('the word WRITING is gone but the Note flip survives', async ({ page }) => {
    await openPublished(page);
    await expect(page.locator('#ws-heading-label')).toBeHidden();
    // Nothing VISIBLE is left in the heading at all, as of 2026-08-17: the word
    // went in plans/16 and the `▤` went with the glyph itself (TYPE_META). Both
    // strings this matches are non-visual — `writing` is sr-only, `Note` is
    // `hidden` until the flip — which is the assertion, not a quirk of it.
    await expect(page.locator('#ws-heading')).toHaveText('writingNote');
    // …and the dialog still has an accessible name. This is the ONLY thing
    // providing it — `aria-labelledby` points here — so a future tidy that
    // deletes an "empty-looking" span fails this line rather than shipping an
    // unnamed near-fullscreen drawer.
    await expect(page.locator('#ws-heading .sr-only')).toHaveText('writing');
  });
});
