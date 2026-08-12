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
import type { Page } from '@playwright/test';
import { test, expect, hideDevToolbar, stubActions } from './fixtures';
// ⚠ THE SAME FUNCTION THE ROOM USES, not a restatement of it. Triage hands the
// sheets plain text, because a task's title is an `<input>` and a log entry's
// body is a `<textarea>` — neither can render `**`. Asserting on the raw
// Markdown would pass on today's plain dumps and fail the day one holds a mark.
import { stripMarkdown } from '../../src/lib/markdown-plain';

/** Pull one field out of a multipart body — enough to assert the contract. */
function field(body: string | null, name: string): string | null {
  if (!body) return null;
  return body.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`))?.[1] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What you type into. ⚠ NOT `#cap-box` ITSELF since 2026-08-06 — that is the
 * scroller now, and TipTap renders the editable element inside it. Every
 * `fill`, `press` and focus assertion below wants the contenteditable.
 */
const capBox = (page: Page) => page.locator('#cap-box [contenteditable="true"]');

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
    await expect(capBox(page)).toBeFocused(); // land ready to type
    await expect(page).toHaveURL(/\/admin\/agenda$/); // still exactly where you were
  });

  test('the ✚ is not a zone on Today', async ({ page }) => {
    // 14 §4 wanted a card here; 10-hq §10c overruled it, and the reason is that
    // Today answers "what is my day" and a dump box answers nothing about it.
    await page.goto('/admin');
    await expect(page.locator('#cap-box')).toBeHidden(); // present in the dialog, not on the page
    await expect(page.locator('main #cap-box')).toHaveCount(0);
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
    const box = capBox(page);

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
    await expect(box).toHaveText(''); // a contenteditable now, so text rather than value
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
    const box = capBox(page);

    await box.fill('one');
    await expect.poll(() => ids.length).toBe(1);
    await box.press('ControlOrMeta+Enter');
    await expect(box).toHaveText('');

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
    await capBox(page).fill('the thing I would have lost');
    await page.keyboard.press('Escape');
    await expect.poll(() => bodies).toContain('the thing I would have lost');
    // ⚠ THE SECOND LINE IS NOT A FORMALITY, and it caught a real one. A
    // <dialog> only treats Escape as a close request if the keydown's default
    // survives, and ProseMirror preventDefaults Escape unconditionally — so
    // the day the box became an editor this stopped closing, silently, with
    // the save still working. capture.ts closes it by hand now.
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
    // ⚠ SCOPED TO THE PILE, and it took two goes to get the scope right.
    // Unscoped, `input[type=checkbox]` matched two controls inside Astro's dev
    // toolbar, because Playwright's selectors pierce open shadow roots and
    // `document.querySelectorAll` does not. Scoped to `main`, it then matched
    // the task sheet's lead-override checkbox once Piece 2 mounted that sheet
    // in this room. Both looked exactly like a defect in the pile; neither was.
    // The claim being made is about the PILE, so that is what it asks about.
    await expect(page.locator('#notes-pile table')).toHaveCount(0);
    await expect(page.locator('#notes-pile input[type="checkbox"]')).toHaveCount(0);
    expect(await page.locator('#notes-pile').innerText()).not.toContain('untitled');
  });

  test('three controls on every card, at the tap floor — not six', async ({ page }) => {
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    // Piece 2 added two destinations and did NOT add two icons: the four ways
    // out are one question, asked once, behind →.
    await expect(card.locator('.dump__act')).toHaveCount(3);
    for (const sel of ['[data-edit]', '[data-file]', '[data-delete]']) {
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

    // ⚠ THE EDITOR IS IN THE CARD, not the card's own textarea — since
    // 2026-08-06 the room has exactly ONE and moves it to whichever card you
    // open. `#dump-shell` living inside `.dump` is the whole claim.
    const shell = card.locator('#dump-shell');
    await expect(shell).toBeVisible();
    const box = shell.locator('[contenteditable="true"]');
    await expect(box).toBeFocused();
    expect((await box.innerText()).trim()).toBe(text.trim()); // the same words, not a fetch
    await expect(card.locator('[data-text]')).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/notes$/);

    // Escape returns to reading without asking anything, and the editor goes
    // home — a card that kept it would leave the pencil dead everywhere else.
    await page.keyboard.press('Escape');
    await expect(shell).toHaveCount(0);
    await expect(card.locator('[data-text]')).toBeVisible();
  });

  test('the card carries the writing sheet’s controls, and they format the words', async ({ page }) => {
    // The ask this shipped for (2026-08-06): the same toolbar the composer has,
    // in the pile. Bold is the cheapest proof that the whole chain works —
    // toolbar → TipTap → Markdown → the body that gets saved.
    const saved: Array<string | null> = [];
    await stubActions(page, {
      'fragments.saveWriting': (req) => {
        saved.push(field(req.postData(), 'body'));
        return { id: field(req.postData(), 'id'), slug: 'stub', updated_at: new Date().toISOString() };
      },
    });
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    await card.locator('[data-edit]').click();
    const toolbar = card.locator('#dump-shell [role="toolbar"]');
    // Not an assertion about a count: the claim is that these commands exist
    // here, the same ones EditorToolbar gives the writing sheet.
    for (const cmd of ['bold', 'italic', 'h2', 'bulletList', 'link', 'image']) {
      await expect(toolbar.locator(`[data-cmd="${cmd}"]`)).toBeVisible();
    }

    const box = card.locator('#dump-shell [contenteditable="true"]');
    await box.click();
    await page.keyboard.press('ControlOrMeta+A');
    await toolbar.locator('[data-cmd="bold"]').click();
    // Not a count: select-all over a dump of several paragraphs marks each one,
    // and how many blocks the first card happens to hold is not the claim.
    expect(await box.locator('strong').count()).toBeGreaterThan(0); // bold on screen…
    await expect.poll(() => saved.at(-1) ?? '').toMatch(/\*\*/); // …and bold in what was stored
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

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="piece"]').click();

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

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="append"]').click();
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

