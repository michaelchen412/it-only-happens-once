// Plan 02: "Suggest with AI" on all three fragment types.
//
// Two jobs here. The first is the new surface — the button on a song and on a
// piece of writing, which never existed. The second is REGRESSION: the quote
// flow was working code that got pulled out into a shared module, and the only
// honest way to claim that was a safe move is to drive the quote flow too.
//
// `/_actions/**` is stubbed, so no Anthropic call is paid for and nothing
// touches the corpus. That leaves the server path unproven by these specs on
// purpose — it's checked separately, once, against the live action.
import { test, expect, type Page } from '@playwright/test';
import type { actions } from 'astro:actions';
import { stubActions } from './fixtures';

type Returns<T> = T extends (...a: never[]) => Promise<infer R> ? (R extends { data: infer D } ? NonNullable<D> : never) : never;
type Suggestion = Returns<typeof actions.fragments.suggestSubjects>;

const EXISTING = ['solitude', 'attention'];
const PROPOSED = { name: 'thresholds', definition: 'The moments between one life and the next.' };

/**
 * Stub the model and capture what was sent. The captured text is the point:
 * it's the only way to check that each type gathers the right thing — a song
 * that forgets its annotation, or writing that sends the title alone, would
 * look identical from the outside.
 */
async function stubSuggest(page: Page, { proposed = true } = {}) {
  const sent: { text: string; kind: string }[] = [];
  const seen = await stubActions(page, {
    'fragments.suggestSubjects': (req): Suggestion => {
      sent.push(req.postDataJSON() as { text: string; kind: string });
      return { existing: EXISTING, proposed: proposed ? PROPOSED : null };
    },
  });
  return { sent, seen };
}

/**
 * Assert on TagInput's hidden field, not on the chips. The chip elements
 * contain their own ✕ button, so their textContent reads "solitude✕" — but
 * more to the point, this hidden input is the value that actually submits.
 */
const subjects = (root: ReturnType<Page['locator']>) => root.locator('input[name="subjects"]');

/** Quote and song are behind the list page's Add ▾ menu, not bare buttons. */
async function openNew(page: Page, type: 'quote' | 'song') {
  await page.goto('/admin');
  await page.locator('#add-btn').click();
  await page.locator(`#add-menu [data-new="${type}"]`).click();
}

test.describe('suggest subjects — writing', () => {
  test('the button reaches the model with the whole essay, and the preflight notices', async ({ page }) => {
    const { sent } = await stubSuggest(page);
    await page.goto('/admin#new-writing');
    await expect(page.locator('#ws-editor .tiptap-doc')).toBeVisible();

    await page.locator('#wsheet input[name="title"]').fill('On thresholds');
    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.type('The hallway between two rooms is where most of a life happens.');

    await page.locator('#ws-open-publish').click();
    const dialog = page.locator('#publish-dialog');
    await expect(dialog).toBeVisible();
    // The complaint, before the fix exists.
    await expect(page.locator('#pf-subjects')).toHaveText('0');
    await expect(page.locator('#pf-hint')).toContainText('no subjects');

    await page.locator('#ws-subjects [data-ai-run]').click();

    // Suggestions land as chips…
    await expect(subjects(page.locator('#ws-subjects'))).toHaveValue('solitude, attention');
    // …and the preflight updates. TagInput fires no input event, so this only
    // passes because writeTags re-renders it by hand — the assertion exists to
    // fail if that call is ever "cleaned up".
    await expect(page.locator('#pf-subjects')).toHaveText('2');
    await expect(page.locator('#pf-hint')).not.toContainText('no subjects');

    // Title AND body, not one or the other, and tagged as writing.
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('writing');
    expect(sent[0].text).toContain('On thresholds');
    expect(sent[0].text).toContain('The hallway between two rooms');
  });

  test('a proposed new subject is offered, never applied on its own', async ({ page }) => {
    await stubSuggest(page);
    await page.goto('/admin#new-writing');
    await page.locator('#wsheet input[name="title"]').fill('On thresholds');
    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.type('Something worth tagging.');
    await page.locator('#ws-open-publish').click();

    const field = page.locator('#ws-subjects');
    await field.locator('[data-ai-run]').click();

    const strip = field.locator('[data-ai-proposed]');
    await expect(strip).toBeVisible();
    await expect(field.locator('[data-ai-name]')).toHaveText(PROPOSED.name);
    await expect(field.locator('[data-ai-def]')).toHaveText(PROPOSED.definition);
    // The proposal is NOT in the field until a human says so — this is the part
    // that keeps the taxonomy from growing on its own.
    await expect(subjects(field)).toHaveValue('solitude, attention');

    await field.locator('[data-ai-add]').click();
    await expect(subjects(field)).toHaveValue('solitude, attention, thresholds');
    await expect(strip).toBeHidden();
    await expect(page.locator('#pf-subjects')).toHaveText('3');
  });

  test('nothing written yet means nothing to read', async ({ page }) => {
    const { sent } = await stubSuggest(page);
    await page.goto('/admin#new-writing');
    await expect(page.locator('#ws-editor .tiptap-doc')).toBeVisible();
    await page.locator('#ws-open-publish').click();

    await page.locator('#ws-subjects [data-ai-run]').click();
    await expect(page.locator('#dialog-error')).toBeVisible();
    await expect(page.locator('#dialog-error')).toContainText('Write something first');
    expect(sent, 'an empty piece must not spend a model call').toHaveLength(0);
  });
});

