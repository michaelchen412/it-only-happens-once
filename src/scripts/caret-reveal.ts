// `keepCaretClear` — the half of a docked toolbar that iOS hands a native app
// for free, and the web does not.
//
// ⚠ THE COMPLAINT (Michael, on an iPhone, 2026-08-18): *"the caret is like
// nestled between some buttons on the formatting toolbar, just flashing."*
//
// WHAT ACTUALLY HAPPENS, in order:
//   1. You tap into the middle of a piece. WebKit places the caret and starts
//      raising the keyboard.
//   2. WebKit runs its OWN caret reveal, which scrolls exactly far enough to
//      clear the KEYBOARD. It knows the keyboard's frame. It knows nothing
//      about the strip of our HTML parked on top of that frame.
//   3. `--kb` lands (scripts/keyboard-inset.ts), the drawer shrinks to
//      `100dvh - --kb`, and the scroller shrinks with it. `scrollTop` does not
//      move — so the caret WebKit had just placed against the old bottom edge
//      is now BELOW the new one, outside the scrollport, while WebKit goes on
//      painting it in its own layer regardless. What it paints over is the
//      toolbar. Hence "nestled between the buttons": the caret is not on top of
//      the toolbar, it is out of the document and being drawn there anyway.
//
// ⚠ THE TOOLBAR IS NOT THE DEFECT, AND PUTTING IT BACK ON TOP WAS THE OPTION
// THAT LOST. Docked-above-the-keyboard is what every editor worth copying does
// — iOS Notes / Mail / Bear through `inputAccessoryView`, Google Docs, Notion,
// Slack, Gutenberg — and a top bar puts formatting at the far end of the screen
// from both the thumbs and the words being formatted, which is the argument
// `#ws-toolbar` in admin.css already made and should not have to make twice.
// The move up would not even have fixed this: step 3 loses the caret out of the
// scrollport on its own account, which is the same failure as the complaint
// that produced `--kb` in the first place — *"the point of focus gets hard to
// scroll… have to click out and click in again."* That fix gave the SHEET the
// right geometry and left the caret being revealed against the old one.
//
// A native app never meets any of this, because an `inputAccessoryView` is part
// of the keyboard's frame and UIKit's caret reveal subtracts it automatically.
// The web has no equivalent: the VirtualKeyboard API (`overlaysContent` +
// `env(keyboard-inset-height)`) is Chromium-only six years after the spec and
// WebKit has not shipped it. So the subtraction is ours to do by hand, and
// `--kb` stays load-bearing rather than becoming a CSS variable someone else
// maintains.
//
// ⚠ `scroll-padding-block-end` DOES NOT REACH THIS, which is worth saying
// because `#ws-scroll` has carried 6rem of it since the runway pass and it
// looks like it should. Scroll padding governs the scrolls WE ask for. The one
// doing the damage is WebKit's, one step earlier, against a geometry that has
// stopped existing by the time the drawer has finished resizing.
import type { Editor } from '@tiptap/core';

/**
 * How far the caret is kept from either edge of its scrollport, in caret
 * heights — so a heading reserves more room than body text, without a second
 * number to keep in step.
 *
 * 1.5 rather than 1: at exactly one line the caret is legal but is still the
 * last thing you can see, and the line you are about to write is off-screen.
 * Half a line more is the difference between "visible" and "you can see where
 * this is going" — the typewriter margin every full-size editor keeps, applied
 * here because a phone's scrollport is short enough that the difference is the
 * whole experience.
 */
const CLEARANCE = 1.5;

/** Floor for the caret height, for the one frame where a rect measures 0. */
const MIN_LINE = 16;

/** Below this, the caret and the scrollport are disagreeing about rounding
 *  rather than the caret being hidden. Scrolling on it would fight the browser
 *  a pixel at a time, forever. */
const DEADZONE = 2;

interface Band {
  top: number;
  bottom: number;
}

/**
 * How far to scroll so the caret keeps its margin — the whole decision, pulled
 * out as arithmetic so it can be reached from vitest instead of only by holding
 * a phone (the argument `composer-suite.ts` makes about page frontmatter, made
 * again about a rAF callback).
 *
 * Both rects are in the same coordinate space; the caller's job is to make sure
 * of that. Positive means scroll down. 0 means leave it alone, which is the
 * answer for most calls.
 */
