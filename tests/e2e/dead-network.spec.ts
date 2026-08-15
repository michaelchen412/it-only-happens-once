// The offline-save class, driven (docs/plans/25 · "The save survives the dead
// network"). `astro:actions` THROWS on a dead network rather than returning
// `{ error }`, and a full-repo audit on 2026-08-08 found nine client scripts
// whose saves had no catch at all — including the worst user-facing bug in the
// tree, the quote/song Save that stuck disabled with nothing on screen.
//
// ⚠ THIS IS THE EXACT CLASS WHERE GREEN CHECKS PROVE NOTHING, which is why it
// gets its own file rather than a line inside somebody else's. Network
// conditions are state no compiler sees; every one of these nine sites had a
// clean typecheck, a clean build and green tests the whole time. What makes it
// testable at all is that `route.abort('failed')` produces the same rejected
// fetch a dead network does, so the failure can be driven rather than reasoned
// about.
//
// READ-ONLY BY CONSTRUCTION, and unusually so: the entire point of every spec
// below is that the write does NOT land. Nothing here can reach the database
// even if a stub were removed, because the stub IS the severed connection.
import type { Page } from '@playwright/test';
import type { actions } from 'astro:actions';
import { expect, test, fixtures, hideDevToolbar, stubActions } from './fixtures';

type SetMembership = Awaited<ReturnType<typeof actions.constellations.setMembership.orThrow>>;
type FragmentGet = Awaited<ReturnType<typeof actions.fragments.get.orThrow>>;
type SongsSearch = Awaited<ReturnType<typeof actions.songs.search.orThrow>>;

/**
 * ⚠ WAIT FOR THE JS, NOT THE MARKUP — the same race `constellation-cell.spec.ts`
 * writes up. Rows are server-rendered long before anything listens on them, and
 * under `astro dev` the module graph is unbundled, so a cold compile leaves a
 * gap wide enough to lose a click in.
 */
async function openManager(page: Page) {
  await page.goto('/admin/fragments');
  await hideDevToolbar(page);
  await expect(page.locator('.fpanel[data-wired]')).toBeAttached();
  await expect(page.locator('#quote-editor .ProseMirror')).toBeAttached();
}

test.describe('the quote sheet — the audit’s one HIGH', () => {
  test('Save comes back and says why, instead of wedging with nothing on screen', async ({ page }) => {
    // No handler for anything → every action aborts, which is what a dead
    // network looks like from the browser's side.
    await stubActions(page, {});
    await openManager(page);
    await page.locator('#add-btn').click();
    await page.locator('#add-menu [data-new="quote"]').click();
    await expect(page.locator('#sheet')).toBeVisible();

    await page.locator('#quote-editor [contenteditable]').fill('Words that will never reach the server.');
    const save = page.locator('#quote-save');
    await expect(save).toBeEnabled();
    await save.click();

    const error = page.locator('#sheet-error');
    // Three separate claims, and before this plan the sheet failed all three:
    // the rejection skipped `disabled = false`, skipped the error line, and
    // skipped the close — so Save sat dead for the life of the sheet.
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();
    await expect(save).toBeEnabled();
    await expect(page.locator('#sheet')).toBeVisible();

    // ⚠ AND THE SENTENCE IS A SENTENCE. `TypeError` extends `Error`, so the
    // hand-rolled `err instanceof Error ? err.message : '…'` idiom prints the
    // raw fetch failure at a human in precisely the case its friendly fallback
    // was written for. That string must never appear here.
    await expect(error).not.toContainText('Failed to fetch');
    await expect(error).not.toContainText('undefined');
  });
});

/*
  ⚠ THIS MOVED ROOMS RATHER THAN GOING AWAY (ADR 0031). The claim used to be
  driven against the quote sheet's song form, which no longer exists — a song
  has its own sheet now, and the paste bar in it owns the `songs.lookup` call.
  The BEHAVIOUR is the reason the spec survives the move: a lookup that throws
  must clear "Looking it up…" and say something, and it is exactly the class
  this file exists for, because a stuck status line has a clean typecheck.
*/
test.describe('the song sheet — the lookup that never answers', () => {
  test('a dead lookup stops saying "Looking it up…" and says what happened', async ({ page }) => {
    // No handler for anything → every action aborts, which is what a dead
    // network looks like from the browser's side.
    await stubActions(page, {});
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    // ⚠ NOT `#lst-new` — /admin/listening is gone (plan 40) and an EMPTY song
    // sheet has no door left, because a song now enters from the essay that
    // wanted it. The URL field and its debounced lookup still exist on an
    // existing song's Facts tab, which is the surface this behaviour lives on
    // now. `song:edit` is the documented row → editor seam.
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent('song:edit', { detail: { id: 'aaaaaaaa-1111-2222-3333-444444444444' } })),
    );
    await expect(page.locator('#song-sheet')).toBeVisible();

    // `input`, not `change`: the paste bar debounces on input (350ms) so the
    // lookup fires while you are still typing rather than when you leave.
    await page.locator('#sng-url').fill('https://open.spotify.com/track/abc');

    const status = page.locator('#sng-status');
    const error = page.locator('#sng-error');
    // The status line clears rather than sitting on "Looking it up…" forever,
    // and the sentence lands in the sheet's own alert.
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();
    await expect(status).not.toHaveText('Looking it up…');

    // ⚠ AND THE SENTENCE IS A SENTENCE. `TypeError` extends `Error`, so the
    // hand-rolled `err instanceof Error ? err.message : '…'` idiom prints the
    // raw fetch failure at a human in precisely the case its friendly fallback
    // was written for. `formatActionError` is what keeps that string out.
    await expect(error).not.toContainText('Failed to fetch');
    await expect(error).not.toContainText('undefined');
    // A dead network is not a bad link, and the sentence has to know the
    // difference — sending you off to re-check a URL that was fine is the
    // wrong instruction.
    await expect(error).not.toContainText('Spotify track');
  });
});

