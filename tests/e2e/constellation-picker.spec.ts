// The constellation picker inside an editor sheet — docs/plans/15, Pieces 2
// and 3: making a constellation without leaving the fragment, and every other
// control built from "all constellations" learning about it.
//
// ⚠ STUBBED. `constellations.save` creates a real row, and this harness runs
// against the LIVE project — an unstubbed run would leave constellations named
// "Test" scattered through Michael's sky. Every action is answered here and
// anything unnamed is aborted, so no request can reach the database.
//
// What that buys and what it costs, stated plainly: these specs prove the
// CLIENT behaves correctly given a correct response — never that the action
// sends one. `constellations.save` creating from a name alone is already true
// in production (it is what /admin/constellations' own one-field form calls),
// which is exactly why Piece 2 needed no server code.
import type { Page } from '@playwright/test';
import type { actions } from 'astro:actions';
import { expect, test, fixtures, hideDevToolbar, stubActions } from './fixtures';

type Save = Awaited<ReturnType<typeof actions.constellations.save.orThrow>>;

const NEW_ID = 'c0ffee00-1111-2222-3333-444444444444';
const NEW_NAME = 'A way of seeing that does not exist';
const NEW_SLUG = 'a-way-of-seeing-that-does-not-exist';

/** Open the quote sheet on the fragments manager, with its Constellations tab up. */
async function openPicker(page: Page) {
  await page.goto('/admin/fragments');
  await hideDevToolbar(page);
  await page.locator('#add-btn').click();
  await page.locator('[data-new="quote"]').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await page.locator('#sheet [data-tab="constellations"]').click();
  const picker = page.locator('#sheet-panel-cn .cn-picker');
  await expect(picker).toBeVisible();
  return picker;
}

/**
 * Read one field out of an action's request body.
 *
 * ⚠ `accept: 'form'` actions are sent as multipart/form-data, so `postData()`
 * is a boundary-delimited blob and `new URLSearchParams(...)` silently yields
 * nothing — which reads as "the form never called save" when it plainly did.
 */
