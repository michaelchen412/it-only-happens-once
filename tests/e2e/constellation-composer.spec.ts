// The composer's suite — docs/plans/15, Pieces 1, 5 and 6.
//
// ⚠ STUBBED, AND IT HAS TO BE. `constellations.unplace` is a real DELETE against
// a real row, and this harness runs against the LIVE project: an unstubbed run
// of this file would quietly dismantle one of Michael's compositions. Every
// action these specs can reach is answered here, and a name with no handler is
// aborted rather than passed through, so the file cannot grow a call to the
// database by accident.
//
// The page itself is server-rendered from live data, which is fine (a read), and
// it means the suite's SIZE is whatever happens to be there. So the assertions
// are written against INVARIANTS — "the placed count went down by one", "the
// subject badge equals the union of what remains" — rather than against numbers
// that would need a seeded corpus to be true.
import type { Page } from '@playwright/test';
import { expect, test, fixtures, formFields, hideDevToolbar, stubActions } from './fixtures';

/** Every action the composer can fire, answered locally. Anything not named
 *  here is aborted rather than passed through — that is what keeps the live
 *  corpus safe from a spec that grows a new call later. */
const stubComposer = (page: Page) =>
  stubActions(page, {
    'constellations.unplace': () => ({ ok: true }),
    'constellations.reorderPlacements': () => ({ ok: true }),
    'constellations.place': () => ({ ok: true }),
  });

/** Stamp a sentinel we can look for afterwards: if the page navigated, it's gone. */
async function markNoNavigation(page: Page) {
  await page.evaluate(() => ((window as unknown as { __stayed?: number }).__stayed = 1));
}
const stayed = (page: Page) => page.evaluate(() => (window as unknown as { __stayed?: number }).__stayed === 1);

async function openComposer(page: Page) {
  const { composedConstellationId } = fixtures();
  test.skip(!composedConstellationId, 'no constellation with a suite to compose');
  await page.goto(`/admin/constellations/${composedConstellationId}`);
  await expect(page.locator('#suite-rows')).toBeVisible();
  await hideDevToolbar(page);
  await markNoNavigation(page);
}

const rows = (page: Page) => page.locator('#suite-rows li[data-fid]');
const statN = (page: Page, id: string) => page.locator(`#${id} .admin-stat__n`);