test.describe('the chooser — four destinations, one question', () => {
  test('the log row exists only when there is somebody to log about', async ({ page }) => {
    // ⚠ THE PROPERTY, NOT THE CURRENT STATE. The roster is empty today, so a
    // bare `toHaveCount(0)` would pass for ever and prove nothing the day
    // Michael adds a person. So it reads the roster and asserts the two agree
    // — 10-hq §10b: a domain that does not exist yet renders nothing at all.
    await page.goto('/admin/people');
    const people = await page.locator('[data-person]').count();

    await page.goto('/admin/notes');
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    await page.locator('.dump').first().locator('[data-file]').click();

    const logRow = page.locator('#dump-file [data-as="log"]');
    await expect(logRow).toHaveCount(people > 0 ? 1 : 0);
    // The other three never depend on anything existing first.
    for (const as of ['agenda', 'piece', 'append']) {
      await expect(page.locator(`#dump-file [data-as="${as}"]`)).toHaveCount(1);
    }
  });

  test('opens in the top layer, under the card that asked for it', async ({ page }) => {
    // Trap 7: a menu anchored inside a card would be clipped or covered, and
    // inert in a way typecheck, build and a screenshot all pass. This asserts
    // the two things that would break — that it is actually open, and that it
    // is positioned against ITS OWN card rather than the first one.
    await page.goto('/admin/notes');
    const cards = page.locator('.dump');
    test.skip((await cards.count()) < 2, 'needs two dumps to tell the anchors apart');

    const second = cards.nth(1);
    await second.locator('[data-file]').click();
    const menu = page.locator('#dump-file');
    await expect(menu).toBeVisible();

    const trigger = await second.locator('[data-file]').boundingBox();
    const box = await menu.boundingBox();

    // ⚠ ADJACENT TO ITS OWN TRIGGER, ON WHICHEVER SIDE FITS — not "below".
    //
    // This asserted `box.y > trigger.y` until 2026-08-12, and that was wrong in
    // a way worth keeping written down: `pop-anchor.ts` places the menu below by
    // default and ABOVE when below would run off the bottom of the window, which
    // is a documented branch and not a fallback. At 1280×720 the second card's
    // trigger sits at y=574, so below would end at 778 against a 714 limit and
    // the menu correctly flips to 414. The spec went red on correct behaviour
    // the moment the pile grew a second card low enough to trigger it.
    //
    // ⚠ AND THE OLD ASSERTION COULD NOT TELL THE TWO CASES APART, which is the
    // real reason to replace it rather than invert it. A menu wrongly anchored
    // to the FIRST card would sit at y≈267 — also less than 574, also red, for
    // the opposite reason. It failed on the right answer and the wrong one
    // identically, so it never proved the thing its own comment claims.
    //
    // Proximity does discriminate: anchored to its own trigger the menu touches
    // it on one side or the other, and anchored to the first card it is ~300px
    // away from both.
    const GAP = 6; // pop-anchor.ts
    const belowGap = Math.abs(box!.y - (trigger!.y + trigger!.height));
    const aboveGap = Math.abs(box!.y + box!.height - trigger!.y);
    expect(
      Math.min(belowGap, aboveGap),
      `menu at ${box!.y}–${box!.y + box!.height} is anchored to neither side of its trigger at ${trigger!.y}–${trigger!.y + trigger!.height}`,
    ).toBeLessThanOrEqual(GAP + 1);
    expect(Math.abs(box!.x - trigger!.x)).toBeLessThan(200); // …and beside it
  });

  test('Escape closes it without filing anything', async ({ page }) => {
    const seen = await stubActions(page, {});
    await page.goto('/admin/notes');
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    await page.locator('.dump').first().locator('[data-file]').click();
    await expect(page.locator('#dump-file')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dump-file')).toBeHidden();
    expect(seen()).toEqual([]);
  });
});

/**
 * What the sheet actually puts in the title box: the dump's first line, capped.
 *
 * Mirrors `task-sheet.ts`'s `.slice(0, 200)` rather than restating the number in
 * two assertions — the cap is product behaviour (an agenda row must stay
 * readable), so a spec that expects the untruncated text is asserting something
 * the app has never done.
 */
const TITLE_CAP = 200;
const titleFrom = (text: string): string => text.split('\n')[0].trim().slice(0, TITLE_CAP);

test.describe('note → the Agenda', () => {
  test('opens the real task sheet, with the dump already in it', async ({ page }) => {
    await stubActions(page, {});
    await page.goto('/admin/notes');
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    const text = (await card.locator('[data-text]').innerText()).trim();

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="agenda"]').click();

    const sheet = page.locator('#task-sheet');
    await expect(sheet).toBeVisible();
    // THE REAL SHEET, not a smaller copy: the controls that make a task worth
    // making are all here, which is why this is a sheet and not a one-tap
    // create.
    await expect(sheet.locator('[data-due]')).toBeVisible();
    await expect(sheet.locator('[data-effort]').first()).toBeVisible();
    // The first line becomes the title — a five-line thought in a title would
    // make the agenda unreadable.
    //
    // ⚠ AND IT IS CAPPED, which this used to ignore. `task-sheet.ts` does
    // `.slice(0, TITLE_CAP)` deliberately: the first LINE of a dump can still be
    // a whole paragraph, and an agenda row is not a place to read one. The spec
    // discovers a real note rather than seeding one, so it passed for as long as
    // the top of the pile happened to be short and went red the day it wasn't —
    // green by luck, which is worse than red.
    await expect(sheet.locator('input[name="title"]')).toHaveValue(titleFrom(text));
  });

  test('saving files the dump: one task, the note consumed, and a way back', async ({ page }) => {
    const calls: Array<{ name: string; body: string }> = [];
    await stubActions(page, {
      'tasks.save': (req) => {
        calls.push({ name: 'tasks.save', body: req.postData() ?? '' });
        return { id: '00000000-0000-4000-8000-00000000beef' };
      },
      'fragments.bulk': (req) => {
        calls.push({ name: 'fragments.bulk', body: req.postData() ?? '' });
        return { ok: true, count: 1 };
      },
      'tasks.remove': (req) => {
        calls.push({ name: 'tasks.remove', body: req.postData() ?? '' });
        return { ok: true };
      },
    });

    await page.goto('/admin/notes');
    await hideDevToolbar(page);
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    const id = await card.getAttribute('data-note');

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="agenda"]').click();
    await page.waitForSelector('#task-sheet[open]');
    await page.locator('#task-sheet [data-submit]').click();

    // ⚠ THE ORDER IS THE ASSERTION. The task is written FIRST and the note is
    // consumed second — the other way round loses the thought whenever the
    // second call fails.
    await expect.poll(() => calls.map((c) => c.name)).toEqual(['tasks.save', 'fragments.bulk']);
    expect(field(calls[1].body, 'op')).toBe('trash');
    expect(field(calls[1].body, 'ids')).toBe(id);

    // And unlike an append, this one CAN be taken back — a task is a whole row.
    const undo = page.locator('#notes-undo');
    await expect(undo).toContainText('Filed as a task');
    await expect(undo.locator('a[href="/admin/agenda/tasks"]')).toBeVisible();
    await undo.locator('[data-undo-do]').click();
    await expect
      .poll(() => calls.map((c) => c.name))
      .toEqual(['tasks.save', 'fragments.bulk', 'tasks.remove', 'fragments.bulk']);
    expect(field(calls[3].body, 'op')).toBe('restore');
  });

  test('⚠ abandoning the sheet leaves the dump alone', async ({ page }) => {
    // The failure this guards is a thought deleted by a save that had nothing
    // to do with it: close on a note, save an unrelated task later, and a
    // careless implementation consumes the note it was opened for.
    const seen = await stubActions(page, {});
    await page.goto('/admin/notes');
    const card = page.locator('.dump').first();
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="agenda"]').click();
    await page.waitForSelector('#task-sheet[open]');
    await page.keyboard.press('Escape');
    await expect(page.locator('#task-sheet')).toBeHidden();
    await expect(card).toBeVisible();
    await expect(card).not.toHaveClass(/dump--going/);
    // ⚠ "NOTHING WAS WRITTEN", not "nothing was called". Since 14 · Piece 3 the
    // read-only `tasks.parse` fires on the way to the sheet, and an assertion
    // that counts every request would call that a write. This is the same trap
    // that has four check-in specs red: `/admin` syncs the Google mirror after
    // paint, and those specs count it as an answer to the check-in.
    expect(seen().filter((n) => n !== 'tasks.parse')).toEqual([]);
  });
});

