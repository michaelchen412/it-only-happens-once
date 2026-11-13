// Opening a fragment actually LOADS it — the round trip, against the real
// schema, not a stub.
//
// ⚠ THIS IS THE BLIND SPOT THAT LET A BROKEN QUERY SHIP. Every other spec that
// opens an editor stubs `/_actions/**`, because this suite runs against the live
// database and read-only is enforced by default (fixtures.ts). That is the right
// guarantee and it has one consequence nobody had written down: **no spec had
// ever executed `fragments.get`.** So the sheet could be opened, measured,
// screenshotted and asserted on in a dozen places while the one call that fills
// it was rejected by PostgREST, and the whole suite stayed green.
//
// It went wrong the moment it could. ADR 0035 moved songs out of `fragments`
// into a table of their own; `songs` has `artist` and no `deleted_at`, where
// the old song-fragment had `attribution` and inherited soft delete. The sweep
// updated `PAIRED_SELECT` in lib/blog.ts and every reader of it — but
// `fragments.get` had quietly hand-rolled a SECOND copy of that embed, so it
// went on asking for two columns that no longer exist. PostgREST rejected the
// select, the handler answered `error || !data` with "That fragment no longer
// exists", and Michael went looking at a database that was perfectly fine:
// *"data is fine in database."*
//
// So this spec allows exactly one action, by name, and only ever reads.
// `fragments.get` writes nothing — it is a SELECT behind `requireAdmin` — which
// is what makes the opt-out honest rather than a hole in the guarantee.
import { test, expect, allowActions, fixtures } from './fixtures';

test.describe('a fragment opens with its contents', () => {
  test('a writing fragment loads its body instead of an error', async ({ page }) => {
    await page.goto('/admin/fragments');
    // ⚠ NAMED, not a blanket lift. `fragments.get` is a read; nothing else on
    // this page is allowed through, so an autosave still cannot reach the
    // database if one fires.
    await allowActions(page, ['fragments.get']);

    const row = page.locator('tr[data-writing] .row-open').first();
    await row.waitFor();
    const title = (await row.innerText()).trim();
    await row.click();

    await expect(page.locator('#wsheet')).toHaveJSProperty('open', true);

    // ⚠ ASSERT ON THE ERROR LINE FIRST, and by its TEXT. The failure this guards
    // rendered a perfectly good sheet with an empty editor and one red sentence
    // — so "the sheet opened" and "the title is filled" both passed against the
    // bug. What did not was this.
    const err = page.locator('#ws-error');
    await expect(err).toBeHidden();

    // The round trip landed: the sheet is showing THIS row, not a blank one.
    await expect(page.locator('#wsheet input[name="title"]')).toHaveValue(title);
    await expect(page.locator('#wsheet .tiptap')).not.toBeEmpty();
  });

  test('an essay that carries music loads its link and player, not a rejected select', async ({ page }) => {
    // ⚠ THE MUSIC IS THE POINT. An essay without any exercises nothing about
    // it: the select still names the column and would still fail, but a row
    // with no music proves only that the row exists. (The column was a
    // `paired_song` embed until ADR 0044, and that embed is what broke once —
    // asking `songs` for an `attribution` column it did not have.)
    const { musicEssayId } = fixtures();
    test.skip(!musicEssayId, 'no essay in the database carries music');

    await allowActions(page, ['fragments.get']);
    // `#edit=<id>` is the manager's own deep link — the same one the notes room
    // hands you after "make it a piece". It opens the sheet on arrival, so the
    // action has to be allowed before navigating.
    await page.goto(`/admin/fragments#edit=${musicEssayId}`);
    await expect(page.locator('#wsheet')).toHaveJSProperty('open', true);
    await expect(page.locator('#ws-error')).toBeHidden();

    // ⚠ THE MUSIC TAB IS FILLED FROM THE SAME `get` RESPONSE, so a dropped
    // column empties it WITHOUT SAYING SO: an empty field on an essay that has
    // music reads exactly like an essay that hasn't. That silence is why this
    // asserts on the value rather than on the absence of an error.
    await page.locator('#wsheet [data-tab="music"]').click();
    await expect(page.locator('#ws-music-url')).toHaveValue(/^https:\/\/(open\.spotify\.com|www\.youtube\.com)\//);
    await expect(page.locator('#ws-music-player iframe')).toHaveCount(1);
  });
});
