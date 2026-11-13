// The Music tab of the writing sheet — one link on the piece (ADR 0044).
//
// STUBBED, deliberately and with a known limit: `music.set` writes to a real
// column on a real row, and these specs run against the LIVE project. What they
// prove is that the client behaves given a correct response — never that the
// action sends one. The response SHAPE is compile-checked against
// `astro:actions` (`FragmentGet` / `MusicSet` below), so a drifted action is a
// red typecheck rather than a spec quietly imitating something that no longer
// exists. The READ path is covered unstubbed by `essay-music.anon.spec.ts`.
//
// ⚠ AND THAT LIMIT IS WHY THE OLD SONG PICKER BROKE WITHOUT A RED. Its search
// was stubbed here, so for three months the spec answered a query the real
// action could not run (it filtered on a column the songs table did not have).
// A stub records the call you made, not the schema you made it against — the
// unit tests in `media.test.ts` pin the parser that `music.set` shares with
// this tab, which is the part a stub cannot.
import type { actions } from 'astro:actions';
import { expect, test, fixtures, stubActions } from './fixtures';

type FragmentGet = Awaited<ReturnType<typeof actions.fragments.get.orThrow>>;
type MusicSet = Awaited<ReturnType<typeof actions.music.set.orThrow>>;

const FRAGMENT = '11111111-2222-3333-4444-555555555555';
const ISO = '2023-07-20T12:00:00.000Z';
const TRACK = 'https://open.spotify.com/track/697MdxMbVWn1Ajbw8iaPv5';
const PLAYLIST = 'https://open.spotify.com/playlist/2wQlYWCZpxDvO7UAWEUSY5';
/**
 * ⚠ `about:blank`, not a real embed, so no spec waits on Spotify. The fragment
 * keeps two embeds distinguishable — the player is replaced only when the
 * SOURCE changes, and that is one of the things under test.
 */
const embed = (tag: string) => ({ src: `about:blank#${tag}`, height: 152, allow: 'autoplay; encrypted-media' });

/** Open the composer on a piece whose music starts as `music`. */
async function openSheet(page: import('@playwright/test').Page, music: FragmentGet['music']) {
  const { constellationId } = fixtures();
  test.skip(!constellationId, 'no constellation to reach the composer from');

  const setCalls: Array<string | null> = [];
  const seen = await stubActions(page, {
    'fragments.get': (): FragmentGet => ({
      id: FRAGMENT,
      type: 'writing',
      title: 'A piece with music',
      slug: 'a-piece-with-music',
      excerpt: '',
      body: 'Some words.',
      status: 'draft',
      occurredIso: ISO,
      updatedAt: ISO,
      subjects: '',
      constellationIds: [],
      music,
    }),
    'music.set': (req): MusicSet => {
      const body = JSON.parse(req.postData() || '{}') as { url?: string };
      setCalls.push(body.url ?? null);
      // What the server does: canonicalise, so the `?si=` token never lands.
      const url = body.url ? body.url.replace(/\?.*$/, '') : null;
      return { url, embed: url ? embed(url.includes('playlist') ? 'playlist' : 'track') : null };
    },
    // The sheet asks for these on open; answer them so nothing aborts.
    'versions.list': () => ({ canonical: null, versions: [] }),
  });

  await page.goto(`/admin/constellations/${constellationId}#edit=${FRAGMENT}`);
  await expect(page.locator('#wsheet')).toBeVisible();
  return { seen, setCalls };
}

const field = (page: import('@playwright/test').Page) => page.locator('#ws-music-url');
const player = (page: import('@playwright/test').Page) => page.locator('#ws-music-player iframe');

test.describe('the Music tab', () => {
  test('shows the link a piece already carries, with its player', async ({ page }) => {
    await openSheet(page, { url: TRACK, embed: embed('track') });

    // The tab carries a mark, not a count — a piece carries one link.
    await expect(page.locator('#ws-music-mark')).toHaveText('·');

    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(field(page)).toHaveValue(TRACK);
    await expect(player(page)).toHaveAttribute('src', 'about:blank#track');
    await expect(page.locator('#ws-music-clear')).toBeVisible();
  });

  test('a piece with no music has an empty field, no player and no mark', async ({ page }) => {
    await openSheet(page, null);
    await expect(page.locator('#ws-music-mark')).toHaveText('');
    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(field(page)).toHaveValue('');
    await expect(player(page)).toHaveCount(0);
    await expect(page.locator('#ws-music-clear')).toBeHidden();
  });

  test('pasting a link saves it at once, and the field shows what was stored', async ({ page }) => {
    const { setCalls } = await openSheet(page, null);
    await page.getByRole('tab', { name: /Music/ }).click();

    // A paste is the whole gesture: no button, no Enter.
    await field(page).fill(`${PLAYLIST}?si=715df3742f3a4825`);
    await field(page).dispatchEvent('paste');

    await expect(page.locator('#ws-music-status')).toHaveText('Saved.');
    // Canonical — the share sheet's tracking token is gone from the field.
    await expect(field(page)).toHaveValue(PLAYLIST);
    await expect(player(page)).toHaveAttribute('src', 'about:blank#playlist');
    await expect(page.locator('#ws-music-mark')).toHaveText('·');
    expect(setCalls).toEqual([`${PLAYLIST}?si=715df3742f3a4825`]);
  });

  test('a link that cannot play is refused before any round trip', async ({ page }) => {
    const { seen } = await openSheet(page, null);
    await page.getByRole('tab', { name: /Music/ }).click();

    await field(page).fill('https://open.spotify.com/episode/4bZZ2sLZTGaQMRVfNJTHKz');
    await field(page).press('Enter');

    await expect(page.locator('#ws-music-error')).toContainText('can’t play here');
    // Kept, so you can see what was refused.
    await expect(field(page)).toHaveValue(/episode/);
    expect(seen()).not.toContain('music.set');
  });

  test('Remove clears it, and sends an empty link', async ({ page }) => {
    const { setCalls } = await openSheet(page, { url: TRACK, embed: embed('track') });
    await page.getByRole('tab', { name: /Music/ }).click();

    await page.locator('#ws-music-clear').click();

    await expect(page.locator('#ws-music-status')).toHaveText('Removed.');
    await expect(field(page)).toHaveValue('');
    await expect(player(page)).toHaveCount(0);
    await expect(page.locator('#ws-music-mark')).toHaveText('');
    expect(setCalls).toEqual([null]);
  });

  test('Enter saves, and does not submit the sheet', async ({ page }) => {
    const { seen, setCalls } = await openSheet(page, null);
    await page.getByRole('tab', { name: /Music/ }).click();
    await field(page).fill(TRACK);
    await field(page).press('Enter');

    await expect(page.locator('#ws-music-status')).toHaveText('Saved.');
    await expect(page.locator('#wsheet')).toBeVisible();
    expect(setCalls).toEqual([TRACK]);
    expect(seen()).not.toContain('fragments.saveWriting');
  });

  test('a never-saved piece says to save first, instead of a field that does nothing', async ({ page }) => {
    const { constellationId } = fixtures();
    test.skip(!constellationId, 'no constellation to reach the composer from');
    // #new-writing mints an id client-side but writes no row, so there is
    // nothing for `music.set` to update.
    const seen = await stubActions(page, {});
    await page.goto(`/admin/constellations/${constellationId}#new-writing`);
    await expect(page.locator('#wsheet')).toBeVisible();

    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(page.locator('#ws-music-status')).toContainText('Save this piece first');
    await expect(field(page)).toBeDisabled();
    expect(seen()).not.toContain('music.set');
  });
});
