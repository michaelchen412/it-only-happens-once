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

const personId = document.querySelector<HTMLElement>('[data-person-id]')?.dataset.personId;

// ── the About block, edited in place ────────────────────────────────────
const view = document.querySelector<HTMLElement>('[data-bio-view]');
const form = document.querySelector<HTMLFormElement>('[data-bio-form]');
const errorEl = document.querySelector<HTMLElement>('[data-bio-error]');

const showForm = (editing: boolean) => {
  if (view) view.hidden = editing;
  if (form) form.hidden = !editing;
  if (editing) form?.querySelector('textarea')?.focus();
};

document.querySelector('[data-bio-edit]')?.addEventListener('click', () => showForm(true));
document.querySelector('[data-bio-cancel]')?.addEventListener('click', () => {
  // Reset to what the server rendered, so cancelling really does discard.
  const ta = form?.querySelector<HTMLTextAreaElement>('textarea');
  if (ta) ta.value = ta.defaultValue;
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
  const bio = form.querySelector<HTMLTextAreaElement>('textarea')!.value;
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
