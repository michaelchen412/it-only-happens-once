// Plan 07 follow-up: getting back INTO a version's words.
//
// The Versions panel shipped with Read / Promote / Keep / Delete, which left
// the obvious next move missing. After a crash you could read your rewrite but
// not continue it — Promote publishes immediately, so the only way back into
// the editor was copy-paste out of the preview. These specs drive the way out,
// and specifically the guard on it: editing a published piece always resumes
// into the ONE working version, so loading a kept variant destroys whatever
// that version was holding.
//
// FULLY STUBBED at `/_actions/**` — every response below is invented here, so
// no request reaches the live project. That's the same read-only property
// write-signals.spec.ts keeps, and it matters more here: this flow needs a
// published piece that already HAS versions, and making one up is far safer
// than finding one in Michael's corpus and rewriting it.
import { test, expect, type Page } from '@playwright/test';
import type { actions } from 'astro:actions';
import { stubActions } from './fixtures';

/**
 * The shapes below are canned, which is the one real weakness of stubbing: a
 * hand-copied response keeps a spec green after the action it imitates has
 * changed underneath it. Tying each stub to the action's own return type moves
 * that from "I read the handler carefully" to a compile error.
 */
type Returns<T> = T extends (...a: never[]) => Promise<infer R>
  ? R extends { data: infer D }
    ? NonNullable<D> // the error arm of the result union contributes `never`
    : never
  : never;
type FragmentGet = Returns<typeof actions.fragments.get>;
type VersionsList = Returns<typeof actions.versions.list>;
type VersionsGet = Returns<typeof actions.versions.get>;

const FRAGMENT = '11111111-1111-4111-8111-111111111111';
const WORKING = '22222222-2222-4222-8222-222222222222';
const KEPT = '33333333-3333-4333-8333-333333333333';

const LIVE_BODY = 'The opening readers can see right now.';
const WORKING_BODY = 'A rewrite that was still in progress when the tab died.';
const KEPT_BODY = 'An older opening, set aside as a variant.';
const ISO = '2026-07-30T12:00:00.000Z';

const BODIES: Record<string, string> = { [WORKING]: WORKING_BODY, [KEPT]: KEPT_BODY };

function listed(id: string, kind: 'working' | 'snapshot', label: string): VersionsList['versions'][number] {
  return {
    id,
    kind,
    label,
    title: 'A published piece',
    preview: BODIES[id],
    createdAt: ISO,
    updatedAt: ISO,
    matchesCanonical: false,
  };
}

/**
 * Open a published piece with versions, on the Versions tab.
 *
 * `pendingRewrite: false` drops the working version — the case where nothing is
 * at risk, which is how we check the guard doesn't fire when it shouldn't.
 * Returns the bodies of every `saveWorking` the sheet subsequently attempts,
 * which is what proves resume actually armed the autosave.
 */
async function openVersions(page: Page, { pendingRewrite = true } = {}) {
  const saved: string[] = [];
  const versions = [
    ...(pendingRewrite ? [listed(WORKING, 'working', '')] : []),
    listed(KEPT, 'snapshot', 'Kept 20 July'),
  ];
  const seen = await stubActions(page, {
    'fragments.get': (): FragmentGet => ({
      id: FRAGMENT,
      type: 'writing',
      title: 'A published piece',
      slug: 'a-published-piece',
      excerpt: 'A blurb.',
      body: LIVE_BODY,
      status: 'published',
      occurredIso: ISO,
      updatedAt: ISO,
      subjects: '',
      constellationIds: [],
      paired: null, // no paired song (ADR-0009) — not what these specs are about
    }),
    'versions.list': (): VersionsList => ({
      canonical: { title: 'A published piece', preview: LIVE_BODY, updatedAt: ISO },
      versions,
    }),
    'versions.get': (req): VersionsGet => {
      const { id } = req.postDataJSON() as { id: string };
      return {
        id,
        fragmentId: FRAGMENT,
        kind: id === WORKING ? 'working' : 'snapshot',
        label: id === WORKING ? '' : 'Kept 20 July',
        title: 'A published piece',
        excerpt: 'A blurb.',
        body: BODIES[id],
        createdAt: ISO,
        updatedAt: ISO,
      };
    },
    // multipart, so read it as text: the field values appear verbatim.
    'versions.saveWorking': (req) => {
      saved.push(req.postData() ?? '');
      return { id: WORKING, updatedAt: ISO };
    },
  });

  await page.goto(`/admin/fragments#edit=${FRAGMENT}`);
  await expect(page.locator('#wsheet')).toBeVisible();
  await expect(page.locator('#ws-editor .tiptap-doc')).toContainText(LIVE_BODY);
  await page.locator('#wsheet [data-tab="versions"]').click();
  await expect(page.locator('#ws-ver-list')).toBeVisible();
  return { saved, seen };
}

