// Pairing a song to a piece FROM THE SONG'S OWN SHEET (plan 39, ADR 0034).
//
// ⚠ THIS IS THE HALF THAT GREEN CHECKS CANNOT COVER, and GROUND-RULES names the
// class exactly: stacked dialogs, a fetched partial, and an admin session. The
// unit tests pin what the query ASKS for; nothing below the type checker knows
// whether the drawer opens, whether it offers rows the action would refuse, or
// whether a pick that steals another song's slot says so first.
//
// STUBBED WRITES, REAL READS, and the split is deliberate. `songs.pair` and
// `saveWriting` are stubbed — they write real columns on real rows and this
// suite runs against the LIVE project (ADR 0028). The PICKER'S OWN ROWS are
// not: `/admin/fragments-panel?mode=pair` is a GET, so the writing-only
// narrowing is verified against the actual corpus rather than against a fixture
// that would agree with whatever the query happened to do.
import type { actions } from 'astro:actions';
import { expect, test, stubActions, hideDevToolbar, formFields } from './fixtures';

type SongForSheet = Awaited<ReturnType<typeof actions.songs.forSheet.orThrow>>;
type SongsPair = Awaited<ReturnType<typeof actions.songs.pair.orThrow>>;
type SaveWriting = Awaited<ReturnType<typeof actions.fragments.saveWriting.orThrow>>;

const SONG = 'aaaaaaaa-1111-2222-3333-444444444444';
const ESSAY = 'bbbbbbbb-1111-2222-3333-444444444444';
const ISO = '2026-08-12T12:00:00.000Z';
const NEW_PIECE = 'cccccccc-1111-2222-3333-444444444444';
/** Long enough to search, and certain not to match anything in the corpus. */
const NO_MATCH = 'zzq-nothing-matches-this-zzq';

const SEED: SongForSheet = {
  id: SONG,
  title: 'Blue in Green',
  artist: 'Miles Davis',
  url: 'https://open.spotify.com/track/0000000000000000000000',
  paired: [{ id: ESSAY, title: 'A piece that already has it', status: 'draft' }],
  // No embed: an iframe to Spotify on every run is a third party this suite
  // does not need, and nothing here is about the player.
  embed: { src: '', height: 0, allow: '' },
};

/**
 * Open the song sheet on SEED, where the pairing lives.
 *
 * ⚠ IT USED TO CROSS TO A `Facts` TAB, AND THE TAB IS GONE ON PURPOSE.
 * `a song is not a fragment` deleted `songs.setNotes` and with it the Notes
 * pane, which left this sheet with ONE panel — so the tab strip went too, on the
 * rule that a strip over a single pane says there is somewhere else to go. The
 * pairing is simply on screen when the sheet opens now.
 */
async function openSheet(page: import('@playwright/test').Page, seed: SongForSheet = SEED) {
  const pairs: { fragment_id: string; song_id?: string }[] = [];
  const created: Record<string, string>[] = [];
  await stubActions(page, {
    'songs.forSheet': (): SongForSheet => seed,
    'songs.pair': (req): SongsPair => {
      pairs.push(req.postDataJSON());
      return { ok: true, songId: SONG };
    },
    // Two things this one line got wrong on the first draft, both worth keeping:
    //
    // ⚠ THE RETURN IS NOT CAST. These types are imported from `astro:actions`
    // precisely so a drifted action is a red typecheck rather than a spec
    // quietly imitating a shape that no longer exists — and `as SaveWriting`
    // papered over a missing `updated_at`, which is the exact hole the import
    // exists to close.
    // ⚠ THE REQUEST IS READ WITH `formFields`, NOT `postDataJSON`. `saveWriting`
    // is `accept: 'form'`, so the client sends a real FormData and the browser
    // encodes it multipart; `postDataJSON()` throws on it outright.
    'fragments.saveWriting': (req): SaveWriting => {
      created.push(formFields(req));
      return { id: NEW_PIECE, slug: 'zzq-a-new-piece', updated_at: ISO };
    },
  });
  await page.goto('/admin/fragments');
  await hideDevToolbar(page);
  // The documented row → editor seam (`scripts/open-editor.ts`): a row says
  // WHICH song it wants opened and never names a surface. Using it here means
  // the spec does not depend on which of the two lists a given song sits in.
  await page.evaluate((id) => document.dispatchEvent(new CustomEvent('song:edit', { detail: { id } })), SONG);
  const sheet = page.locator('#song-sheet');
  await expect(sheet).toBeVisible();
  return { sheet, pairs, created };
}