test.describe('suggest subjects — song', () => {
  async function newSong(page: Page) {
    await openNew(page, 'song');
    await expect(page.locator('#song-form')).toBeVisible();
  }

  test('refuses to guess from title and artist alone', async ({ page }) => {
    const { sent } = await stubSuggest(page);
    await newSong(page);
    await page.locator('#song-form input[name="title"]').fill('So What');
    await page.locator('#song-form input[name="attribution"]').fill('Miles Davis');
    await page.locator('#song-form input[name="album"]').fill('Kind of Blue');

    await page.locator('#song-subjects [data-ai-run]').click();

    // The whole point of the song half: metadata alone yields genres, and
    // genres are not what this taxonomy is for.
    await expect(page.locator('#sheet-error')).toBeVisible();
    await expect(page.locator('#sheet-error')).toContainText('Say why this one first');
    expect(sent, 'no annotation means no call at all').toHaveLength(0);
  });

  test('with an annotation it sends the words, not the metadata alone', async ({ page }) => {
    const { sent } = await stubSuggest(page, { proposed: false });
    await newSong(page);
    await page.locator('#song-form input[name="title"]').fill('So What');
    await page.locator('#song-form input[name="attribution"]').fill('Miles Davis');
    await page.locator('#song-form input[name="album"]').fill('Kind of Blue');
    await page.locator('#song-editor').click();
    await page.keyboard.type('Played it the whole winter I lived alone.');

    await page.locator('#song-subjects [data-ai-run]').click();

    await expect(subjects(page.locator('#song-subjects'))).toHaveValue('solitude, attention');
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('song');
    expect(sent[0].text).toContain('Played it the whole winter');
    expect(sent[0].text).toContain('So What');
    expect(sent[0].text).toContain('Miles Davis');
  });
});

test.describe('suggest subjects — quote (regression)', () => {
  // Working code that was pulled into the shared module. If the extraction
  // broke anything, it breaks here.
  async function newQuote(page: Page) {
    await openNew(page, 'quote');
    await expect(page.locator('#quote-form')).toBeVisible();
  }

  test('still refuses an empty quote, and still fills the field', async ({ page }) => {
    const { sent } = await stubSuggest(page, { proposed: false });
    await newQuote(page);

    await page.locator('#quote-subjects [data-ai-run]').click();
    await expect(page.locator('#sheet-error')).toContainText('Add the quote first');
    expect(sent).toHaveLength(0);

    await page.locator('#quote-editor').click();
    await page.keyboard.type('The obstacle is the way.');
    await page.locator('#quote-subjects [data-ai-run]').click();

    await expect(subjects(page.locator('#quote-subjects'))).toHaveValue('solitude, attention');
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('quote');
    expect(sent[0].text).toBe('The obstacle is the way.');
  });

  test('a failed call gives the button back instead of leaving it Thinking…', async ({ page }) => {
    // No handler registered, so stubActions aborts — what a dead network looks
    // like. astro:actions THROWS there rather than returning { error }, and the
    // quote-only version had no catch at all: the button stayed disabled on
    // "Thinking…" for the life of the page, with nothing said.
    await stubActions(page, {});
    await openNew(page, 'quote');
    await page.locator('#quote-editor').click();
    await page.keyboard.type('The obstacle is the way.');

    const field = page.locator('#quote-subjects');
    await field.locator('[data-ai-run]').click();

    await expect(page.locator('#sheet-error')).toBeVisible();
    await expect(field.locator('[data-ai-label]')).toHaveText('Suggest with AI');
    await expect(field.locator('[data-ai-run]')).toBeEnabled();
  });

  test('suggestions merge with what you already typed, never replace it', async ({ page }) => {
    await stubSuggest(page, { proposed: false });
    await newQuote(page);
    await page.locator('#quote-editor').click();
    await page.keyboard.type('The obstacle is the way.');

    const field = page.locator('#quote-subjects');
    const tagField = field.locator('input.tag-input__field');
    await tagField.fill('stoicism');
    await tagField.press('Enter');

    await field.locator('[data-ai-run]').click();
    await expect(subjects(field)).toHaveValue('stoicism, solitude, attention');
  });
});
