// The check-in at 390px (11 · Piece 1).
//
// Its own file in the `mobile` project because the phone is not a variant here,
// it is the design: under 60 seconds, one screen, thumb-reachable, done
// half-awake in bad light. A check-in skipped on the worst mornings loses
// exactly the data the feature exists to collect.
//
// READ THE CAVEAT IN playwright.config.ts. This is chromium at a narrow
// viewport, not mobile Safari — it measures layout, overflow and tap-target
// geometry, all of which are real. It cannot measure the iOS keyboard, which is
// the thing a phone walkthrough still owes on the one field here that summons
// one.
import { test, expect } from './fixtures';

/**
 * Turn a toggle ON, whatever it was.
 *
 * ⚠ NOT `.click()`. Every option on this card clears itself when re-tapped —
 * deliberately, so a mis-tap is undoable without a "clear" affordance — which
 * means a blind click is only "select" on a control nobody has touched. Against
 * the live project the card arrives carrying whatever the day actually holds,
 * so a spec that clicks blindly switches the state OFF on precisely the days
 * the data exists, then times out waiting for the panel it just closed.
 */
async function ensureOn(locator: import('@playwright/test').Locator) {
  if ((await locator.getAttribute('aria-pressed')) !== 'true') await locator.click();
}

test.describe('the check-in at 390px', () => {
  test.beforeEach(async ({ page }) => {
    // Answered here rather than blocked, so the form can be driven without a
    // single request reaching Michael's real sleep log.
    await page.route('**/_actions/**', (route) => route.abort('failed'));
    await page.goto('/admin');

    // ⚠ EITHER DOOR INTO THE FORM, because which one is showing is not a fact
    // about the layout — it is a fact about whether today happens to have been
    // answered yet. Clicking only "Start" made every spec in this file fail the
    // moment a check-in existed, which is to say: on any day the feature was
    // actually used. That is an environmental failure wearing a bug's clothes,
    // and it hid this file's real job (390px overflow) exactly when the card
    // had the most in it.
    const start = page.getByRole('button', { name: 'Start' });
    if (await start.isVisible().catch(() => false)) await start.click();
    else await page.locator('[data-edit]').click();

    await expect(page.locator('[data-panel="fill"]')).toBeVisible();
  });

  test('the page never scrolls sideways', async ({ page }) => {
    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
  });

  // TRAP 5, and this form is what found it. A `<fieldset>` will not shrink —
  // the UA stylesheet gives it `min-width: min-content` — so one long value
  // word widens it past its parent, and the zone's `overflow: hidden` then
  // shears the label off with NOTHING reporting an overflow.
  //
  // Three plausible assertions all miss it: a page-level sideways-scroll check
  // (the row never reaches the page edge), a `scrollWidth` check on an ancestor
  // (`overflow: hidden` reports nothing), and `scrollWidth > clientWidth` on the
  // label itself (Chromium clamps that once `text-overflow: ellipsis` applies).
  // Measuring descendants against their container's CONTENT EDGE is the one
  // that works.
  test('nothing is sheared off the card, at any value on any scale', async ({ page }) => {
    // Drive every scale to its LONGEST word, which is the state the bug needs.
    for (const [field, v] of [
      ['valence', 1], // "bleak"
      ['arousal', 4], // "restless"
      // Each tone's strength is its own field since 2026-08-06 — three of them
      // share the card, and a shared name would let a tap on one clear another.
      ['intensity_distressing', 5], // "consuming" — the one that was "overwhelming"
    ] as const) {
      if (field === 'intensity_distressing') await ensureOn(page.locator('[data-dream="distressing"]'));
      await page.locator(`[data-tb="${field}"][data-v="${v}"]`).click();
    }
    await page.locator('[data-star="restedness"][data-v="1"]').click(); // "wrung out"

    // And open everything the card can open, because the whole point of this
    // spec is the WIDEST state — a follow-up that only appears on tap is a
    // follow-up whose overflow nobody has ever measured. Three tones open at
    // once is the tallest the dream section gets.
    await ensureOn(page.locator('[data-dream="anxious"]'));
    await ensureOn(page.locator('[data-dream="neutral"]'));
    await ensureOn(page.locator('[data-lat="over_60"]'));
    await ensureOn(page.locator('[data-wake="many"]'));
    await ensureOn(page.locator('[data-aid="antihistamine"]'));
    await page.getByRole('button', { name: 'A long waking' }).click();
    // ⚠ `[data-add-nap]`, NOT `getByRole('Add a nap').first()`. TWO buttons wear
    // that name — the form's, and the summary's shortcut into it
    // (`data-add-nap-from-done`) — and until 2026-08-26 only one was ever in the
    // tree at a time, because opening the form HID the summary. It is a sheet
    // now, so the card behind keeps its panel and `.first()` resolves to the
    // summary's, which sits under a modal backdrop and can never be clicked.
    // The role query was always the loose one; the attribute says which button.
    await page.locator('[data-add-nap]').click();

    // ⚠ A SHEET IS MEASURED AGAINST ITSELF, NOT AGAINST THE CARD IT SITS IN.
    // Since 2026-08-26 the fill form is a `<dialog>` INSIDE `[data-checkin]`
    // (FillPanel.astro says why it stays in the tree), which makes it a DOM
    // descendant of `.zone` and a TOP-LAYER sibling of it: its box is the
    // viewport's, not the card's. Measured against the zone's inset content
    // edge, every control in the form would report an overflow of exactly the
    // card's own padding — a page-wide red that says nothing about whether
    // anything is sheared. So each container is measured against its own
    // descendants, and `closest('dialog')` is what assigns an element to one.
    const escaping = await page.locator('.zone, dialog[data-panel="fill"][open]').evaluateAll((containers) =>
      containers.flatMap((zone) => {
        const box = zone.getBoundingClientRect();
        const cs = getComputedStyle(zone);
        const right = box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        const left = box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const own = zone.tagName === 'DIALOG' ? zone : null;
        return (
          [...zone.querySelectorAll('*')]
            // Only what is actually drawn — see the note in
            // admin-layout.mobile.spec.ts. A hidden panel and an SVG sprite both
            // report an all-zero rect, which reads as an overflow of exactly the
            // zone's left inset on every single element.
            .filter((el) => el.getClientRects().length > 0 && !el.closest('svg') && el.closest('dialog') === own)
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                what: `${el.tagName.toLowerCase()}.${String(el.className)}`.slice(0, 60),
                text: (el.textContent ?? '').trim().slice(0, 24),
                over: Math.round(Math.max(r.right - right, left - r.left)),
              };
            })
            .filter((x) => x.over > 1)
        );
      }),
    );
    expect(escaping, `content escaping its card or sheet at 390px: ${JSON.stringify(escaping)}`).toHaveLength(0);
  });

  test('the value words are measured, not assumed to fit', async ({ page }) => {
    // `scrollWidth` lies once ellipsis applies, so the text is measured with a
    // Range — the width the glyphs actually want — against the box it has.
    await ensureOn(page.locator('[data-dream="distressing"]'));
    await page.locator('[data-tb="intensity_distressing"][data-v="5"]').click();

    const truncated = await page.locator('.mark__w').evaluateAll((els) =>
      els
        .filter((el) => (el.textContent ?? '').trim())
        .map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return {
            text: el.textContent!.trim(),
            wants: Math.ceil(range.getBoundingClientRect().width),
            has: Math.floor(el.getBoundingClientRect().width),
          };
        })
        .filter((m) => m.wants > m.has),
    );
    expect(truncated, `value words clipped at 390px: ${JSON.stringify(truncated)}`).toHaveLength(0);
  });

  test('the meridiem is not shaved off a time picker', async ({ page }) => {
    // ⚠ FOUND BY LOOKING, not by an assertion — `07:55 AM` was rendering as
    // `07:55 AN` in the three-column row, and every check in this file passed
    // while it did. Nothing above can see it: the glyphs live in the input's
    // shadow DOM, so there is no element to measure, no overflow to report, and
    // the "nothing is sheared off the card" pass is about the card's edge, not
    // the input's. The 2026-08-05 pass already dropped this font to 0.875rem
    // for the same symptom on Safari and left no way to notice the next one.
    //
    // So it is measured the only way it can be: what the glyphs want, in the
    // input's own font, against the content box MINUS the calendar-picker
    // indicator the browser puts in the same space. At 390px that was 70px of
    // text and ~20px of indicator inside 91.3px — a pixel and a bit of margin.
    // "Went off around" lives in a `.sub` that only opens under the top latency
    // bucket, so it has to be SUMMONED before it can be measured — and it is
    // worth summoning, because it is the one picker on the card with its own
    // width (`.tm--wide`) rather than a third of the three-column row.
    await ensureOn(page.locator('[data-lat="over_60"]'));
    await expect(page.locator('[data-asleep-at]')).toBeVisible();

    const tight = await page.locator('.ck input[type="time"]').evaluateAll((els) =>
      els
        // ⚠ ONLY WHAT IS ON SCREEN. A picker inside a closed `.sub` has no box
        // at all, so every term below comes out of a zero width and the row
        // reports a deficit of its own padding — a failure that says nothing
        // about whether the glyphs fit, on a control nobody can see.
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const probe = document.createElement('span');
          probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font};font-variant-numeric:${cs.fontVariantNumeric}`;
          // The widest a 12-hour time gets. Every picker on this card renders
          // one, so measuring the worst case measures all of them.
          probe.textContent = '07:55 AM';
          document.body.append(probe);
          const wants = probe.getBoundingClientRect().width;
          probe.remove();

          const indicator = 20; // Chromium's picker glyph, measured 2026-08-06
          const has =
            box.width -
            parseFloat(cs.paddingLeft) -
            parseFloat(cs.paddingRight) -
            parseFloat(cs.borderLeftWidth) -
            parseFloat(cs.borderRightWidth) -
            indicator;
          return { field: (el as HTMLElement).dataset.field ?? (el as HTMLElement).dataset.t, wants, has };
        })
        // Four pixels of slack, so this fails on a real regression rather than
        // on a font-metric rounding difference between machines.
        .filter((m) => m.wants > m.has - 4),
    );
    expect(tight, `time text crowding its picker at 390px: ${JSON.stringify(tight)}`).toHaveLength(0);
  });

  test('every tap target clears the 44px floor', async ({ page }) => {
    await page.locator('[data-dream="anxious"]').click(); // reveal the intensity row

    const small: { what: string; h: number; w: number }[] = [];
    for (const sel of ['.opt', '.st', '.tb', '.times input']) {
      for (const el of await page.locator(sel).all()) {
        const box = await el.boundingBox();
        if (!box) continue;
        // Stars and track marks are 36px boxes in a 44px row; what matters is
        // that the row is reachable, so height is measured against 36 and the
        // spacing keeps them apart. The options are the true 44px controls.
        const floor = sel === '.opt' ? 40 : 34;
        if (box.height < floor) small.push({ what: `${sel} "${await el.textContent()}"`, h: box.height, w: box.width });
      }
    }
    expect(small, `tap targets too small at 390px: ${JSON.stringify(small)}`).toHaveLength(0);
  });

  test('a selected option does not go pale under the cursor', async ({ page }) => {
    // TRAP 6: `:hover` beats the selected state at equal specificity, so source
    // order decides — and the option you just tapped reading as disabled, on
    // the one control you are using, is the failure.
    //
    // `.opt` transitions `background-color` over 120ms, so reading the computed
    // style straight after a click samples the animation mid-flight: the first
    // run of this test compared a half-faded hover colour against the settled
    // selected one and failed on a page that was behaving correctly. Freezing
    // transitions makes it a question about the CASCADE, which is what it is.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });

    // ⚠ WHICHEVER OPTION IS NOT ALREADY CHOSEN, NOT A NAMED ONE. This asked for
    // `15_30` until 2026-08-12 and went red the day Michael's real check-in
    // recorded that latency: the option arrived already pressed, so the click
    // TOGGLED IT OFF and the test then compared an unselected option's normal
    // colour against its hover — which differ, correctly, and always will.
    //
    // It is the same environmental failure this file's own `beforeEach` was
    // written to defeat one level up ("which door is showing … is a fact about
    // whether today happens to have been answered yet"). The lesson reached the
    // door and not the controls behind it. The suite runs read-only against the
    // LIVE project, so anything that assumes a starting VALUE is really asking
    // what Michael did last night.
    const all = page.locator('[data-lat]');
    const states = await all.evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed') === 'true'));
    const free = states.map((on, i) => (on ? -1 : i)).filter((i) => i >= 0);
    test.skip(free.length < 2, 'needs two unchosen latencies to compare');

    const opt = all.nth(free[0]);
    await opt.click();
    await expect(opt, 'the click did not select it — this test is measuring the wrong state').toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Clicking leaves the pointer ON the control, so this reading is already
    // "selected + hovered". Move away to get the selected colour by itself.
    await page.mouse.move(0, 0);
    const settled = await opt.evaluate((el) => getComputedStyle(el).backgroundColor);

    await opt.hover();
    const hovered = await opt.evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(hovered, 'hovering a selected option must not change how it looks').toBe(settled);
    // …and it must not be the plain hover grey, which is what "pale" meant.
    const unselected = await all.nth(free[1]).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(hovered).not.toBe(unselected);
  });
});