function formField(body: string | null, name: string): string | null {
  const m = new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`).exec(body ?? '');
  return m ? m[1] : null;
}

async function stubSave(page: Page, calls: (string | null)[]) {
  return stubActions(page, {
    'constellations.save': (req): Save => {
      calls.push(formField(req.postData(), 'name'));
      return { id: NEW_ID, slug: NEW_SLUG };
    },
    'constellations.setMembership': () => ({ ok: true }),
    'fragments.saveQuote': () => ({ id: 'deadbeef-1111-2222-3333-444444444444', slug: 'q' }),
  });
}

test.describe('making a constellation from inside a fragment', () => {
  test('the new one appears, ticked, at the end of the list', async ({ page }) => {
    const saved: (string | null)[] = [];
    await stubSave(page, saved);
    const picker = await openPicker(page);

    const before = await picker.locator('.cn-row').count();
    await picker.locator('.cn-new-btn').click();
    await picker.locator('.cn-new-name').fill(NEW_NAME);
    await picker.locator('.cn-new-save').click();

    await expect(picker.locator('.cn-row')).toHaveCount(before + 1);
    expect(saved, 'the create form did not call save with the typed name').toEqual([NEW_NAME]);

    // APPENDED, not inserted: `save` gives a new constellation sort = max + 1,
    // so the end of this list is its real place in the sky's authored order.
    const last = picker.locator('.cn-row').last();
    await expect(last).toHaveAttribute('data-id', NEW_ID);
    await expect(last.locator('.cn-check')).toBeChecked();
    // Ticking it is the whole point — it must be a membership, not just a row.
    await expect(picker.locator('.cn-picker-status')).toContainText('Will be added when you save');
  });

  test('the ↗ opens that constellation in a new tab, and cannot tick the box', async ({ page }) => {
    await stubSave(page, []);
    const picker = await openPicker(page);
    test.skip((await picker.locator('.cn-row').count()) === 0, 'no constellations to link to');

    const row = picker.locator('.cn-row').first();
    const id = await row.getAttribute('data-id');
    const link = row.locator('.cn-open');
    await expect(link).toHaveAttribute('href', `/admin/constellations/${id}`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');

    // ⚠ The reason the ↗ is a SIBLING of the <label> and not inside it: a click
    // that also toggled membership would silently file the fragment somewhere
    // on the way to looking at it.
    const box = row.locator('.cn-check');
    await expect(box).not.toBeChecked();
    await link.click({ modifiers: ['Shift'] }); // shift-click opens a window, not this tab
    await expect(box).not.toBeChecked();
  });

  test('a duplicate name ticks the existing row and writes nothing', async ({ page }) => {
    const saved: (string | null)[] = [];
    await stubSave(page, saved);
    const picker = await openPicker(page);
    test.skip((await picker.locator('.cn-row').count()) === 0, 'no constellations to duplicate');

    const existing = picker.locator('.cn-row').first();
    const name = (await existing.getAttribute('data-name'))!;
    const before = await picker.locator('.cn-row').count();

    await picker.locator('.cn-new-btn').click();
    // Case-insensitively the same — the trap is that `save` de-dupes SLUGS, so
    // this would otherwise yield a second constellation with an identical name.
    await picker.locator('.cn-new-name').fill(name.toUpperCase());
    await picker.locator('.cn-new-save').click();

    await expect(picker.locator('.cn-picker-status')).toContainText('Already in the sky');
    await expect(existing.locator('.cn-check')).toBeChecked();
    await expect(picker.locator('.cn-row')).toHaveCount(before);
    expect(saved, 'a duplicate name reached the server').toEqual([]);
  });

  test('creating in one sheet puts the row in the other', async ({ page }) => {
    await stubSave(page, []);
    const picker = await openPicker(page);

    const other = page.locator('#ws-panel-cn .cn-picker');
    const beforeOther = await other.locator('.cn-row').count();

    await picker.locator('.cn-new-btn').click();
    await picker.locator('.cn-new-name').fill(NEW_NAME);
    await picker.locator('.cn-new-save').click();

    // Two pickers, one sky. Without the broadcast they disagree, and only one
    // of them is right.
    await expect(other.locator('.cn-row')).toHaveCount(beforeOther + 1);
    await expect(other.locator(`.cn-row[data-id="${NEW_ID}"]`)).toHaveCount(1);
    // …but the TICK belongs to the fragment being edited, not to the sky.
    await expect(other.locator(`.cn-row[data-id="${NEW_ID}"] .cn-check`)).not.toBeChecked();
  });

  test('Enter in the name field creates, and never submits the fragment', async ({ page }) => {
    const saved: (string | null)[] = [];
    const seen = await stubSave(page, saved);
    const picker = await openPicker(page);

    await picker.locator('.cn-new-btn').click();
    await picker.locator('.cn-new-name').fill(NEW_NAME);
    await picker.locator('.cn-new-name').press('Enter');

    await expect(picker.locator(`.cn-row[data-id="${NEW_ID}"]`)).toHaveCount(1);
    expect(saved).toEqual([NEW_NAME]);
    // The picker is mounted inside the sheet's <form>. If the keydown weren't
    // stopped, Enter would save the QUOTE — an empty one, from a form nobody
    // filled in.
    expect(seen(), 'Enter submitted the fragment as well as creating').not.toContain('fragments.saveQuote');
    await expect(page.locator('#sheet')).toBeVisible();
  });
});

test.describe('the sky stops being stale', () => {
  test('push: a new constellation reaches the filter select immediately', async ({ page }) => {
    await stubSave(page, []);
    const picker = await openPicker(page);

    const select = page.locator('select[name="in"]');
    await expect(select.locator(`option[value="${NEW_SLUG}"]`)).toHaveCount(0);

    await picker.locator('.cn-new-btn').click();
    await picker.locator('.cn-new-name').fill(NEW_NAME);
    await picker.locator('.cn-new-save').click();

    await expect(select.locator(`option[value="${NEW_SLUG}"]`)).toHaveCount(1);
    await expect(select.locator('option').last()).toHaveText(NEW_NAME); // appended, in sort order
  });

  test('pull: a filter change alone picks up one nobody announced', async ({ page }) => {
    // The case push can NEVER cover — a constellation made in another tab. The
    // partial is doctored on its way back, so this proves the pull path
    // independently of the push one rather than riding on it.
    await page.route('**/admin/fragments-panel*', async (route) => {
      const res = await route.fetch();
      const text = await res.text();
      // ⚠ The LAST </select> — the toolbar holds four (subject, author, work,
      // then `in`), and a plain .replace() would inject the option into the
      // author filter, where the assertion below would never find it.
      const at = text.lastIndexOf('</select>');
      const html = text.slice(0, at) + '<option value="made-elsewhere">Made in another tab</option>' + text.slice(at);
      await route.fulfill({ response: res, body: html });
    });
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);

    const select = page.locator('select[name="in"]');
    await expect(select.locator('option[value="made-elsewhere"]')).toHaveCount(0);

    // Any filter change fetches the partial — this is the "no new request" part
    // of Piece 3: the option list rides back on a response already in flight.
    await page.locator('.type-badge[data-type-filter="quote"]').click();
    await expect(select.locator('option[value="made-elsewhere"]')).toHaveCount(1);
  });

  test('pull: the current selection survives the option swap', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    const select = page.locator('select[name="in"]');
    const slug = await select.locator('option').last().getAttribute('value');
    test.skip(!slug || slug === 'none', 'no constellation to filter by');

    await select.selectOption(slug!);
    await expect(select).toHaveValue(slug!);
    // A second filter change re-copies the options; a naive innerHTML swap
    // would reset the select to "Any constellation" and silently widen the
    // filter you are looking at.
    await page.locator('.type-badge[data-type-filter=""]').click();
    await expect(select).toHaveValue(slug!);
  });
});

test.describe('the cart', () => {
  test('the selection survives a filter change and a search', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    const boxes = page.locator('.row-check:not(:disabled)');
    test.skip((await boxes.count()) < 2, 'needs two selectable rows');

    const first = await boxes.nth(0).getAttribute('value');
    const second = await boxes.nth(1).getAttribute('value');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(page.locator('#bulkcount')).toHaveText('2 selected');

    await page.locator('.type-badge[data-type-filter="quote"]').click();
    await expect(page.locator('#bulkbar')).toHaveClass(/is-open/);
    await expect(page.locator('#bulkcount')).toContainText('2 selected');

    await page.locator('input[name="q"]').fill('a');
    await page.waitForTimeout(500); // the search debounce, then whatever it fetched
    await expect(page.locator('#bulkcount')).toContainText('2 selected');

    // Back to the unfiltered view: the rows return, and they return TICKED.
    await page.locator('input[name="q"]').fill('');
    await page.locator('.type-badge[data-type-filter=""]').click();
    await expect(page.locator(`.row-check[value="${first}"]`)).toBeChecked();
    await expect(page.locator(`.row-check[value="${second}"]`)).toBeChecked();
  });

  test('the count says how much of itself is on screen', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    const boxes = page.locator('.row-check:not(:disabled)');
    test.skip((await boxes.count()) < 2, 'needs two selectable rows');

    await boxes.nth(0).check();
    await boxes.nth(1).check();
    // Nothing matches a search this specific, so the cart is entirely off-screen
    // — and the bar has to say so rather than showing an unaccountable 2.
    await page.locator('input[name="q"]').fill('zzzqqqxxnothingmatchesthis');
    await expect(page.locator('#bulkcount')).toHaveText('2 selected · 0 shown here');
    await expect(page.locator('#bulkbar')).toHaveClass(/is-open/);
  });

  test('Clear is the only thing that empties it', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    const boxes = page.locator('.row-check:not(:disabled)');
    test.skip((await boxes.count()) < 1, 'needs a selectable row');

    await boxes.nth(0).check();
    await expect(page.locator('#bulkbar')).toHaveClass(/is-open/);
    await page.locator('#bulk-clear').click();
    await expect(page.locator('#bulkbar')).not.toHaveClass(/is-open/);
    await expect(boxes.nth(0)).not.toBeChecked();
  });

  test('select-all takes the visible rows and leaves the rest of the cart alone', async ({ page }) => {
    await page.goto('/admin/fragments');
    await hideDevToolbar(page);
    const boxes = page.locator('.row-check:not(:disabled)');
    test.skip((await boxes.count()) < 2, 'needs two selectable rows');

    const carted = await boxes.nth(0).getAttribute('value');
    await boxes.nth(0).check();

    // Narrow to something that cannot include the row above, then select all.
    await page.locator('input[name="q"]').fill('zzzqqqxxnothingmatchesthis');
    await expect(page.locator('#bulkcount')).toHaveText('1 selected · 0 shown here');

    await page.locator('input[name="q"]').fill('');
    await expect(page.locator('.select-all')).toBeVisible();
    await page.locator('.select-all').check();
    const total = await boxes.count();
    await expect(page.locator('#bulkcount')).toHaveText(`${total} selected`);

    // Untick-all removes the VISIBLE rows only. Everything is visible here, so
    // the cart empties — the assertion that matters is that the one carted row
    // was never treated as a special case in either direction.
    await page.locator('.select-all').uncheck();
    await expect(page.locator(`.row-check[value="${carted}"]`)).not.toBeChecked();
    await expect(page.locator('#bulkbar')).not.toHaveClass(/is-open/);
  });

  test('the checkbox has a 24px target even though it draws smaller', async ({ page }) => {
    await page.goto('/admin/fragments');
    const box = page.locator('.row-check:not(:disabled)').first();
    test.skip((await page.locator('.row-check:not(:disabled)').count()) === 0, 'needs a selectable row');
    // WCAG 2.5.8 AA. The box itself stays `checkbox-xs`; the ::after grows the
    // hit area around it, so a dense table doesn't get looser to be reachable.
    const target = await box.evaluate((el) => {
      const s = getComputedStyle(el, '::after');
      return { w: parseFloat(s.width), h: parseFloat(s.height) };
    });
    expect(target.w).toBeGreaterThanOrEqual(24);
    expect(target.h).toBeGreaterThanOrEqual(24);
  });
});

test.describe('closing', () => {
  test('the sheet fires `close` on the membership path', async ({ page }) => {
    // The exact bug: `if (membershipTouched()) return void location.reload()`
    // jumped straight over `sheet.close()`, so on "assign it to a constellation,
    // then close" the sheet was never closed — it sat there until a page load
    // painted over it. There was no close animation because there was no close.
    await stubActions(page, {
      'constellations.setMembership': () => ({ ok: true }),
    });
    const picker = await openPicker(page);
    test.skip((await picker.locator('.cn-row').count()) === 0, 'no constellation to tick');

    await page.evaluate(() => {
      const d = document.getElementById('sheet')!;
      d.addEventListener('close', () => ((window as unknown as { __closed?: boolean }).__closed = true));
    });

    await picker.locator('.cn-row').first().locator('.cn-check').check();
    await page.locator('#sheet [data-close]').first().click();

    await expect(page.locator('#sheet')).toBeHidden();
    expect(
      await page.evaluate(() => (window as unknown as { __closed?: boolean }).__closed === true),
      'the dialog never fired `close` — it was navigated away from, not closed',
    ).toBe(true);
  });

  test('the list refresh happens after the sheet is gone, not during', async ({ page }) => {
    await stubActions(page, { 'constellations.setMembership': () => ({ ok: true }) });
    const picker = await openPicker(page);
    test.skip((await picker.locator('.cn-row').count()) === 0, 'no constellation to tick');

    // Record the ORDER of the two events. Asserting the sequence is the honest
    // version of "it closes gracefully" — smoothness is not something a spec
    // can see, but "the heavy DOM work landed mid-animation" is.
    await page.evaluate(() => {
      const w = window as unknown as { __order?: string[] };
      w.__order = [];
      document.getElementById('sheet')!.addEventListener('close', () => w.__order!.push('close'));
    });
    await page.route('**/admin/fragments-panel*', async (route) => {
      await page.evaluate(() => (window as unknown as { __order: string[] }).__order.push('refresh'));
      await route.continue();
    });

    await picker.locator('.cn-row').first().locator('.cn-check').check();
    await page.locator('#sheet [data-close]').first().click();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __order: string[] }).__order))
      .toEqual(['close', 'refresh']);
  });
});

test.describe('nothing here touched the corpus', () => {
  test('the fixture constellation still exists and still has its suite', async ({ page }) => {
    // A blunt guard rather than a subtle one: every spec above stubs its
    // writes, and this is what notices if one stops.
    const { composedConstellationId } = fixtures();
    test.skip(!composedConstellationId, 'no composed constellation to check');
    await page.goto(`/admin/constellations/${composedConstellationId}`);
    await expect(page.locator('#suite-rows li[data-fid]').first()).toBeVisible();
  });
});