test.describe('the song sheet’s paired list', () => {
  test('lists each piece with its status and its own Unpair', async ({ page }) => {
    const { sheet } = await openSheet(page);
    const row = sheet.locator('#sng-paired li');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('A piece that already has it');
    await expect(row).toContainText('draft');
    // ⚠ NAMED PER ROW, not one ✕ for the list. Unpairing writes to an essay you
    // are not looking at, so the control has to say which one it removes.
    await expect(row.getByRole('button', { name: 'Unpair A piece that already has it' })).toBeVisible();
  });

  test('the door is there even with nothing paired — it is a door, not a summary', async ({ page }) => {
    const { sheet } = await openSheet(page, { ...SEED, paired: [] });
    await expect(sheet.locator('#sng-paired-none')).toBeVisible();
    await expect(sheet.locator('#sng-pair-add')).toBeVisible();
  });
});

test.describe('the pairing picker', () => {
  test('opens on top of the sheet and offers WRITING ONLY', async ({ page }) => {
    const { sheet } = await openSheet(page);
    await sheet.locator('#sng-pair-add').click();

    const drawer = page.locator('#pair-browser');
    await expect(drawer).toBeVisible();
    // ⚠ THE SHEET IS STILL OPEN UNDERNEATH, which is the whole feature: closing
    // it destroys the iframe, and the point of pairing from here is that the
    // music does not stop.
    await expect(page.locator('#song-sheet')).toBeVisible();

    const rows = drawer.locator('tr.fragment-row');
    await expect(rows.first()).toBeVisible();
    // Against the real corpus: `songs.pair` filters its update to writing, so a
    // quote or a song in here would be an offer the action declines.
    const types = await rows.evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.type))]);
    expect(types).toEqual(['writing']);
  });

  test('has no cart — one foreign key is not a multi-select', async ({ page }) => {
    const { sheet } = await openSheet(page);
    await sheet.locator('#sng-pair-add').click();
    const drawer = page.locator('#pair-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();
    await expect(drawer.locator('.row-check')).toHaveCount(0);
    await expect(drawer.locator('.select-all')).toHaveCount(0);
    await expect(drawer.locator('.fb-bulkbar')).toHaveCount(0);
  });

  test('drops the type segments and the quote-only filters', async ({ page }) => {
    const { sheet } = await openSheet(page);
    await sheet.locator('#sng-pair-add').click();
    const drawer = page.locator('#pair-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();
    // Every segment would report the same number as All — a control whose
    // options are indistinguishable is a dead one, not a narrow one.
    await expect(drawer.getByRole('radiogroup', { name: 'Filter by type' })).toHaveCount(0);
    // `author_id`/`work_id` are provenance columns only a quote fills in.
    await expect(drawer.locator('select[name="author"]')).toHaveCount(0);
    await expect(drawer.locator('select[name="work"]')).toHaveCount(0);
    // Subjects stay: writing carries those.
    await expect(drawer.locator('subject-filter')).toHaveCount(1);
  });

  test('a row click pairs instead of opening an editor (ruling 5)', async ({ page }) => {
    const { sheet, pairs } = await openSheet(page);
    await sheet.locator('#sng-pair-add').click();
    const drawer = page.locator('#pair-browser');
    // A row nothing else holds, so the pick is not a collision.
    const free = drawer.locator('tr.fragment-row:not([data-paired]):not([data-paired-to])').first();
    await expect(free).toBeVisible();
    // ⚠ PIN IT BY ID BEFORE PRESSING. The selector above excludes `[data-paired]`
    // — which is exactly what the press adds — so re-resolving it afterwards
    // silently hands back the NEXT unpaired row and asserts against a row
    // nobody touched. Cost this spec one confusing red.
    const id = (await free.getAttribute('data-id'))!;
    const title = (await free.locator('.row-open').textContent())!.trim();
    const picked = drawer.locator(`tr.fragment-row[data-id="${id}"]`);
    await free.locator('.row-open').click();

    // ⚠ The Fragment Manager mounts a writing sheet too, so the composer's
    // "click opens the editor" convention would have opened nothing at all.
    await expect(page.locator('#writing-sheet')).toHaveCount(0);
    await expect.poll(() => pairs.length).toBe(1);
    await expect(picked).toHaveAttribute('data-paired', '');
    await expect(picked).toHaveClass(/opacity-45/);
    // And the sheet behind it already says so — the list repaints from the row
    // that was picked rather than refetching the song.
    const listed = sheet.locator('#sng-paired li');
    await expect(listed).toHaveCount(2);
    await expect(listed.last()).toContainText(title);
  });

  test('a pick that would steal another song’s slot names it first (ruling 2)', async ({ page }) => {
    const { sheet, pairs } = await openSheet(page);
    await sheet.locator('#sng-pair-add').click();
    const drawer = page.locator('#pair-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();

    // Against live: 46 of the 48 songs arrived AS pairings, so pieces already
    // holding one are the normal case rather than a contrivance.
    const held = drawer.locator('tr.fragment-row[data-paired-to]').first();
    test.skip((await held.count()) === 0, 'no piece in the corpus currently holds another song');
    const other = (await held.getAttribute('data-paired-to'))!;
    const id = (await held.getAttribute('data-id'))!;
    const picked = drawer.locator(`tr.fragment-row[data-id="${id}"]`);

    // ⚠ THE CONTROL SAYS IT TOO. ＋ would be a lie on a row whose slot is full.
    await expect(held.locator('[data-act="pair"]')).toHaveText('Replace');
    await held.locator('.row-open').click();

    const confirm = page.getByRole('dialog', { name: /Replace the song\?/i });
    await expect(confirm).toBeVisible();
    // The sentence names what is being taken — the whole difference between a
    // steal that is possible and one that is silent.
    await expect(confirm).toContainText(other);

    // Backing out writes nothing and leaves the row exactly as it was.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    expect(pairs).toHaveLength(0);
    await expect(picked).not.toHaveAttribute('data-paired', '');
  });

  test('offers to start a piece that does not exist yet, titled with what you typed', async ({ page }) => {
    const { sheet } = await openSheet(page);
    await sheet.locator('#sng-pair-add').click();
    const drawer = page.locator('#pair-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();

    const bar = drawer.locator('.fb-createbar');
    await expect(bar).toBeHidden();
    await drawer.locator('input[name="q"]').fill(NO_MATCH);
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(NO_MATCH);
  });

  test('creating it is one saveWriting, as a DRAFT, then the pair (rulings 6 and 7)', async ({ page }) => {
    const { sheet, pairs, created } = await openSheet(page);
    await sheet.locator('#sng-pair-add').click();
    const drawer = page.locator('#pair-browser');
    await expect(drawer.locator('tr.fragment-row').first()).toBeVisible();
    await drawer.locator('input[name="q"]').fill(NO_MATCH);
    await expect(drawer.locator('.fb-createbar')).toBeVisible();
    await drawer.locator('.fb-create').click();

    // ⚠ NO EDITOR OPENS. The expensive path (Add ▾ → the writing sheet →
    // `data-place-in`) was assumed by the plan and was never required.
    await expect(page.locator('#writing-sheet')).toHaveCount(0);

    await expect.poll(() => created.length).toBe(1);
    const fields = created[0];
    expect(fields.title).toBe(NO_MATCH);
    // Minted client-side, so the pair below can name it without a round trip.
    expect(fields.id).toMatch(/^[0-9a-f-]{36}$/);
    // ⚠ A DRAFT, NOT A NOTE (ruling 7). `scoped()` drops notes unconditionally,
    // so a note would vanish from this picker the instant it was made — and a
    // note is a dump of WORDS, of which this has none.
    expect(fields.status).toBe('draft');

    // Then the pairing, against the id the client minted.
    await expect.poll(() => pairs.length).toBe(1);
    expect(pairs[0].fragment_id).toBe(NEW_PIECE);
    expect(pairs[0].song_id).toBe(SONG);

    // And the sheet behind it says so without being refetched.
    const listed = sheet.locator('#sng-paired li');
    await expect(listed).toHaveCount(2);
    await expect(listed.last()).toContainText(NO_MATCH);
  });
});
