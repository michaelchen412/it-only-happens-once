// The composer's proofreader (docs/plans/22) — the chip, the marks and the one
// popover that serves both.
//
// Split out of writing-sheet.ts on 2026-08-07 (quality audit). That file had
// grown to 1,268 lines across twenty-one concerns; this was the newest and the
// least entangled, and it is lifted whole rather than rearranged — every
// comment below is the reasoning that shipped with the feature.
//
// ⚠ EXPLICIT PRESS, NEVER AUTOMATIC. It is a paid call, and the composer's
// whole contract is instruments that never act on their own.
//
// It owns no document state. Everything it changes goes through the editor's
// own `ProofreadHandle` (a real TipTap transaction, so ⌘Z takes it back) or
// through the title field, and the ONE thing the sheet needs back from it is
// `reset` — because a mark from the last piece must not linger on the next.
import { actions } from 'astro:actions';
import type { Editor } from '@tiptap/core';
import { formatActionError } from './action-error';
import { anchorPopover } from './pop-anchor';
import { documentText } from './proofread-locate';
import { MARK_ATTR, type PendingFix, type ProofreadHandle } from './proofread-marks';

export interface ProofreadDeps {
  /** The TipTap instance whose document is read and marked. */
  editor: Editor;
  /** The decoration plugin's handle. Absent when the editor was mounted
      without `proofread: true`, which is why every call below is optional. */
  marks: ProofreadHandle | undefined;
  /** The title is proofread too, but holds no mark — an `<input>` cannot. */
  titleField: HTMLInputElement;
  /** The sheet's error line, for a failure that has to be said out loud. */
  jsError: HTMLElement;
  /** The button in the ⋯ menu that starts a pass. */
  proofreadBtn: HTMLButtonElement;
  /** The drawer, used only to find the scrolling column. */
  sheet: HTMLElement;
  /** Closes the ⋯ menu the button lives in. */
  closeMenu: () => void;
}

export interface ProofreadPanel {
  /** Drop every mark and proposal. Call when the drawer loads a new row. */
  reset: () => void;
}