test.describe('the promise chain — the swallowed save, by name', () => {
  test('a failed toggle does not poison every toggle after it', async ({ page }) => {
    // The plan's own hands item, made assertable: "toggle membership offline,
    // then fix the network and toggle again. The second toggle must work."
    //
    // `inFlight` serializes the picker's writes. One REJECTION leaves that
    // promise permanently rejected, so every later `.then` is skipped — and
    // the rest of the session's ticks vanish with no error and no request.
    const calls: string[] = [];
    await stubActions(page, {
      'constellations.setMembership': (): SetMembership => {
        calls.push('setMembership');
        return { ok: true };
      },
    });
    // Registered AFTER the stub, so it wins: Playwright tries the most recent
    // route first. `unroute` below is the network coming back.
    //
    // ⚠ A REGEXP, NOT A GLOB. This project appends a trailing slash
    // (`/_actions/constellations.setMembership/`) and a glob `*` does not cross
    // `/` — so `…setMembership*` silently matches nothing, the stub answers,
    // and the spec passes while proving the opposite of what it says. Watched
    // failing before it was trusted.
    const DEAD = /_actions\/constellations\.setMembership/;
    await page.route(DEAD, (route) => route.abort('failed'));

    await openManager(page);
    const row = page.locator('tr.fragment-row[data-fragment]').first();
    test.skip((await row.count()) === 0, 'needs a quote or song row to edit');
    // The membership cell opens the sheet already on its Constellations tab —
    // and, crucially, on an EXISTING fragment, so ticks persist immediately
    // rather than queueing for a first save.
    await row.locator('.cn-cell').click();

    const picker = page.locator('#sheet-panel-cn .cn-picker');
    await expect(picker).toBeVisible();
    const boxes = picker.locator('.cn-row .cn-check');
    test.skip((await boxes.count()) === 0, 'no constellations to toggle');
    const status = picker.locator('.cn-picker-status');

    const first = boxes.first();
    await first.click();
    await expect(status).toHaveClass(/text-error/);
    await expect(status).not.toBeEmpty();

    // The network comes back. Nothing about the picker is re-opened or reset —
    // this is the same sheet, mid-session, which is the whole point.
    await page.unroute(DEAD);
    await first.click();

    await expect(status).toContainText(/Saved|Removed from all/);
    await expect(status).not.toHaveClass(/text-error/);
    expect(calls, 'the second toggle never reached the server — the chain stayed poisoned').toEqual(['setMembership']);
  });
});

test.describe('the optimistic pairing', () => {
  test('rolls back on a THROWN failure, not just a returned one', async ({ page }) => {
    // The panel painted the song as paired and only un-painted itself on the
    // `{ error }` return path — so on a dead network the screen showed a
    // pairing the server had never heard of. An optimistic control that cannot
    // roll back is a lie with a transition on it.
    const { constellationId } = fixtures();
    test.skip(!constellationId, 'no constellation to reach the composer from');

    const FRAGMENT = '11111111-2222-3333-4444-555555555555';
    const SONG = 'aaaaaaaa-2222-3333-4444-555555555555';
    const ISO = '2023-07-20T12:00:00.000Z';

    await stubActions(page, {
      'fragments.get': (): FragmentGet => ({
        id: FRAGMENT,
        type: 'writing',
        title: 'A piece with no song yet',
        slug: 'a-piece-with-no-song-yet',
        excerpt: '',
        body: 'Some words.',
        status: 'draft',
        occurredIso: ISO,
        updatedAt: ISO,
        subjects: '',
        constellationIds: [],
        paired: null,
      }),
      'songs.search': (): SongsSearch => [{ id: SONG, title: 'Hush', artist: 'Bob Reynolds', annotated: false }],
      'versions.list': () => ({ canonical: null, versions: [] }),
      // `songs.pair` is deliberately ABSENT — unhandled means aborted, which is
      // the throw this spec exists for.
    });

    await page.goto(`/admin/constellations/${constellationId}#edit=${FRAGMENT}`);
    await expect(page.locator('#wsheet')).toBeVisible();
    await page.getByRole('tab', { name: /Music/ }).click();
    await expect(page.locator('#ws-music-none')).toBeVisible();

    await page.getByRole('button', { name: /Hush/ }).click();

    await expect(page.locator('#ws-music-error')).toBeVisible();
    // Back to nothing paired — the name, the tab's mark and the "none" line all
    // have to agree with the database, which never heard of this.
    await expect(page.locator('#ws-music-none')).toBeVisible();
    await expect(page.locator('#ws-music-name')).toBeHidden();
    await expect(page.locator('#ws-music-mark')).toHaveText('');
  });
});

