// The person profile's own behaviour — the About block edited in place, and the
// archive toggle.
//
// ⚠ IT LIVED INLINE IN `pages/admin/people/[slug].astro` AND THE PAGE
// DOCUMENTED THE COST AGAINST ITSELF (plan 38 · §6.1). Its comment recorded that
// one handler here got `submitAction` during plan 25 and that the one six lines
// below it "never got the paste" — because a pass that sweeps `src/scripts/`
// does not reach a page template. `library.astro` was the other inline script in
// the building and carried the same class of bug for months, in three handlers.
//
// The convention is unanimous otherwise: every other admin surface imports its
// behaviour from here, which is what makes a sweep able to find it.

import { actions } from 'astro:actions';
import { submitAction } from './action-error';
import { confirmDialog } from './confirm-dialog';
// Static, for the reason task-sheet.ts states at its own copy of this import —
// and doubly so here, where `capture.ts` has warmed this module on idle since
// 2026-08-07 on every page that carries `AdminLayout`.
import { mountMiniEditor } from './rich-editor';

const personId = document.querySelector<HTMLElement>('[data-person-id]')?.dataset.personId;

// ── the About block, edited in place ────────────────────────────────────
const view = document.querySelector<HTMLElement>('[data-bio-view]');
const form = document.querySelector<HTMLFormElement>('[data-bio-form]');
const errorEl = document.querySelector<HTMLElement>('[data-bio-error]');

/**
 * The bio editor — a mini editor since plan 43, storing the same Markdown.
 *
 * ⚠ MOUNTED ONLY IF THE FORM IS ON THE PAGE. This module also runs the archive
 * toggle, and every lookup around it is already null-guarded for that reason.
 *
 * `breaks: false` MATCHES THE VIEW ABOVE IT, which renders `renderMarkdown(bio)`
 * with no `breaks` — a bio is a paragraph about a person, and a wrapped line in
 * one is not a line break. See `mountMiniEditor`'s `breaks`.
 */
const bioSeed = form?.querySelector<HTMLInputElement>('[data-bio-value]');
const bioEditor =
  form && bioSeed
    ? mountMiniEditor({
        editorEl: document.getElementById('bio-editor')!,
        toolbarRoot: document.getElementById('bio-editor-wrap')!,
        placeholder: 'What you’d say if someone asked about them.',
        // The accessible name the `sr-only` label used to carry, verbatim.
        ariaLabel: `About ${form.querySelector<HTMLElement>('[data-bio-name]')?.dataset.bioName ?? 'this person'}`,
        docClass: 'f-prose',
        breaks: false,
      })
    : null;
/** `emitUpdate: false` — v3 emits `update` from `setContent`. */
const seedBio = () => bioEditor?.editor.commands.setContent(bioSeed?.value ?? '', { emitUpdate: false });
seedBio();

const showForm = (editing: boolean) => {
  if (view) view.hidden = editing;
  if (form) form.hidden = !editing;
  // ⚠ FOCUS AFTER THE UNHIDE, AND ON THE CONTENTEDITABLE. ProseMirror cannot
  // place a caret in a `display: none` subtree — the call is simply dropped —
  // so the order that worked by accident for a textarea is load-bearing now.
  if (editing) bioEditor?.editor.commands.focus();
};

document.querySelector('[data-bio-edit]')?.addEventListener('click', () => showForm(true));
document.querySelector('[data-bio-cancel]')?.addEventListener('click', () => {
  // Reset to what the server rendered, so cancelling really does discard.
  // The hidden seed is that value and is never written to, which makes it the
  // exact equivalent of the textarea's `defaultValue` this replaced.
  seedBio();
  if (errorEl) errorEl.hidden = true;
  showForm(false);
});

const showBioError = (msg: string) => {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = false;
};

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const save = form.querySelector<HTMLButtonElement>('[data-bio-save]')!;
  const bio = bioEditor?.getMarkdown().trim() ?? '';
  if (!personId) return showBioError('Missing person id.');
  // ⚠ THIS HANDLER HAD THE CATCH AND STILL COULD NOT SAY THE SENTENCE IT
  // CARRIED. It formatted with `err instanceof Error ? err.message : '…'`,
  // which is the precise idiom `action-error.ts` was written to warn about:
  // **`TypeError` extends `Error`**, so a dead network takes the FIRST
  // branch and prints `Failed to fetch`, while "Could not save — check your
  // connection" was unreachable in exactly the case it was written for.
  // `submitAction` owns the whole lifecycle, so there is nothing left here
  // to get wrong.
  const res = await submitAction(() => actions.people.saveBio({ id: personId, bio }), {
    button: save,
    busy: 'Saving…',
    onError: showBioError,
  });
  if (!res.ok) return;
  // Reload so the prose comes back through the same Markdown renderer the
  // server uses — rendering it a second way in the browser is how the
  // saved text and the shown text start to disagree.
  location.reload();
});

// ── archive / restore ───────────────────────────────────────────────────
const archiveBtn = document.querySelector<HTMLButtonElement>('[data-archive]');
archiveBtn?.addEventListener('click', async () => {
  const archiving = archiveBtn.dataset.archive === 'archive';
  const name = archiveBtn.dataset.personName ?? 'this person';
  const ok = await confirmDialog(
    archiving
      ? {
          title: `Archive ${name}?`,
          message: 'Everything is kept. They leave the roster and search, and you can put them back any time.',
          confirmLabel: 'Archive',
        }
      : {
          title: `Put ${name} back?`,
          message: 'They return to the roster and to search.',
          confirmLabel: 'Put back',
        },
  );
  if (!ok || !personId) return;

  // Was a bare await with no catch at all, so offline this control did
  // nothing whatsoever — no navigation, no sentence, an unhandled
  // rejection. The bio save above at least had a `try`; this one, six lines
  // further down, never got the paste.
  //
  // ⚠ "The same FILE" was the point when this lived inside the page template,
  // and it is why the file moved here in the end (plan 38 · §6.1): the paste was
  // a convention carried by hand, and the two surfaces that never received it
  // were the two whose behaviour was not in `src/scripts/`.
  const archiveError = document.querySelector<HTMLElement>('[data-archive-error]');
  const res = await submitAction(() => actions.people.setArchived({ id: personId, archived: archiving }), {
    button: archiveBtn,
    onError: (msg) => {
      if (!archiveError) return;
      archiveError.textContent = msg;
      archiveError.hidden = false;
    },
  });
  if (!res.ok) return;
  location.href = archiving ? '/admin/people' : location.pathname;
});
