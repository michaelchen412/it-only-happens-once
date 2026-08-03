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
import { test, expect } from '@playwright/test';

test.describe('the check-in at 390px', () => {
  test.beforeEach(async ({ page }) => {
    // Answered here rather than blocked, so the form can be driven without a
    // single request reaching Michael's real sleep log.
    await page.route('**/_actions/**', (route) => route.abort('failed'));
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Start' }).click();
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
      ['dream_intensity', 5], // "consuming" — the one that was "overwhelming"
    ] as const) {
      if (field === 'dream_intensity') await page.locator('[data-dream="distressing"]').click();
      await page.locator(`[data-tb="${field}"][data-v="${v}"]`).click();
    }
    await page.locator('[data-star="restedness"][data-v="1"]').click(); // "wrung out"

    const escaping = await page.locator('.zone').evaluateAll((zones) =>
      zones.flatMap((zone) => {
        const box = zone.getBoundingClientRect();
        const cs = getComputedStyle(zone);
        const right = box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        const left = box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        return [...zone.querySelectorAll('*')]
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              what: `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60),
              text: (el.textContent ?? '').trim().slice(0, 24),
              over: Math.round(Math.max(r.right - right, left - r.left)),
            };
          })
          .filter((x) => x.over > 1);
      }),
    );
    expect(escaping, `content escaping its card at 390px: ${JSON.stringify(escaping)}`).toHaveLength(0);
  });

  test('the value words are measured, not assumed to fit', async ({ page }) => {
    // `scrollWidth` lies once ellipsis applies, so the text is measured with a
    // Range — the width the glyphs actually want — against the box it has.
    await page.locator('[data-dream="distressing"]').click();
    await page.locator('[data-tb="dream_intensity"][data-v="5"]').click();

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
    const opt = page.locator('[data-lat="15_30"]');
    await opt.click();
    const selected = await opt.evaluate((el) => getComputedStyle(el).backgroundColor);
    await opt.hover();
    const hovered = await opt.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(hovered).toBe(selected);
  });
});