test.describe('note → log entry', () => {
  // ⚠ THESE SKIP ON AN EMPTY ROSTER, which is the normal state of this project
  // today — so read a green run here as "not contradicted", not as "covered".
  // What actually exercised this path was a live pass: a seeded person, the
  // real `interactions.save`, a real row with the picked kind and date, and the
  // undo deleting it again. That is recorded in the plans.
  const needsRoster = async (page: Page) => {
    await page.goto('/admin/people');
    const people = await page.locator('[data-person]').count();
    test.skip(people === 0, 'no roster — logging is not offered, by design');
    await page.goto('/admin/notes');
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
  };

  test('opens prefilled, and refuses to save until somebody is named — visibly', async ({ page }) => {
    await stubActions(page, {});
    await needsRoster(page);
    const card = page.locator('.dump').first();
    const text = stripMarkdown(await card.locator('[data-edit-box]').inputValue());

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="log"]').click();

    const sheet = page.locator('#log-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-log-body]')).toHaveValue(text);

    const save = sheet.locator('[data-log-save]');
    await expect(save).toBeDisabled();
    // ⚠ AND IT HAS TO LOOK IT. `toBeDisabled()` passed for the whole of this
    // piece's development while the button rendered at full saturation and read
    // as pressable — `.zone__cta` was overriding daisyUI's disabled styling. A
    // screenshot caught it; this is what keeps it caught.
    const off = await save.evaluate((el) => getComputedStyle(el).backgroundColor);

    await sheet.locator('[data-who-open]').click();
    await page.locator('#ls-who [data-who]').first().click();
    await expect(save).toBeEnabled();
    const on = await save.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(off).not.toBe(on);
  });

  test('files the entry, consumes the dump, and takes both back', async ({ page }) => {
    const calls: Array<{ name: string; body: string }> = [];
    await stubActions(page, {
      'interactions.save': (req) => {
        calls.push({ name: 'interactions.save', body: req.postData() ?? '' });
        return { id: '00000000-0000-4000-8000-0000000000aa' };
      },
      'fragments.bulk': (req) => {
        calls.push({ name: 'fragments.bulk', body: req.postData() ?? '' });
        return { ok: true, count: 1 };
      },
      'interactions.remove': (req) => {
        calls.push({ name: 'interactions.remove', body: req.postData() ?? '' });
        return { ok: true };
      },
    });
    await needsRoster(page);
    await hideDevToolbar(page);
    const card = page.locator('.dump').first();

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="log"]').click();
    await page.locator('#log-sheet [data-who-open]').click();
    await page.locator('#ls-who [data-who]').first().click();
    await page.locator('#log-sheet [data-log-save]').click();

    // The entry is written FIRST; the dump is consumed only once it exists.
    await expect.poll(() => calls.map((c) => c.name)).toEqual(['interactions.save', 'fragments.bulk']);
    expect(field(calls[1].body, 'op')).toBe('trash');

    const undo = page.locator('#notes-undo');
    await expect(undo).toContainText('Filed as a log entry');
    // No "Open →": an entry lives on a profile, and which profile depends on
    // who you picked — so the strip says nothing rather than guessing.
    await expect(undo.locator('a')).toHaveCount(0);
    await undo.locator('[data-undo-do]').click();
    await expect
      .poll(() => calls.map((c) => c.name))
      .toEqual(['interactions.save', 'fragments.bulk', 'interactions.remove', 'fragments.bulk']);
  });
});