const doc = (page: Page) => page.locator('#ws-editor .tiptap-doc');
const item = (page: Page, id: string) => page.locator(`#ws-ver-list [data-ver="${id}"]`);
const confirm = (page: Page) => page.locator('#confirm-dialog');

test.describe('resuming a draft version', () => {
  test('the crash case: the pending rewrite goes back in the editor, no questions asked', async ({ page }) => {
    const { saved, seen } = await openVersions(page);

    // The button that didn't exist: reading it was never the problem.
    const resume = item(page, WORKING).locator('[data-act="resume"]');
    await expect(resume).toHaveText('Resume editing');
    await resume.click();

    // Back on the writing, holding the rewrite rather than what's published.
    await expect(page.locator('#wsheet [data-tab="doc"]')).toHaveAttribute('aria-selected', 'true');
    await expect(doc(page)).toContainText(WORKING_BODY);
    await expect(doc(page)).not.toContainText(LIVE_BODY);
    // Resuming your own pending rewrite risks nothing, so it must not prompt.
    await expect(confirm(page)).toBeHidden();

    // The bar tells the truth immediately — these words came off the server, so
    // it doesn't have to wait a debounce before claiming they're held.
    await expect(page.locator('#ws-status-text')).toHaveText('Kept as a draft version · not public yet');
    await expect(page.locator('#ws-save-changes')).toBeEnabled();

    // And it's a live edit again, not a read-only paste: the autosave fires and
    // carries these words. This is the assertion that "you can keep working on
    // them" is true rather than merely visible.
    await expect.poll(() => saved.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(saved[0]).toContain(WORKING_BODY);
    expect(seen(), 'nothing but the composer’s own calls').toEqual(
      expect.arrayContaining(['fragments.get', 'versions.list', 'versions.get', 'versions.saveWorking']),
    );
    // Never the live row: the published piece is unchanged throughout.
    expect(seen()).not.toContain('fragments.saveWriting');
  });

  test('resuming with unsent keystrokes names the right loss', async ({ page }) => {
    // Same button, different risk: here the version is where these words came
    // from, so nothing happens to it — what's at stake is only the typing the
    // debounce hasn't carried yet. A prompt that said "throws away the pending
    // rewrite" would be describing something that isn't going to happen.
    await openVersions(page);
    await page.locator('#wsheet [data-tab="doc"]').click();
    await doc(page).click();
    await page.keyboard.type(' Something typed just now.');

    await page.locator('#wsheet [data-tab="versions"]').click();
    await item(page, WORKING).locator('[data-act="resume"]').click();

    await expect(confirm(page)).toBeVisible();
    await expect(page.locator('#confirm-title')).toHaveText('Go back to the saved rewrite?');
    await expect(page.locator('#confirm-message')).toContainText('replaces what’s in the editor');
    await expect(page.locator('#confirm-message')).not.toContainText('throws away');
  });

  test('starting from a kept variant warns that it replaces the pending rewrite', async ({ page }) => {
    const { saved } = await openVersions(page);

    const start = item(page, KEPT).locator('[data-act="resume"]');
    await expect(start).toHaveText('Edit from this'); // you were never editing it
    await start.click();

    await expect(confirm(page)).toBeVisible();
    await expect(page.locator('#confirm-title')).toHaveText('Replace the pending rewrite?');
    await page.locator('#confirm-cancel').click();

    // Declining changes nothing at all.
    await page.locator('#wsheet [data-tab="doc"]').click();
    await expect(doc(page)).toContainText(LIVE_BODY);
    await expect(doc(page)).not.toContainText(KEPT_BODY);
    expect(saved, 'a declined prompt must not have written a version').toHaveLength(0);
  });

  test('…and confirming loads the variant, and it becomes the working version', async ({ page }) => {
    const { saved } = await openVersions(page);

    await item(page, KEPT).locator('[data-act="resume"]').click();
    await expect(confirm(page)).toBeVisible();
    await page.locator('#confirm-ok').click();

    await expect(doc(page)).toContainText(KEPT_BODY);
    await expect.poll(() => saved.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(saved[0]).toContain(KEPT_BODY);
  });

  test('with no pending rewrite, a kept variant loads without a prompt', async ({ page }) => {
    // The guard has to be quiet when there is nothing to lose, or it becomes a
    // click people learn to dismiss without reading.
    const { saved } = await openVersions(page, { pendingRewrite: false });

    await item(page, KEPT).locator('[data-act="resume"]').click();

    await expect(doc(page)).toContainText(KEPT_BODY);
    await expect(confirm(page)).toBeHidden();
    await expect.poll(() => saved.length, { timeout: 5000 }).toBeGreaterThan(0);
  });
});
