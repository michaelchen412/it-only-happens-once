// The WORKSHOP's sheets leave the way the public reader does — they animate out
// instead of vanishing, on every engine rather than only in Chromium.
//
// ⚠ THIS IS `reader-close.anon.spec.ts`'s ARGUMENT, APPLIED TO THE OTHER TWENTY
// DIALOGS. That file proved the property for `#site-reader` on 2026-08-11 and
// the fix stopped there: the reader was converted to `closeWithExit`, the
// workshop's sheets were not, and `admin.css` wrote the debt down in a comment
// nobody read for four days. Michael found it by using the building on a phone:
// *"the popovers, sheets, and dialogues on iOS and Chrome never close
// gracefully, no matter where we are."*
//
// So the interesting assertion is the third one that file describes, and it is
// the ONLY one that would have caught the gap:
//
//     the exit transition finishes while `dialog.open` is still TRUE.
//
// Animating a dialog out after `close()` needs the CSS `overlay` property to
// hold it in the top layer, and `overlay` is Chromium-only — absent in Safari
// (desktop and iOS) and in Firefox. Every iOS browser is WebKit, so "Chrome on
// an iPhone" is Safari. A Chromium-only suite passes "the exit ran" either way
// and can never see the difference. `slidWhileOpen` can: it is a property test
// standing in for a browser this suite cannot run.
//
// ⚠ AND `src/tests/dialog-exit.test.ts` IS THE OTHER HALF, deliberately. That
// one greps for the forbidden call and so covers every dialog including the ones
// too fiddly to open here; this one proves the pattern actually produces the
// animation in a real browser, on one drawer and one modal. Neither is
// sufficient alone — a unit test cannot see a transition, and a browser test
// cannot visit twenty sheets without becoming the slowest file in the suite.
//
// Read-only: `test` comes from ./fixtures, which blocks `/_actions/**`, and
// nothing below saves anything.
import type { Page } from '@playwright/test';
// ⚠ `test` FROM ./fixtures, never from @playwright/test — that import is what
// carries the read-only guard (2026-08-09).
import { test, expect } from './fixtures';

interface Exit {
  /** The exit transition ran to completion on a node still in the document. */
  animated: boolean;
  /** …and finished while the dialog was still open. The whole cross-engine fix. */
  animatedWhileOpen: boolean;
  open: boolean;
}

/**
 * Close `selector` and report what happened to it.
 *
 * The listener goes on BEFORE the close and resolves from the event, so this
 * measures the exit rather than sampling it. `property` differs by shape: a
 * `.drawer-dialog` slides (`translate`), a `.modal-dialog` fades (`opacity`).
 */
async function closeAndWatch(page: Page, selector: string, property: string, dismiss: () => Promise<void>) {
  await page.evaluate(
    ([sel, prop]) => {
      const d = document.querySelector(sel!) as HTMLDialogElement;
      const w = window as unknown as { __exit: { animated: boolean; animatedWhileOpen: boolean } };
      w.__exit = { animated: false, animatedWhileOpen: false };
      // `transitionend` fires once per property and bubbles — take the sheet's
      // own, and ignore a hover transition on some button inside it. The
      // `pseudoElement` check matters too: a ::backdrop transition dispatches
      // ON the dialog, and the backdrop is not what is being measured.
      d.addEventListener('transitionend', (e) => {
        if (e.target !== d || e.propertyName !== prop || e.pseudoElement || !document.contains(d)) return;
        w.__exit.animated = true;
        if (d.open) w.__exit.animatedWhileOpen = true;
      });
    },
    [selector, property],
  );

  await dismiss();
  await expect(page.locator(selector)).toHaveJSProperty('open', false);
  // Longer than the slowest exit (0.28s) with room for a slow CI frame.
  await page.waitForTimeout(700);

  return page.evaluate((sel) => {
    const d = document.querySelector(sel) as HTMLDialogElement;
    const w = window as unknown as { __exit: { animated: boolean; animatedWhileOpen: boolean } };
    return { ...w.__exit, open: d.open } as Exit;
  }, selector);
}

/** Open a sheet and wait for it to STOP MOVING before measuring its exit. */
async function openAndSettle(page: Page, opener: string, selector: string) {
  await page.locator(opener).first().click();
  await expect(page.locator(selector)).toHaveJSProperty('open', true);
  // ⚠ WAIT FOR THE SLIDE-IN TO FINISH. Closing a sheet that is still arriving
  // REVERSES the transition, and a reversed transition is shortened to match how
  // far it got — which made the reader's version of this file fail about half
  // the time for a reason that had nothing to do with the code under test.
  await page.waitForFunction(
    (sel) => {
      const d = document.querySelector(sel) as HTMLDialogElement;
      if (!d) return false;
      const s = getComputedStyle(d);
      return ['0px', 'none', '0px 0px'].includes(s.translate) && s.opacity === '1';
    },
    selector,
    { timeout: 5000 },
  );
}