test.describe('the parser (14 · Piece 3)', () => {
  // ⚠ THE MODEL IS STUBBED IN ALL OF THESE. What they prove is that the client
  // does the right thing with a given reading — the filling, the lead PAIR, the
  // kind bar, the fallback. Whether the reading itself is any good was settled
  // in `/admin/parse-lab` against the real model and recorded in the plans; the
  // lab is deleted, and this is what survives it.
  const READING = {
    parsed: {
      kind: 'task',
      title: 'Appointment with the dentist',
      notes: 'bring a gift every single time',
      due_on: { value: '2026-08-06', from: 'every Thursday' },
      due_time: { value: '16:00', from: '4:00 p.m.' },
      lead_days: { value: 1, from: 'warn me one day ahead' },
      recurrence: { value: 'weekly', from: 'every Thursday' },
      effort: null,
      priority: { value: 'high', from: 'very important' },
      unschedulable: null,
      ambiguous: null,
    },
    why: 'it repeats, and an event cannot',
    meta: { ms: 900, inputTokens: 10, outputTokens: 10 },
    error: null,
  };

  test('fills the whole sheet, and ticks the lead override with the number', async ({ page }) => {
    await stubActions(page, { 'tasks.parse': () => READING });
    await page.goto('/admin/notes');
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    await page.locator('.dump').first().locator('[data-file]').click();
    await page.locator('#dump-file [data-as="agenda"]').click();
    await page.waitForSelector('#task-sheet[open]');
    const s = page.locator('#task-sheet');

    await expect(s.locator('input[name="title"]')).toHaveValue('Appointment with the dentist');
    await expect(s.locator('textarea[name="notes"]')).toHaveValue('bring a gift every single time');
    await expect(s.locator('[data-due]')).toHaveValue('2026-08-06');
    await expect(s.locator('[data-time]')).toHaveValue('16:00');
    await expect(s.locator('[data-prio][aria-checked="true"]')).toHaveAttribute('data-prio', 'high');

    // ⚠ THE PAIR. The lead override is a checkbox AND a count; filling only the
    // number sends `leadDays` blank and effort's default (3 days) silently
    // wins — "warn me one day ahead" would warn three days ahead for ever,
    // with nothing on screen disagreeing.
    await expect(s.locator('[data-override-on]')).toBeChecked();
    await expect(s.locator('[data-override-n]')).toHaveValue('1');

    // A preset, never a rule string — 13 · Piece 1's contract.
    await expect(s.locator('[data-rep][aria-checked="true"]')).toHaveAttribute('data-rep', 'fixed');
    await expect(s.locator('[data-preset]')).toHaveValue('weekly');

    // §6.3: which words produced the date. A date alone cannot be judged.
    await expect(s.locator('[data-parsed-from="due_on"]')).toContainText('every Thursday');
  });

  test('the kind is stated, never silent, and reversible in one tap', async ({ page }) => {
    await stubActions(page, { 'tasks.parse': () => READING });
    await page.goto('/admin/notes');
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');

    await page.locator('.dump').first().locator('[data-file]').click();
    await page.locator('#dump-file [data-as="agenda"]').click();
    await page.waitForSelector('#task-sheet[open]');

    // This bar is what keeps a router honest (10-hq §4.21): the guess is named,
    // explained from the fields, and undoable before anything is written.
    const bar = page.locator('#task-sheet [data-kindbar]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Task');
    await expect(bar).toContainText('it repeats, and an event cannot');

    await bar.locator('[data-kind-switch]').click();
    await page.waitForSelector('#event-sheet[open]');
    // The whole parse moves across — a one-tap correction must not re-read the
    // sentence, which would cost another call and could answer differently.
    await expect(page.locator('#event-sheet input[name="title"]')).toHaveValue('Appointment with the dentist');
    await expect(page.locator('#event-sheet [data-kindbar]')).toContainText('Make it a task instead');

    // ⚠ ONE SHEET, NOT TWO (docs/plans/25 · §1). `showModal()` on a second
    // <dialog> STACKS rather than replacing, and this spec used to stop one
    // line above — so the task sheet sat underneath, still populated, and was
    // revealed again the moment you closed the event sheet. The switch is a
    // correction, and a correction that leaves the wrong answer on screen
    // behind the right one has not corrected anything.
    await expect(page.locator('#task-sheet')).not.toHaveAttribute('open', '');
    await expect(page.locator('#task-sheet')).toBeHidden();
  });

  test('⚠ a dead model leaves the motion exactly as it was without the parser', async ({ page }) => {
    // §6.4. The parser may never make triage worse by existing — no error, no
    // empty sheet, just Piece 2's naive split.
    await stubActions(page, { 'tasks.parse': () => ({ parsed: null, why: null, meta: null, error: 'no credit' }) });
    await page.goto('/admin/notes');
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    const card = page.locator('.dump').first();
    const first = stripMarkdown(await card.locator('[data-edit-box]').inputValue())
      .split('\n')[0]
      .trim();

    await card.locator('[data-file]').click();
    await page.locator('#dump-file [data-as="agenda"]').click();
    await page.waitForSelector('#task-sheet[open]');

    await expect(page.locator('#task-sheet input[name="title"]')).toHaveValue(titleFrom(first));
    await expect(page.locator('#task-sheet [data-kindbar]')).toBeHidden(); // nothing was judged
    await expect(page.locator('#task-error')).toBeHidden(); // and nothing is wrong
  });

  test('a reading it cannot honour is said out loud', async ({ page }) => {
    await stubActions(page, {
      'tasks.parse': () => ({
        ...READING,
        parsed: { ...READING.parsed, recurrence: null, unschedulable: 'every three weeks' },
      }),
    });
    await page.goto('/admin/notes');
    test.skip((await page.locator('.dump').count()) === 0, 'the pile is empty');
    await page.locator('.dump').first().locator('[data-file]').click();
    await page.locator('#dump-file [data-as="agenda"]').click();
    await page.waitForSelector('#task-sheet[open]');
    // Never rounded to the nearest preset — the schema cannot express it, so
    // the sheet says so rather than storing something close.
    await expect(page.locator('#task-sheet [data-parsed-warn]')).toContainText('every three weeks');
  });
});
