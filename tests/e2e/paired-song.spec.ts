// The Music tab of the writing sheet — pairing one song to one essay
// (ADR-0009 "paired media", docs/plans/04 Piece 3).
//
// STUBBED, deliberately and with a known limit: `songs.pair` writes to a real
// column on a real row, and these specs run against the LIVE project. What they
// prove is that the client behaves given a correct response — never that the
// action sends one. The response SHAPE is compile-checked against
// `astro:actions` (see `SongsSearch` / `SongsPair` below), so a drifted action
// is a red typecheck rather than a spec quietly imitating something that no
// longer exists. The response CONTENT is verified separately, against live, in
// the paired-media probe.
import type { actions } from 'astro:actions';
import { expect, test, fixtures, stubActions } from './fixtures';

type FragmentGet = Awaited<ReturnType<typeof actions.fragments.get.orThrow>>;
type SongsSearch = Awaited<ReturnType<typeof actions.songs.search.orThrow>>;
type SongsPair = Awaited<ReturnType<typeof actions.songs.pair.orThrow>>;

const FRAGMENT = '11111111-2222-3333-4444-555555555555';
const SONG_A = 'aaaaaaaa-2222-3333-4444-555555555555';
const SONG_B = 'bbbbbbbb-2222-3333-4444-555555555555';
const ISO = '2023-07-20T12:00:00.000Z';

const CATALOGUE: SongsSearch = [
  { id: SONG_A, title: 'Last Birthday', artist: 'Valley', annotated: false },
  { id: SONG_B, title: 'Hush', artist: 'Bob Reynolds', annotated: true },
];

/** Open the composer on a piece whose pairing starts as `paired`. */
async function openSheet(page: import('@playwright/test').Page, paired: FragmentGet['paired']) {
  const { constellationId } = fixtures();
  test.skip(!constellationId, 'no constellation to reach the composer from');

  const pairCalls: Array<string | null> = [];
  const seen = await stubActions(page, {
    'fragments.get': (): FragmentGet => ({
      id: FRAGMENT,
      type: 'writing',
      title: 'A piece with a song',
      slug: 'a-piece-with-a-song',
      excerpt: '',
      body: 'Some words.',
      status: 'draft',
      occurredIso: ISO,
      updatedAt: ISO,
      subjects: '',
      constellationIds: [],
      paired,
    }),
    'songs.search': (): SongsSearch => CATALOGUE,
    'songs.pair': (req): SongsPair => {
      const body = JSON.parse(req.postData() || '{}') as { song_id?: string };
      pairCalls.push(body.song_id ?? null);
      return { ok: true, songId: body.song_id ?? null };
    },
    // The sheet asks for these on open; answer them so nothing aborts.
    'versions.list': () => ({ canonical: null, versions: [] }),
  });

  await page.goto(`/admin/constellations/${constellationId}#edit=${FRAGMENT}`);
  await expect(page.locator('#wsheet')).toBeVisible();
  return { seen, pairCalls };
}

test.describe('pairing a song to an essay', () => {
  test('the Music tab shows what is already paired', async ({ page }) => {
    await openSheet(page, { id: SONG_A, title: 'Last Birthday', artist: 'Valley' });

    // The tab carries a mark, not a count — there is only ever one paired song.
    await expect(page.locator('#ws-music-mark')).toHaveText('·');

    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(page.locator('#ws-music-name')).toHaveText('♪ Last Birthday — Valley');
    await expect(page.locator('#ws-music-none')).toBeHidden();
    await expect(page.locator('#ws-music-clear')).toBeVisible();
  });

  test('an unpaired piece says so, and carries no mark', async ({ page }) => {
    await openSheet(page, null);
    await expect(page.locator('#ws-music-mark')).toHaveText('');
    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(page.locator('#ws-music-none')).toBeVisible();
    await expect(page.locator('#ws-music-clear')).toBeHidden();
  });

  test('the list loads only when the tab is opened, not on open', async ({ page }) => {
    const { seen } = await openSheet(page, null);
    // The sheet has loaded the piece by now; nobody has asked for songs.
    expect(seen()).toContain('fragments.get');
    expect(seen()).not.toContain('songs.search');

    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(page.locator('#ws-music-results li')).toHaveCount(2);
    expect(seen()).toContain('songs.search');
  });

  test('picking a song pairs it immediately — no save', async ({ page }) => {
    const { pairCalls } = await openSheet(page, null);
    await page.getByRole('tab', { name: /Music/ }).click();

    await page.getByRole('button', { name: /Hush/ }).click();

    await expect(page.locator('#ws-music-name')).toHaveText('♪ Hush — Bob Reynolds');
    await expect(page.locator('#ws-music-mark')).toHaveText('·');
    expect(pairCalls).toEqual([SONG_B]);
  });

  test('Unpair clears it, and sends an explicit empty pairing', async ({ page }) => {
    const { pairCalls } = await openSheet(page, { id: SONG_A, title: 'Last Birthday', artist: 'Valley' });
    await page.getByRole('tab', { name: /Music/ }).click();

    await page.locator('#ws-music-clear').click();

    await expect(page.locator('#ws-music-none')).toBeVisible();
    await expect(page.locator('#ws-music-mark')).toHaveText('');
    expect(pairCalls).toEqual([null]);
  });

  test('the annotated song is marked as such', async ({ page }) => {
    await openSheet(page, null);
    await page.getByRole('tab', { name: /Music/ }).click();
    // "Hush" has a body; "Last Birthday" doesn't. After the backfill most songs
    // say nothing, so the few that speak are worth pointing at.
    await expect(page.getByRole('button', { name: /Hush/ })).toContainText('annotated');
    await expect(page.getByRole('button', { name: /Last Birthday/ })).not.toContainText('annotated');
  });

  test('a never-saved piece says to save first, instead of an empty list', async ({ page }) => {
    const { constellationId } = fixtures();
    test.skip(!constellationId, 'no constellation to reach the composer from');
    // #new-writing mints an id client-side but writes no row, so there is
    // nothing for `pair` to update — the panel has to say so rather than offer
    // a search box that quietly does nothing.
    const seen = await stubActions(page, { 'songs.search': (): SongsSearch => CATALOGUE });
    await page.goto(`/admin/constellations/${constellationId}#new-writing`);
    await expect(page.locator('#wsheet')).toBeVisible();

    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(page.locator('#ws-music-results')).toContainText('Save this piece first');
    await expect(page.locator('#ws-music-q')).toBeDisabled();
    expect(seen()).not.toContain('songs.search');
  });

  test('searching filters through the action, not in the browser', async ({ page }) => {
    const { seen } = await openSheet(page, null);
    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(page.locator('#ws-music-results li')).toHaveCount(2);

    const before = seen().filter((n) => n === 'songs.search').length;
    await page.locator('#ws-music-q').fill('hush');
    // Debounced at 200ms — the point is that it re-asks the server rather than
    // filtering a list it already has, so the 20-row cap stays meaningful.
    await expect.poll(() => seen().filter((n) => n === 'songs.search').length).toBeGreaterThan(before);
  });

  test('Enter in the search field does not submit the sheet', async ({ page }) => {
    const { seen } = await openSheet(page, null);
    await page.getByRole('tab', { name: /Music/ }).click();
    await page.locator('#ws-music-q').fill('hush');
    await page.locator('#ws-music-q').press('Enter');

    // The sheet is still open and nothing tried to save the document.
    await expect(page.locator('#wsheet')).toBeVisible();
    expect(seen()).not.toContain('fragments.saveWriting');
  });
});