/*
 * One drawer and one modal — the two exit shapes `admin.css` defines, and the
 * only two there are. Every other sheet in the building carries one of these
 * classes and closes through the same `closeWithExit`, so a third row here would
 * buy coverage of a call site rather than of a behaviour. The greps in
 * `src/tests/dialog-exit.test.ts` cover the call sites.
 */
const SHEETS = [
  {
    what: 'a drawer sheet (the event sheet)',
    room: '/admin/agenda',
    opener: '[data-open-event-sheet]',
    selector: '#event-sheet',
    property: 'translate',
    // `.first()` at the call site: `[data-close]` is the ADR 0032 contract, not
    // an id, so a sheet may carry more than one — this one has the header's ✕
    // and a Cancel in the foot. Both route to the same `requestClose`, which is
    // the whole point of the contract; the ✕ is simply the one every sheet has.
    close: '#event-sheet [data-close]',
  },
  {
    what: 'a modal dialog (the ✚ capture box)',
    room: '/admin/notes',
    // ⚠ THE ONE MICHAEL REPORTED, 2026-08-15: *"our notes pop-over dialog
    // doesn't close gracefully… it opens fine but immediately closes with no
    // transition."* Two things were doing that — `dialog.close()`, and a
    // `location.reload()` in the same tick when standing in this room. This
    // spec covers the first; the reload only fires after a save, which the
    // read-only guard makes impossible here, so it is pinned by the code
    // comment in `capture.ts` rather than by an assertion.
    opener: '#cap-open',
    selector: '#cap-dialog',
    property: 'opacity',
    close: '#cap-done',
  },
] as const;

for (const sheet of SHEETS) {
  test(`${sheet.what} animates out, and is still open while it does`, async ({ page }) => {
    await page.goto(sheet.room);
    await openAndSettle(page, sheet.opener, sheet.selector);

    const exit = await closeAndWatch(page, sheet.selector, sheet.property, () =>
      page.locator(sheet.close).first().click(),
    );

    expect(exit.animated, 'the exit never finished on the live node — the sheet vanished instead of leaving').toBe(
      true,
    );
    expect(
      exit.animatedWhileOpen,
      'the exit finished on a CLOSED dialog — that only renders in Chromium, and on every iOS browser the sheet ' +
        'vanishes instantly. Close through closeWithExit() (scripts/dialog-close.ts), not dialog.close().',
    ).toBe(true);
    expect(exit.open, 'the dialog never actually shut').toBe(false);
  });

  test(`${sheet.what} animates out on Escape too`, async ({ page }) => {
    // ⚠ ESCAPE IS ITS OWN TEST BECAUSE IT IS ITS OWN CODE PATH. A `<dialog>`'s
    // native `cancel` closes in the same frame, so a sheet whose ✕ was converted
    // and whose `cancel` was not animates from a click and snaps from a key —
    // the same bug, hiding behind the gesture nobody demos.
    await page.goto(sheet.room);
    await openAndSettle(page, sheet.opener, sheet.selector);

    const exit = await closeAndWatch(page, sheet.selector, sheet.property, () => page.keyboard.press('Escape'));

    expect(exit.animated).toBe(true);
    expect(
      exit.animatedWhileOpen,
      'Escape closed natively — intercept `cancel` and route it through closeWithExit',
    ).toBe(true);
    expect(exit.open).toBe(false);
  });
}

test('reopening a sheet mid-exit keeps it open', async ({ page }) => {
  // ⚠ THE FAILURE `openDialog` EXISTS TO PREVENT, and it is invisible without a
  // test: a sheet that leaves while still `open` is a sheet that can be reopened
  // during its own exit. Tapping a second row straight after dismissing the
  // first is an ordinary thing to do in a list. Without the `[data-closing]`
  // handshake the pending close either throws InvalidStateError on `showModal()`
  // or — worse, because it looks like nothing — shuts the sheet you just asked
  // for, 300ms after it arrives.
  await page.goto('/admin/agenda');
  await openAndSettle(page, '[data-open-event-sheet]', '#event-sheet');

  await page.locator('#event-sheet [data-close]').first().click();
  // Mid-slide, deliberately: 100ms into a 280ms exit.
  await page.waitForTimeout(100);
  await page.locator('[data-open-event-sheet]').first().click();

  // Well past when the interrupted close would have landed.
  await page.waitForTimeout(700);
  await expect(page.locator('#event-sheet')).toHaveJSProperty('open', true);
  expect(
    await page.evaluate(() => document.querySelector('#event-sheet')?.getAttribute('data-closing')),
    'the sheet is open but still flagged as closing — it will shut itself on the next exit',
  ).toBe(null);
});