test.describe('the ✕ unplaces without reloading', () => {
  test('the row goes, and the page does not', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    const before = await rows(page).count();
    const firstId = await rows(page).first().getAttribute('data-fid');

    await rows(page).first().locator('[data-unplace]').click();

    await expect(rows(page)).toHaveCount(before - 1);
    // The one assertion the whole piece is about: no navigation happened.
    expect(await stayed(page), 'the page reloaded — the ✕ is still navigating').toBe(true);
    // …and it left with its stanza in the Read view, not just its Compose row.
    await expect(page.locator(`#suite-read-list [data-fid="${firstId}"]`)).toHaveCount(0);
  });

  test('the badges are recomputed, not left behind', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    const before = await rows(page).count();
    const doomed = rows(page).first();
    const type = await doomed.getAttribute('data-type');
    const typeBefore = Number(await page.locator(`[data-type-count="${type}"] .admin-stat__n`).textContent());

    await doomed.locator('[data-unplace]').click();
    await expect(rows(page)).toHaveCount(before - 1);

    await expect(statN(page, 'suite-placed')).toHaveText(String(before - 1));
    await expect(page.locator(`[data-type-count="${type}"] .admin-stat__n`)).toHaveText(String(typeBefore - 1));

    // The subject spread is the UNION of what remains — the one number a stale
    // badge would get wrong in a way nobody notices.
    const expected = await page.evaluate(() => {
      const set = new Set<string>();
      document.querySelectorAll<HTMLElement>('#suite-rows li[data-fid]').forEach((li) => {
        (li.dataset.subjects ?? '')
          .split('|')
          .filter(Boolean)
          .forEach((s) => set.add(s));
      });
      return set.size;
    });
    await expect(statN(page, 'suite-spread')).toHaveText(String(expected));
  });

  test('the mass-noun rule survives the trip to the client', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);
    // "writing" never pluralises whatever the count; quote/song do. The rule is
    // the server's, and after an unplace it has to be the client's too.
    await rows(page).first().locator('[data-unplace]').click();
    await expect(page.locator('[data-type-count="writing"] .admin-stat__label')).toHaveText('writing');
    for (const t of ['quote', 'song']) {
      const n = Number(await page.locator(`[data-type-count="${t}"] .admin-stat__n`).textContent());
      await expect(page.locator(`[data-type-count="${t}"] .admin-stat__label`)).toHaveText(n === 1 ? t : `${t}s`);
    }
  });

  // ⚠ THE PREFLIGHT LINE IS THE ONE STAT THAT DOESN'T LIVE WITH THE OTHERS —
  // it sits beside the visibility switch, where publishing is decided, and is
  // repainted by the same pass that repaints the badges four hundred pixels
  // below it. That distance is exactly what makes it easy to leave behind.
  test('the publish preflight tracks the rows, wherever it is on the page', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);
    const line = page.locator('#cc-public-shape');

    // An invariant, not a number: whatever the live suite holds, the sentence
    // has to agree with the rows that are still there after a removal.
    for (let i = 0; i < 2 && (await rows(page).count()) > 0; i++) {
      const n = await rows(page).count();
      await rows(page).first().locator('[data-unplace]').click();
      await expect(rows(page)).toHaveCount(n - 1);
    }

    const { placed, drafts } = await page.evaluate(() => {
      const els = [...document.querySelectorAll<HTMLElement>('#suite-rows li[data-fid]')];
      return { placed: els.length, drafts: els.filter((li) => li.dataset.status !== 'published').length };
    });
    if (!placed || !drafts) {
      await expect(line).toBeHidden(); // nothing to say is a state, and it says nothing
      return;
    }
    await expect(line).toBeVisible();
    await expect(line).toContainText(String(drafts));
    await expect(line).toContainText(String(placed - drafts === 0 ? placed : placed - drafts));
  });

  test('the thin-suite hint appears as the suite drops below five', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    // At least one removal, so the CLIENT-side path runs even on a suite the
    // server already rendered as thin — then down to four, the threshold
    // suiteHints() draws.
    do {
      const n = await rows(page).count();
      await rows(page).first().locator('[data-unplace]').click();
      await expect(rows(page)).toHaveCount(n - 1);
    } while ((await rows(page).count()) > 4);
    await expect(page.locator('#suite-hints')).toBeVisible();
    await expect(page.locator('#suite-hints')).toContainText('thin');
    expect(await stayed(page)).toBe(true);
  });

  test('removing the last one shows the empty state and hides the view toggle', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    while ((await rows(page).count()) > 0) {
      const n = await rows(page).count();
      await rows(page).first().locator('[data-unplace]').click();
      await expect(rows(page)).toHaveCount(n - 1);
    }

    // Markup the page would not have had at all before Piece 1 rendered the
    // suite chrome unconditionally.
    await expect(page.locator('#suite-empty')).toBeVisible();
    await expect(page.locator('#suite-viewseg')).toBeHidden();
    await expect(page.locator('#suite-rows')).toBeHidden();
    await expect(page.locator('#suite-read')).toBeHidden();
    await expect(statN(page, 'suite-placed')).toHaveText('0');
    await expect(page.locator('#suite-hints')).toBeHidden(); // an empty suite isn't "thin"
    expect(await stayed(page)).toBe(true);
  });

  test('focus lands somewhere usable, not on <body>', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);

    await rows(page).first().locator('[data-unplace]').click();
    await expect(rows(page).first()).toBeVisible();
    // The next row's ✕ — so removing a run of rows doesn't strand the keyboard.
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { tag: el?.tagName, unplace: el?.hasAttribute('data-unplace') ?? false };
    });
    expect(focused.tag, 'focus fell to the document — the keyboard is stranded').not.toBe('BODY');
    expect(focused.unplace).toBe(true);
  });

  test('a refused unplace keeps the row and speaks', async ({ page }) => {
    // Everything aborts → the action errors → the row must NOT disappear.
    await page.route('**/_actions/**', (route) => route.abort('failed'));
    await openComposer(page);

    const before = await rows(page).count();
    await rows(page).first().locator('[data-unplace]').click();

    await expect(page.locator('#cc-error')).toBeVisible();
    await expect(rows(page)).toHaveCount(before);
    expect(await stayed(page)).toBe(true);
  });
});