test.describe('the bulk bar', () => {
  test('a failed bulk op gives every button back, not just the one pressed', async ({ page }) => {
    // The bar disables all six together and re-enabled them only past an
    // unguarded await, so one dead-network op took every action on it away for
    // the rest of the session.
    await stubActions(page, {});
    await openManager(page);
    const boxes = page.locator('.row-check:not(:disabled)');
    test.skip((await boxes.count()) === 0, 'needs a selectable row');

    await boxes.first().check();
    await expect(page.locator('#bulkbar')).toHaveClass(/is-open/);
    const draft = page.locator('[data-bulk="draft"]');
    await draft.click();

    await expect(page.locator('#bulk-error')).toBeVisible();
    await expect(page.locator('#bulk-error')).not.toContainText('Failed to fetch');
    for (const op of ['publish', 'draft', 'note', 'trash']) {
      await expect(page.locator(`[data-bulk="${op}"]`)).toBeEnabled();
    }
  });
});

/*
  ⚠ THE RULE, DRIVEN ONCE (ADR 0032). `sheet-dismiss.test.ts` proves every sheet
  ASKS the question — it matches text, so it cannot prove the answer works. This
  proves it works, on the sheet that prompted the pass: Michael, 2026-08-11,
  *"the song sheet doesn't close if I click on the outside of the sheet, whereas
  the other two do."*

  Both halves matter and they are opposite. A CLEAN sheet must go on an outside
  click — a modal that ignores you reads as stuck. A DIRTY one must not, or the
  same gesture silently destroys everything typed into it. Wiring the first
  without the second is worse than wiring neither.
*/
test.describe('a sheet is dismissible, and says what that costs', () => {
  test('the song sheet closes on an outside press when nothing is at stake', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    const sheet = page.locator('#song-sheet');
    // ⚠ NOT `#lst-new` — /admin/listening is gone (plan 40) and an EMPTY song
    // sheet has no door left, because a song now enters from the essay that
    // wanted it. The URL field and its debounced lookup still exist on an
    // existing song's Facts tab, which is the surface this behaviour lives on
    // now. `song:edit` is the documented row → editor seam.
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent('song:edit', { detail: { id: 'aaaaaaaa-1111-2222-3333-444444444444' } })),
    );
    await expect(sheet).toBeVisible();

    // Press the backdrop — the dialog element itself, outside its content box.
    await page.mouse.click(5, 5);
    await expect(sheet, 'a clean sheet must close on an outside press').toBeHidden();
  });

  test('…and asks first once there is something to lose', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    const sheet = page.locator('#song-sheet');
    // ⚠ NOT `#lst-new` — /admin/listening is gone (plan 40) and an EMPTY song
    // sheet has no door left, because a song now enters from the essay that
    // wanted it. The URL field and its debounced lookup still exist on an
    // existing song's Facts tab, which is the surface this behaviour lives on
    // now. `song:edit` is the documented row → editor seam.
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent('song:edit', { detail: { id: 'aaaaaaaa-1111-2222-3333-444444444444' } })),
    );
    await expect(sheet).toBeVisible();

    // ⚠ TYPED TEXT IS THE UNSAVED WORK NOW. This used to press a feeling chip,
    // which was held until Save and so was the cheapest possible dirty edit.
    // The words are gone (plan 40); the title is the field that replaces them
    // as "something to lose".
    // ⚠ NO `Facts` TAB CLICK ANY MORE. `a song is not a fragment` deleted
    // `songs.setNotes` and with it the sheet's Notes pane — which left ONE
    // panel, so the tab strip went too (a strip over a single pane says there
    // is somewhere else to go). The field is simply on screen now.
    await page.locator('#sng-song-title').fill('zzq dirty');
    await page.mouse.click(5, 5);

    // The sheet stays, and the confirm is what stands between the click and the
    // loss. Dismissing THAT leaves the song exactly where it was.
    await expect(page.locator('dialog[open] >> text=Discard changes?')).toBeVisible();
    await expect(sheet, 'a dirty sheet must not vanish behind its own confirm').toBeVisible();
  });
});
