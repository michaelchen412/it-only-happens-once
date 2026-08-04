// Capture (14 · Piece 1) — the ✚ box and the pile, in a real browser.
//
// This file REPLACES capture-lab.spec.ts, deleted with the lab it drove. Its
// two assertions came with it, because they are still the two failures that
// would matter most: an empty box becoming a row, and the second dump
// overwriting the first instead of creating a new one.
//
// READ-ONLY BY CONSTRUCTION. These run against the LIVE project, so every
// control that writes is driven with `/_actions/**` stubbed: what they prove is
// that the CLIENT behaves given a correct response — never that the action
// sends one. `appendToPiece` is the one piece of new server code here and its
// gap is the widest: nothing below proves it actually merges two bodies.
import { test, expect, type Page } from '@playwright/test';
import { hideDevToolbar, stubActions } from './fixtures';

/** Pull one field out of a multipart body — enough to assert the contract. */
function field(body: string | null, name: string): string | null {
  if (!body) return null;
  return body.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`))?.[1] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const openBox = async (page: Page) => {
  await page.locator('#cap-open').click();
  await expect(page.locator('#cap-dialog')).toBeVisible();
};

test.describe('the ✚ — one door, every room', () => {
  test('is on Today, on the pile, and on a corpus room alike', async ({ page }) => {
    // The control belongs to the building rather than to a room (10-hq §10c),
    // so it is mounted in AdminLayout. If it ever gets moved onto a page, this
    // is what notices.
    for (const room of ['/admin', '/admin/notes', '/admin/fragments', '/admin/agenda']) {
      await page.goto(room);
      await expect(page.locator('#cap-open')).toBeVisible();
    }
  });

  test('opens a dialog rather than navigating — you keep your place', async ({ page }) => {
    await stubActions(page, {});
    await page.goto('/admin/agenda');
    await openBox(page);
    await expect(page.locator('#cap-box')).toBeFocused(); // land ready to type
    await expect(page).toHaveURL(/\/admin\/agenda$/); // still exactly where you were
  });

  test('the ✚ is not a zone on Today', async ({ page }) => {
    // 14 §4 wanted a card here; 10-hq §10c overruled it, and the reason is that
    // Today answers "what is my day" and a dump box answers nothing about it.
    await page.goto('/admin');
    await expect(page.locator('#cap-box')).toBeHidden(); // present in the dialog, not on the page
    await expect(page.locator('main').getByPlaceholder('Write it down…')).toHaveCount(0);
  });
});

test.describe('the box', () => {
  test('autosaves, never saves empty, and ＋ New starts a genuinely new note', async ({ page }) => {
    const saved: Array<{ id: string | null; body: string | null; status: string | null; slug: string | null }> = [];

    await stubActions(page, {
      'fragments.saveWriting': (req) => {
        const body = req.postData();
        const id = field(body, 'id');
        saved.push({ id, body: field(body, 'body'), status: field(body, 'status'), slug: field(body, 'slug') });
        return { id, slug: 'stub-slug', updated_at: new Date().toISOString() };
      },
    });

    await page.goto('/admin');
    await openBox(page);
    const box = page.locator('#cap-box');

    // 1. An empty box is never a row. Wait out the debounce and assert silence.
    await page.waitForTimeout(1200);
    expect(saved).toHaveLength(0);

    // 2. Typing saves itself. No button was pressed.
    //    Poll the captured calls rather than the status line where possible:
    //    the status is transient (it fades), so asserting on it races both ways.
    await box.fill('call the dentist');
    await expect(page.locator('#cap-status')).toHaveText('Saved'); // it does say so, once
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].body).toBe('call the dentist');
    expect(saved[0].status).toBe('note'); // the existing tier, not a new store
    expect(saved[0].id).toMatch(UUID); // client-minted, so the first save is an insert
    expect(saved[0].slug).toBeNull(); // nothing to send yet — the server mints it

    // 3. The SECOND save of the same thought sends the slug back, so the server
    //    stops re-deriving it from the body's first words on every keystroke.
    await box.fill('call the dentist about the thing');
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1].id).toBe(saved[0].id);
    expect(saved[1].slug).toBe('stub-slug');

    // 4. ＋ New parks it and hands over a blank, still focused.
    await page.locator('#cap-new').click();
    await expect(box).toHaveValue('');
    await expect(box).toBeFocused();

    // 5. The next thought is a NEW note — the bug that would matter most here
    //    is the second dump overwriting the first.
    await box.fill('idea: a constellation about thresholds');
    await expect.poll(() => saved.length).toBe(3);
    expect(saved[2].id).not.toBe(saved[0].id);
    expect(saved[2].slug).toBeNull(); // a new note, so a new slug is minted
  });

  test('⌘/Ctrl+Enter parks the thought without reaching for the mouse', async ({ page }) => {
    const ids: Array<string | null> = [];
    await stubActions(page, {
      'fragments.saveWriting': (req) => {
        const id = field(req.postData(), 'id');
        ids.push(id);
        return { id, slug: 'stub', updated_at: new Date().toISOString() };
      },
    });

    await page.goto('/admin');
    await openBox(page);
    const box = page.locator('#cap-box');

    await box.fill('one');
    await expect.poll(() => ids.length).toBe(1);
    await box.press('ControlOrMeta+Enter');
    await expect(box).toHaveValue('');

    await box.fill('two');
    await expect.poll(() => ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('closing flushes what the debounce has not — Escape must not eat a thought', async ({ page }) => {
    const bodies: Array<string | null> = [];
    await stubActions(page, {
      'fragments.saveWriting': (req) => {
        bodies.push(field(req.postData(), 'body'));
        return { id: crypto.randomUUID(), slug: 'stub', updated_at: new Date().toISOString() };
      },
    });

    await page.goto('/admin');
    await openBox(page);
    // Type and leave IMMEDIATELY — inside the 700ms window, so the only thing
    // that can save this is the close handler.
    await page.locator('#cap-box').fill('the thing I would have lost');
    await page.keyboard.press('Escape');
    await expect.poll(() => bodies).toContain('the thing I would have lost');
    await expect(page.locator('#cap-dialog')).toBeHidden();
  });

  test('the status line is empty until there is something true to say', async ({ page }) => {
    // The lab shipped "Saved" in the markup at opacity-0: it lied to screen
    // readers and satisfied an assertion for a save that had not happened.
    await stubActions(page, {});
    await page.goto('/admin');
    await openBox(page);
    await expect(page.locator('#cap-status')).toBeEmpty();
  });
});

test.describe('the pile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/notes');
  });

  test('is a room in the sidebar, and the old notes view redirects into it', async ({ page }) => {
    await page.goto('/admin/fragments?view=notes');
    await expect(page).toHaveURL(/\/admin\/notes$/);
    await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
  });

  test('⚠ the fragment manager no longer offers a Notes view or a Note to add', async ({ page }) => {
    await page.goto('/admin/fragments');
    // The middle ground, gone from both ends: no filter into scratch…
    await expect(page.locator('a[href*="view=notes"]')).toHaveCount(0);
    // …and no door that would open a titled sheet for something with no title.
    await page.locator('#add-btn').click();
    await expect(page.locator('#add-menu')).toBeVisible();
    await expect(page.locator('[data-new-note]')).toHaveCount(0);
    await expect(page.locator('[data-new-writing]')).toBeVisible();
  });

  test('shows the words, not a title and not a table', async ({ page }) => {
    const cards = page.locator('.dump');
    const n = await cards.count();
    test.skip(n === 0, 'the pile is empty — nothing to render');

    // THE POINT OF THE ROOM. Every card carries its own text, and none of the
    // furniture that made a jotting read as a document is here.
    await expect(cards.first().locator('[data-text]')).not.toBeEmpty();
    // ⚠ SCOPED TO `main`, not the page. Playwright's selectors pierce open
    // shadow roots, so an unscoped `input[type=checkbox]` matches two controls
    // inside Astro's dev toolbar — an element that does not exist in a build.
    // The assertion looked like a defect in the room and was an artifact of the
    // harness.
    await expect(page.locator('main table')).toHaveCount(0);
    await expect(page.locator('main input[type="checkbox"]')).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toContain('untitled');
  });

  test('the four motions are on every card, at the tap floor', async ({ page }) => {
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    for (const sel of ['[data-edit]', '[data-promote]', '[data-append]', '[data-delete]']) {
      const btn = card.locator(sel);
      await expect(btn).toBeVisible(); // never hover-only: a phone has no hover
      const box = await btn.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('the pencil edits in place — no sheet, no navigation', async ({ page }) => {
    await stubActions(page, {});
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    const text = await card.locator('[data-text]').innerText();
    await card.locator('[data-edit]').click();

    const box = card.locator('[data-edit-box]');
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();
    expect((await box.inputValue()).trim()).toBe(text.trim()); // the same words, not a fetch
    await expect(card.locator('[data-text]')).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/notes$/);

    // Escape returns to reading without asking anything.
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
    await expect(card.locator('[data-text]')).toBeVisible();
  });

  test('an unchanged card saves nothing when you leave it', async ({ page }) => {
    // Opening a thought to re-read it must not rewrite the row — that would
    // move it to the top of a pile ordered by when it was last touched.
    const seen = await stubActions(page, {});
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    await card.locator('[data-edit]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900); // past the debounce
    expect(seen()).toEqual([]);
  });
});

test.describe('triage — the two ways out of the pile', () => {
  test('make it a piece is a status flip, and it is undoable', async ({ page }) => {
    const ops: Array<{ ids: string | null; op: string | null }> = [];
    await stubActions(page, {
      'fragments.bulk': (req) => {
        const body = req.postData();
        ops.push({ ids: field(body, 'ids'), op: field(body, 'op') });
        return { ok: true, count: 1 };
      },
    });
    await page.goto('/admin/notes');
    await hideDevToolbar(page); // it sits over the undo strip in dev — see fixtures.ts
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    const id = await card.getAttribute('data-note');

    await card.locator('[data-promote]').click();

    // ONE ROW, ONE FLIP — no insert, no copy, no second id. This is the whole
    // argument for keeping dumps in the `note` tier rather than a table of
    // their own (14 §3), so it is asserted rather than assumed.
    await expect.poll(() => ops.length).toBe(1);
    expect(ops[0]).toEqual({ ids: id, op: 'draft' });

    const undo = page.locator('#notes-undo');
    await expect(undo).toHaveClass(/is-visible/);
    await expect(undo).toContainText('Now a draft');
    await expect(undo.locator(`a[href="/admin/fragments#edit=${id}"]`)).toBeVisible();

    await undo.locator('[data-undo-do]').click();
    await expect.poll(() => ops.length).toBe(2);
    expect(ops[1]).toEqual({ ids: id, op: 'note' }); // straight back to the pile
    await expect(card).toBeVisible();
  });

  test('delete is soft and reversible, with no dialog in front of it', async ({ page }) => {
    const ops: string[] = [];
    await stubActions(page, {
      'fragments.bulk': (req) => {
        ops.push(field(req.postData(), 'op') ?? '');
        return { ok: true, count: 1 };
      },
    });
    await page.goto('/admin/notes');
    await hideDevToolbar(page);
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    await card.locator('[data-delete]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0); // a jotting is not worth a modal
    await expect.poll(() => ops).toEqual(['trash']);
    await expect(page.locator('#notes-undo')).toContainText('Deleted');

    await page.locator('#notes-undo [data-undo-do]').click();
    await expect.poll(() => ops).toEqual(['trash', 'restore']);
    await expect(card).toBeVisible();
  });

  test('add to a piece files it into a chosen piece — and offers no undo, on purpose', async ({ page }) => {
    const calls: Array<{ noteId: string; targetId: string }> = [];
    await stubActions(page, {
      'fragments.appendToPiece': (req) => {
        calls.push(JSON.parse(req.postData() ?? '{}'));
        // Deliberately NOT the title of the row clicked below: the strip must
        // report what the server says the piece is called, so a rename made
        // elsewhere cannot leave this page confidently naming the wrong essay.
        return { title: 'A piece', slug: 'a-piece' };
      },
    });
    await page.goto('/admin/notes');
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    const id = await card.getAttribute('data-note');

    await card.locator('[data-append]').click();
    const picker = page.locator('#note-file');
    await expect(picker).toBeVisible();

    const first = picker.locator('[data-piece]').first();
    test.skip((await picker.locator('[data-piece]').count()) === 0, 'no writing to file into');
    const targetId = await first.getAttribute('data-piece');

    // The search filters what is already on the page — one round trip, like
    // LinkSheet. A term that matches nothing says so rather than looking broken.
    await page.locator('#note-file-q').fill('zzzzz-no-such-piece');
    await expect(page.locator('#note-file-none')).toBeVisible();
    await page.locator('#note-file-q').fill('');
    await expect(page.locator('#note-file-none')).toBeHidden();

    await first.click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({ noteId: id, targetId });

    // ⚠ NO UNDO BUTTON HERE, and that is the design: undoing an append means
    // editing the target's body back out, and the writing sheet may have saved
    // over it by then. The honest offer is the way to where the words went.
    const undo = page.locator('#notes-undo');
    await expect(undo).toContainText('Added to A piece');
    await expect(undo.locator('[data-undo-do]')).toBeHidden();
    await expect(undo.locator('a')).toHaveAttribute('href', `/admin/fragments#edit=${targetId}`);
  });
});