export function wireProofread(deps: ProofreadDeps): ProofreadPanel {
  const { editor, marks, titleField, jsError, proofreadBtn, sheet, closeMenu } = deps;

  const pfChip = document.getElementById('ws-pf-chip') as HTMLElement;
  const pfCount = document.getElementById('ws-pf-count') as HTMLElement;
  const pfTitleBtn = document.getElementById('ws-pf-title') as HTMLButtonElement;
  const pfDismissBtn = document.getElementById('ws-pf-dismiss') as HTMLButtonElement;
  const pfPop = document.getElementById('ws-pf-pop') as HTMLElement;
  const pfBefore = document.getElementById('ws-pf-before') as HTMLElement;
  const pfAfter = document.getElementById('ws-pf-after') as HTMLElement;
  const pfFixBtn = document.getElementById('ws-pf-fix') as HTMLButtonElement;
  const pfIgnoreBtn = document.getElementById('ws-pf-ignore') as HTMLButtonElement;

  /** In flight — the second press of a button that takes ~2s does nothing. */
  let pfRunning = false;
  /** The title's fix, if it has one. It gets no mark: an `<input>` holds none. */
  let pfTitleFix: PendingFix | null = null;
  /** Which mark opened the popover — null means the title did. */
  let pfOpenId: string | null = null;
  /** What it is anchored to. `anchorPopover` asks for this every time it opens. */
  let pfTrigger: HTMLElement | null = null;
  /** A transient sentence (Reading… / Nothing caught) owns the chip while set. */
  let pfNote: string | null = null;
  let pfNoteTimer: number | undefined;

  anchorPopover(pfPop, () => pfTrigger);
  const closePop = () => {
    if (pfPop.matches(':popover-open')) pfPop.hidePopover();
  };

  function renderChip() {
    if (pfNote) {
      pfCount.textContent = pfNote;
      pfTitleBtn.hidden = true;
      pfChip.hidden = false;
      return;
    }
    const n = marks?.count() ?? 0;
    if (!n && !pfTitleFix) {
      pfChip.hidden = true;
      return;
    }
    pfCount.textContent = n ? `${n} to look at${pfTitleFix ? ' ·' : ''}` : '';
    pfTitleBtn.textContent = '1 in the title';
    pfTitleBtn.hidden = !pfTitleFix;
    pfChip.hidden = false;
  }

  /**
   * A sentence that clears itself.
   *
   * ⚠ THE ZERO STATE IS THE COMMON CASE AND HAS TO LAND AS A RESULT. Most presses
   * on a finished piece find nothing, and a feature whose usual outcome is silence
   * reads as broken. So "Nothing caught" is shown for a few seconds rather than
   * the chip simply never appearing.
   */
  function pfSay(note: string, ms = 4000) {
    clearTimeout(pfNoteTimer);
    pfNote = note;
    renderChip();
    pfNoteTimer = window.setTimeout(() => {
      pfNote = null;
      renderChip();
    }, ms);
  }

  /**
   * ⚠ A PROPOSAL FROM THE LAST PIECE MUST NOT LINGER, and here it is worse than
   * for its sibling: a stale subject suggestion is something you can ignore, a
   * stale MARK is an underline sitting on innocent words in a piece the model
   * never read. Called from `populate`, which is what runs when the drawer opens
   * on a row — NOT from `openDialog`, where `subjectsSuggest.reset()` lives. That
   * one fires when the publish dialog opens, which is a different moment
   * entirely.
   */
  function pfReset() {
    clearTimeout(pfNoteTimer);
    pfNote = null;
    pfTitleFix = null;
    pfOpenId = null;
    closePop();
    marks?.clear();
    renderChip();
  }

  proofreadBtn.addEventListener('click', async () => {
    closeMenu();
    if (pfRunning) return; // pressed twice
    const title = titleField.value.trim();
    // Built from the locator's own walk, so what the model reads and what the
    // marks are placed into are one rendering of one document.
    const body = documentText(editor.state.doc);
    if (!body.trim()) return pfSay('Nothing to read yet');
    // ⚠ NOT SLICED. A piece proofread in part and reported as proofread in full is
    // the exact failure this feature exists to prevent, so it says so instead. The
    // action's own `.max()` would also reject it, but only as a validation error
    // that says nothing about what to do.
    if (body.length > 20_000 || title.length > 300) return pfSay('This one is too long to read in a single pass', 6000);

    pfRunning = true;
    jsError.hidden = true;
    pfReset();
    // The ⋯ menu closes the moment you click, so unlike `SubjectsField`'s button
    // there is no control left to relabel. The chip is the only surface there is.
    pfSay('Reading…', 30_000);
    try {
      const { data, error } = await actions.fragments.proofread({ title, text: body });
      if (error || !data) throw error ?? new Error('No answer came back.');
      clearTimeout(pfNoteTimer);
      pfNote = null;
      pfTitleFix = data.fixes.find((f) => f.where === 'title') ?? null;
      const placed = marks?.place(data.fixes.filter((f) => f.where === 'body')) ?? 0;
      if (!placed && !pfTitleFix) pfSay('Nothing caught');
      else renderChip();
    } catch (e) {
      // `astro:actions` THROWS on a dead network rather than returning { error },
      // so this needs a catch as well as the check above — the quote-only version
      // of the sibling missed exactly this and stuck on "Thinking…" for the life
      // of the page.
      clearTimeout(pfNoteTimer);
      pfNote = null;
      renderChip();
      jsError.textContent = formatActionError(e);
      jsError.hidden = false;
    } finally {
      pfRunning = false;
    }
  });

  // One delegated listener on the editable surface rather than per-span bindings:
  // a transaction can recreate every decoration underneath us. Same shape as the
  // image alt handler in rich-editor.ts.
  editor.view.dom.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement)?.closest?.(`[${MARK_ATTR}]`) as HTMLElement | null;
    if (!el) return;
    const id = el.getAttribute(MARK_ATTR)!;
    const fix = marks?.at(id);
    if (!fix) return;
    pfOpenId = id;
    pfTrigger = el;
    pfBefore.textContent = fix.before;
    pfAfter.textContent = fix.after;
    pfFixBtn.disabled = false;
    pfPop.showPopover();
  });

  // The title's fix opens the SAME popover against the field — `triggerFor` is a
  // callback precisely so one popover can serve things of different kinds.
  pfTitleBtn.addEventListener('click', () => {
    if (!pfTitleFix) return;
    pfOpenId = null;
    pfTrigger = titleField;
    pfBefore.textContent = pfTitleFix.before;
    pfAfter.textContent = pfTitleFix.after;
    pfFixBtn.disabled = false;
    pfPop.showPopover();
  });

  pfFixBtn.addEventListener('click', () => {
    if (pfOpenId) {
      // A normal document step, so ⌘Z takes it back and no undo affordance is
      // needed. (It WAS needed in the rejected dialog design, which applied fixes
      // via `setContent` and flattened history. Noting the difference so nobody
      // re-adds it.)
      marks?.apply(pfOpenId);
      closePop();
    } else if (pfTitleFix) {
      titleField.value = titleField.value.replace(pfTitleFix.before, pfTitleFix.after);
      // TagInput's lesson: a programmatic write fires no `input`, so the slug
      // field and the dirty flag would never hear about this one.
      titleField.dispatchEvent(new Event('input', { bubbles: true }));
      pfTitleFix = null;
      // ⚠ AND THE POPOVER STAYS OPEN. Assigning `.value` does not enter the
      // browser's native undo stack, so unlike a body fix this cannot be taken
      // back with a keystroke — leaving `thier → their` on screen is the record of
      // what changed, and enough to put it back by hand. The alternative was a
      // bespoke undo for one field; rejected as more machinery than the failure is
      // worth.
      pfFixBtn.disabled = true;
    }
    renderChip();
  });

  pfIgnoreBtn.addEventListener('click', () => {
    // Ignore forgets. Press Proofread again and this comes back — re-ignoring is
    // one click, and a remembered list is one more thing `pfReset` would have to
    // clear correctly on every open.
    if (pfOpenId) marks?.dismiss(pfOpenId);
    else pfTitleFix = null;
    closePop();
    renderChip();
  });

  pfDismissBtn.addEventListener('click', pfReset);

  // ⚠ `anchorPopover` PLACES ONCE, ON `toggle`, AND DOES NOT FOLLOW A SCROLL. Its
  // other callers anchor to controls that sit still; this one anchors to a word in
  // the column whose entire job is to scroll. A popover pointing at empty space is
  // worse than one that shut itself.
  // (`#ws-scroll`, not the class list it happens to carry — that selector was
  // written twice, here and in the BackToTop mount, and both were one Tailwind
  // tidy away from silently matching nothing.)
  sheet.querySelector('#ws-scroll')?.addEventListener('scroll', closePop, { passive: true });

  // The chip counts down as marks are applied, ignored, or go stale under an edit.
  editor.on('transaction', () => {
    if (!pfChip.hidden || marks?.count()) renderChip();
  });

  return { reset: pfReset };
}