// ── the visibility switch (2026-08-11) ──────────────────────────────────────
// It replaced a two-option <select>, and the swap turned one line of markup
// into a CONTRACT: an unchecked checkbox submits nothing at all, and
// `constellationStatus` in src/actions/_shared.ts is `.default('draft')`, so
// "off means draft" holds only as long as nobody adds a hidden mirror of the
// field. Neither the typechecker nor a screenshot can see that — the only
// place it is visible is in what the browser actually posts, which is what the
// last test here reads.
//
// The other two cover the cost the switch knowingly accepts: it saves with the
// rest of the card rather than on flip, so between the flip and the Save it
// shows a state the database doesn't have, and the line beneath it is the only
// thing that says so.
test.describe('the visibility switch', () => {
  const PENDING_ON = 'It joins the sky when you press Save.';
  const PENDING_OFF = 'It leaves the sky when you press Save.';

  /** Any constellation will do — this is the settings card, not the suite. */
  async function openSettings(page: Page) {
    const { constellationId } = fixtures();
    test.skip(!constellationId, 'no constellation to edit');
    await page.goto(`/admin/constellations/${constellationId}`);
    await expect(page.locator('#cc-status')).toBeVisible();
    await hideDevToolbar(page);
  }

  test('the caption says what Save would do, and settles again when it agrees', async ({ page }) => {
    await openSettings(page);
    const box = page.locator('#cc-status');
    const word = page.locator('#cc-status-word');
    const hint = page.locator('#cc-status-hint');

    // Written against whatever the live row happens to be: the assertions are
    // about the transition, not about this constellation being published.
    const wasOn = await box.isChecked();
    const settled = (await hint.getAttribute(wasOn ? 'data-on' : 'data-off'))!;
    await expect(word).toHaveText(wasOn ? 'Published' : 'Draft');
    await expect(hint).toHaveText(settled);

    await box.click();
    await expect(word).toHaveText(wasOn ? 'Draft' : 'Published');
    await expect(hint).toHaveText(wasOn ? PENDING_OFF : PENDING_ON);

    // Flipped BACK is the case a plain dirty flag gets wrong — nothing is
    // pending any more, so the line has to stop claiming there is.
    await box.click();
    await expect(word).toHaveText(wasOn ? 'Published' : 'Draft');
    await expect(hint).toHaveText(settled);
  });

  test('the word beside it is a label, so the whole thing is one target', async ({ page }) => {
    await openSettings(page);
    const box = page.locator('#cc-status');
    const before = await box.isChecked();
    await page.locator('#cc-status-word').click();
    await expect(box).toBeChecked({ checked: !before });
  });

  test('it posts status=published when on, and NO status field at all when off', async ({ page }) => {
    const { constellationId } = fixtures();
    let posted: Record<string, string> = {};
    await stubActions(page, {
      'constellations.save': (req) => {
        posted = formFields(req);
        return { id: constellationId, slug: posted.slug || 'unchanged' };
      },
    });
    await openSettings(page);
    const box = page.locator('#cc-status');
    const save = page.locator('#cc-save');

    // End OFF and dirty either way: one flip if it was on, two if it wasn't.
    // (Save is armed by an edit, so a no-op would leave nothing to press.)
    if (await box.isChecked()) await box.click();
    else {
      await box.click();
      await box.click();
    }
    await save.click();
    await expect(page.locator('#cc-saved')).toBeVisible();
    expect(posted.name, 'the rest of the card must still ride along').toBeTruthy();
    expect(
      'status' in posted,
      'an unchecked switch sent a `status` field — the zod default is no longer what makes it a draft',
    ).toBe(false);

    await box.click();
    await save.click();
    await expect.poll(() => posted.status).toBe('published');
    // …and the caption stops describing a pending change once it lands.
    await expect(page.locator('#cc-status-hint')).toHaveText(
      (await page.locator('#cc-status-hint').getAttribute('data-on'))!,
    );
  });
});