export function caretDelta(caret: Band, port: Band): number {
  const pad = Math.max(caret.bottom - caret.top, MIN_LINE) * CLEARANCE;
  const ceiling = port.top + pad;
  const floor = port.bottom - pad;
  // A scrollport too short to hold both margins: leave it alone rather than
  // oscillate between two constraints that cannot both be met.
  if (floor <= ceiling) return 0;
  // ⚠ THE BOTTOM IS CHECKED FIRST AND THAT ORDER IS A DECISION. A caret that
  // breaks both edges at once is a line taller than the band it has to sit in —
  // a heading on a short phone — and the half you need to see is the one you are
  // writing on, not the ascenders above it.
  const delta = caret.bottom > floor ? caret.bottom - floor : caret.top < ceiling ? caret.top - ceiling : 0;
  return Math.abs(delta) < DEADZONE ? 0 : delta;
}

/**
 * The nearest ancestor that scrolls, INCLUDING the element itself — `.cap-box`
 * is both the editor host and its own scroller, so a walk that started at
 * `parentElement` would miss the capture box entirely and silently do nothing
 * on the one surface that is a phone-first affordance.
 *
 * Recomputed per reveal rather than cached at mount: the notes room MOVES its
 * editor shell between cards, so an element's scrollport is not a fact you can
 * learn once. It is a handful of `getComputedStyle` calls inside a rAF, on a
 * chain about five deep.
 */
function scrollportOf(el: HTMLElement): HTMLElement | null {
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

/**
 * Keep the caret inside its scrollport, with room to breathe, whenever the
 * selection moves or the keyboard changes the shape of the world.
 *
 * ⚠ DELIBERATELY SILENT FOR A PAGE-SCROLLED EDITOR (`scrollportOf` → null).
 * The collision this exists for needs a toolbar PINNED against the keyboard
 * inside a fixed-height sheet — the writing drawer and the capture box. In the
 * notes room the toolbar sits in normal flow under the card and scrolls away
 * with it, so there is nothing for the caret to be trapped behind and WebKit's
 * own reveal is the right answer there. Scrolling the window instead would mean
 * doing arithmetic against `visualViewport.offsetTop` on iOS to fix a problem
 * that surface does not have.
 */
export function keepCaretClear(editor: Editor, editorEl: HTMLElement): void {
  let queued = 0;

  function reveal(): void {
    queued = 0;
    // `isFocused` is the guard that keeps this from being a scroll-jacker: a
    // `kb:settled` with nothing focused (the keyboard going DOWN fires one too)
    // would otherwise scroll every mounted editor to wherever its selection was
    // left, which on a fresh document is the top.
    if (editor.isDestroyed || !editor.isFocused) return;
    const port = scrollportOf(editorEl);
    if (!port) return;

    // Both of these are in layout-viewport coordinates, which is what makes the
    // subtraction safe on iOS: when WebKit scrolls the VISUAL viewport to follow
    // a field, `offsetTop` moves both of them together and the delta between
    // them is unchanged.
    const delta = caretDelta(editor.view.coordsAtPos(editor.state.selection.head), port.getBoundingClientRect());
    if (!delta) return;
    // Instant, never smooth: this runs while the keyboard is arriving, and an
    // animated scroll racing a resize is how you get the wobble that reads as
    // the page being broken.
    port.scrollTop += delta;
  }

  function schedule(): void {
    if (queued) return;
    queued = requestAnimationFrame(reveal);
  }

  // The keyboard case — the one this file was written for.
  document.addEventListener('kb:settled', schedule);
  // And the ordinary one, which is the same rule applied continuously: typing
  // toward the foot of a long piece walks the caret to the scrollport's edge and
  // the browser keeps it exactly there, flush, forever. These three give it the
  // margin back on every keystroke instead of only when a keyboard moves.
  editor.on('focus', schedule);
  editor.on('selectionUpdate', schedule);
  editor.on('update', schedule);
}
