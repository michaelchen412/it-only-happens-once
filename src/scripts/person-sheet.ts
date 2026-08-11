// Client logic for PersonSheet.astro — the add sheet and the edit sheet.
//
// The DOM is the state, as everywhere else in HQ: the circle lives in
// `aria-pressed` and its hidden input, the photo lives in the file input. There
// is no JavaScript copy of the form beside the form.
//
// THE PHOTO IS UPLOADED AFTER THE ROW EXISTS, and that ordering is forced: the
// object path is keyed on the person's id (`people/<id>/<hash>.<ext>`) so a
// rename never orphans a face, and on the add sheet there is no id until the
// insert comes back. So: save → upload → point the row at it. Three steps, and
// each one can fail on its own, which is why a failed upload leaves you with a
// created person and a sentence rather than a lost form.
import { actions } from 'astro:actions';
import { submitAction } from './action-error';
import { confirmDiscard, dirtyTracker, wireSheetDismiss } from './sheet-dismiss';
import { uploadPrivateImage } from './upload';
import { photoPath } from '../lib/hq/people';

const sheet = document.querySelector<HTMLDialogElement>('#person-sheet');
const form = document.querySelector<HTMLFormElement>('#person-form');

if (sheet && form) {
  /** Every gesture that leaves this sheet routes through `requestClose` below. */
  const dirty = dirtyTracker(sheet);

  const errorEl = document.querySelector<HTMLElement>('#person-error');
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const photoInput = form.querySelector<HTMLInputElement>('[data-photo-input]')!;
  const photoPreview = form.querySelector<HTMLImageElement>('[data-photo-preview]')!;
  const photoEmpty = form.querySelector<HTMLElement>('[data-photo-empty]')!;
  const photoWell = form.querySelector<HTMLElement>('[data-photowell]')!;
  const monthSel = form.querySelector<HTMLSelectElement>('[data-birth-month]')!;
  const daySel = form.querySelector<HTMLSelectElement>('[data-birth-day]')!;
  const circleValue = form.querySelector<HTMLInputElement>('[data-circle-value]')!;

  function showError(message: string | null) {
    if (!errorEl) return;
    errorEl.textContent = message ?? '';
    errorEl.hidden = !message;
  }

  // ── opening and closing ───────────────────────────────────────────────────
  document.querySelectorAll<HTMLElement>('[data-open-person-sheet]').forEach((btn) =>
    btn.addEventListener('click', () => {
      showError(null);
      dirty.reset(); // populating is not editing — see dirtyTracker
      sheet.showModal();
      form.querySelector<HTMLInputElement>('input[name="displayName"]')?.focus();
    }),
  );
  /*
    ⚠ THE ✕, ESCAPE AND THE BACKDROP ALL MEAN "I WANT OUT" (ADR 0032). This
    sheet answered only the first for its whole life — clicking away did
    nothing at all, which reads as stuck and sends the reader to the browser's
    Back button, where far more is lost than the sheet would have cost.
  
    It GUARDS because it has something to lose: an explicit-save form holds
    everything typed into it until the button is pressed. The confirm cannot
    fire on a sheet nobody edited — the tracker is reset after every populate —
    so this costs nothing on the common path.
  */
  async function requestClose() {
    if (dirty.get() && !(await confirmDiscard('This profile'))) return;
    dirty.reset();
    // `!` because a hoisted `async function` cannot inherit the narrowing
    // from the `if (sheet && …)` around it — the same reason this file already
    // writes `sheet!` at its other exits.
    sheet!.close();
  }
  wireSheetDismiss(sheet, requestClose);

  // ── the circle segmented control ──────────────────────────────────────────
  form.querySelectorAll<HTMLButtonElement>('[data-circle]').forEach((btn) =>
    btn.addEventListener('click', () => {
      form
        .querySelectorAll<HTMLButtonElement>('[data-circle]')
        .forEach((o) => o.setAttribute('aria-pressed', String(o === btn)));
      circleValue.value = btn.dataset.circle!;
    }),
  );

  // ── the birthday: offer only days the month actually has ──────────────────
  // February keeps 29, because a leap-day birthday is real (`nextOccurrence`
  // falls it back to 1 March in common years). Trimming the options is the
  // honest fix for "31 April": the alternative is letting you choose it and
  // then refusing the save, which teaches you nothing until after you have
  // finished typing. The action and the table both still check.
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function trimDays() {
    const month = Number(monthSel.value);
    const max = month ? DAYS_IN_MONTH[month - 1] : 31;
    Array.from(daySel.options).forEach((opt) => {
      const day = Number(opt.value);
      opt.hidden = day > max;
      opt.disabled = day > max;
    });
    if (Number(daySel.value) > max) daySel.value = '';
  }
  monthSel.addEventListener('change', trimDays);
  trimDays();

  // ── the photo ─────────────────────────────────────────────────────────────
  // The preview is an object URL, so it appears instantly and before anything
  // has been uploaded — the upload only happens on save, which means backing
  // out of the sheet leaves no orphan object in the bucket.
  let previewUrl: string | null = null;
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    photoPreview.src = previewUrl;
    photoPreview.hidden = false;
    photoEmpty.hidden = true;
    photoWell.classList.add('photowell--set');
  });

  // ── saving ────────────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(null);

    const data = new FormData(form);
    const str = (k: string) => String(data.get(k) ?? '');

    // ⚠ THE THREE-STEP SAVE IS ONE LIFECYCLE, and it is why `submitAction`
    // hands `work` a `busy` setter rather than taking a fixed label: this is
    // the only consumer whose middle step needs to say something different.
    // `formatActionError` covers both kinds of failure that can arrive here —
    // an action's, and an `UploadError` carrying a sentence written for exactly
    // this box. It overrides the message only when the failure is
    // connectivity, which is the one case where "Upload failed: …" would be
    // naming a symptom rather than the cause.
    const res = await submitAction(
      async (busy) => {
        const { data: saved, error } = await actions.people.save({
          id: form.dataset.id || undefined,
          displayName: str('displayName'),
          circle: str('circle') as 'family' | 'friends' | 'professional',
          epithet: str('epithet'),
          location: str('location'),
          birthMonth: str('birthMonth'),
          birthDay: str('birthDay'),
          birthYear: str('birthYear'),
          knownSinceYear: str('knownSinceYear'),
          cadenceMonths: str('cadenceMonths') || 12,
          birthdayLeadDays: str('birthdayLeadDays') || 30,
        });
        if (error || !saved) return { error };

        const file = photoInput.files?.[0];
        if (file) {
          busy('Uploading…');
          // The PRIVATE bucket, which is why nothing here gets a public URL
          // back. The list mirrors the bucket's own `allowed_mime_types`, so an
          // unsupported file is a sentence here rather than a 400 from storage.
          const path = await uploadPrivateImage(file, {
            pathFor: (hash, ext) => photoPath(saved.id, hash, ext),
            accept: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
          });
          const { error: photoError } = await actions.people.setPhoto({ id: saved.id, path });
          if (photoError) return { error: photoError };
        }
        return { data: saved };
      },
      { button: submitBtn, busy: 'Saving…', onError: showError },
    );
    if (!res.ok) return;

    // Reload rather than patching the DOM: the card, the section it belongs
    // to and the coming-up rail are all functions of the row that just
    // changed, and re-deriving three of them by hand is three chances to
    // disagree with the database.
    location.reload();
  });
}