// ── the description is a rich editor (2026-08-11) ───────────────────────────
// It was a <textarea> until Michael asked for bold and italic. The swap put
// three things beyond the reach of a typecheck at once, and all three fail
// silently: a contenteditable is invisible to `new FormData(form)`, it fires no
// `input` event for the form's dirty flag to hear, and TipTap's `setContent`
// emits an update by default — which would arm Save and the unload guard on a
// page nobody had touched. Green checks say nothing about any of them.
test.describe('the description editor', () => {
  const surface = (page: Page) => page.locator('#cc-desc [contenteditable="true"]');

  test('it seeds from the stored value without pretending the page is dirty', async ({ page }) => {
    const { constellationId } = fixtures();
    test.skip(!constellationId, 'no constellation to edit');
    await page.goto(`/admin/constellations/${constellationId}`);
    await expect(page.locator('#cc-desc')).toBeVisible();

    // Whatever this constellation says, the editor and the hidden field agree
    // with each other and with the server's copy.
    const stored = await page.locator('#cc-desc-value').inputValue();
    if (stored.trim())
      await expect(surface(page)).toContainText(stored.split('\n')[0].replace(/[*_`]/g, '').slice(0, 40));
    await expect(page.locator('#cc-save')).toBeDisabled();
  });

  test('bold survives the trip into the form, as Markdown', async ({ page }) => {
    const { constellationId } = fixtures();
    let posted: Record<string, string> = {};
    await stubActions(page, {
      'constellations.save': (req) => {
        posted = formFields(req);
        return { id: constellationId, slug: posted.slug || 'unchanged' };
      },
    });
    test.skip(!constellationId, 'no constellation to edit');
    await page.goto(`/admin/constellations/${constellationId}`);
    await expect(page.locator('#cc-desc')).toBeVisible();
    await hideDevToolbar(page);

    await surface(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    const boldBtn = page.locator('#cc-desc-wrap [data-cmd="bold"]');
    await boldBtn.click();
    // ⚠ WAIT FOR THE MARK BEFORE TYPING, and this is a real race rather than
    // belt and braces. `toggleBold` runs `chain().focus().toggleBold().run()`,
    // so pressing the button hands focus BACK to the editor asynchronously —
    // and a keystroke that lands in the gap is swallowed. It cost the first
    // character exactly once in a hundred runs alone and reliably when this
    // file ran after another spec had warmed the module graph: the field came
    // back `**PECSPEC**`, which is bold applied, serialized and stored, failing
    // only on the S. `aria-pressed` is the toolbar's own report that the mark
    // is active (rich-editor.ts syncs it on `transaction`), so it is the exact
    // signal to wait on — a fixed timeout here would be the same race, slower.
    await expect(boldBtn).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('SPECSPEC');

    // The hidden field is the only thing the action will ever see.
    await expect(page.locator('#cc-desc-value')).toHaveValue(/\*\*SPECSPEC\*\*/);
    await expect(page.locator('#cc-save'), 'typing in a contenteditable did not arm Save').toBeEnabled();

    await page.locator('#cc-save').click();
    await expect.poll(() => posted.description).toMatch(/\*\*SPECSPEC\*\*/);
  });

  test('⌘S saves the card — but not from inside an open sheet', async ({ page }) => {
    const { constellationId } = fixtures();
    const seen = await stubActions(page, {
      'constellations.save': () => ({ id: constellationId, slug: 'unchanged' }),
      // The drawer loads the fragment table through a partial, not an action;
      // anything it does try is refused, which is the point of the stub map.
    });
    test.skip(!constellationId, 'no constellation to edit');
    await page.goto(`/admin/constellations/${constellationId}`);
    await expect(page.locator('#cc-desc')).toBeVisible();
    await hideDevToolbar(page);

    await surface(page).click();
    await page.keyboard.type('x');
    await expect(page.locator('#cc-save')).toBeEnabled();

    // ⚠ THE GUARD, TESTED FIRST — with the browser drawer open over the page,
    // ⌘S must not save the constellation BEHIND the fragment you are looking
    // at. Right feedback, wrong document is worse than no shortcut at all.
    await page.locator('[data-browse]').click();
    await expect(page.locator('#fbrowser')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+s');
    expect(seen().filter((n) => n === 'constellations.save')).toHaveLength(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#fbrowser')).toBeHidden();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('#cc-saved')).toBeVisible();
    await expect.poll(() => seen().filter((n) => n === 'constellations.save')).toHaveLength(1);
  });
});

test.describe('reordering survives a refresh', () => {
  test('drag listeners still fire after the suite is swapped', async ({ page }) => {
    await stubComposer(page);
    await openComposer(page);
    test.skip((await rows(page).count()) < 2, 'needs two rows to reorder');

    const idsBefore = await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fid));

    // The element-identity trap, turned into an assertion: fire the refresh the
    // sheets fire, then check the delegated keydown handler on #suite-rows is
    // still bound. Replacing the <ol> instead of its innerHTML kills it.
    await page.evaluate(
      () =>
        void document.dispatchEvent(
          new CustomEvent('fragments:changed', { cancelable: true, detail: { settled: Promise.resolve() } }),
        ),
    );
    await expect(rows(page)).toHaveCount(idsBefore.length);

    await rows(page).first().locator('[data-unplace]').focus();
    await page.keyboard.press('Alt+ArrowDown');

    const idsAfter = await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fid));
    expect(idsAfter[0], 'Alt+↓ did nothing — the swap replaced the element and took its listeners').toBe(idsBefore[1]);
    expect(idsAfter[1]).toBe(idsBefore[0]);
  });

  // ⚠ THE REGRESSION GUARD FOR PLAN 16 · PIECE 3. This page's drag/keyboard/
  // nudge wiring was lifted into `scripts/list-reorder.ts` so the constellations
  // index could have it too. Whether the ORIGINAL consumer still works is the
  // whole risk of that extraction, and this is the assertion that catches it —
  // dragging here, not on the page the extraction was done for.
  test('dragging a suite row still commits, after the wiring was extracted', async ({ page }) => {
    const seen = await stubComposer(page);
    await openComposer(page);
    test.skip((await rows(page).count()) < 2, 'needs two rows to reorder');

    const before = await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fid));
    await page.evaluate(() => {
      const list = document.getElementById('suite-rows')!;
      const [a, b] = [...list.querySelectorAll('li[data-fid]')] as HTMLElement[];
      const dt = new DataTransfer();
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = b.getBoundingClientRect();
      b.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: r.bottom - 2, cancelable: true }),
      );
      b.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
    });

    const after = await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fid));
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    // The DOM moving without the call is the failure that looks like success.
    await expect.poll(() => seen().filter((n) => n === 'constellations.reorderPlacements')).toHaveLength(1);
  });
});
