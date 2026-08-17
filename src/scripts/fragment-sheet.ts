// Client logic for the FragmentSheet drawer (components/admin/FragmentSheet.astro)
// — the QUOTE quick-editor: a short-form TipTap body, the Author→Work
// provenance combos, AI subject suggestions, and the constellations tab. Kept
// out of the .astro file so the markup stays legible.
//
// ⚠ IT USED TO EDIT SONGS TOO, and ADR 0031 took that half out. A song has its
// own sheet now (`scripts/song-sheet.ts`), because the division this file
// carried was two editors split by FIELD: the metadata lived here and the
// feelings lived in /admin/listening, and neither surface could show you the
// whole object. What went with it: the annotation editor ("why this one",
// retired — a song has notes, split by audience), the Spotify lookup (the song
// sheet's paste bar owns that now), and the song subject suggester (a song has
// no subjects at all).
import { actions } from 'astro:actions';
import { deriveProvenance, mergePage } from '../lib/provenance';
import { slugify } from '../lib/slug';
import { submitAction } from './action-error';
import { closeWithExit, openDialog } from './dialog-close';
import { wireSheetDismiss } from './sheet-dismiss';
import { sheetError as sheetErrorOf } from './sheet-error';
import { confirmDialog } from './confirm-dialog';
import { notifyFragmentsChanged } from './fragments-changed';
import { wireConstellationPicker } from './constellation-picker';
import { wireSharedBy } from './shared-by';
import { readIntent } from './open-editor';
import { mountMiniEditor } from './rich-editor';
import { wireSheetTabs } from './sheet-tabs';
import { wireSubjectSuggest } from './subject-suggest';

const sheet = document.getElementById('sheet') as HTMLDialogElement;
const sheetTitle = document.getElementById('sheet-title')!;
// By role rather than by `#sheet-error` — see `sheet-error.ts`.
const sheetError = sheetErrorOf(sheet) as HTMLParagraphElement;
const quoteForm = document.getElementById('quote-form') as HTMLFormElement;

// --- quote body: the shared short-form editor (bold/italic; breaks preserved) ---
const quoteBody = document.getElementById('quote-body') as HTMLInputElement;
const quoteSave = document.getElementById('quote-save') as HTMLButtonElement;
const quoteAttr = quoteForm.elements.namedItem('attribution') as HTMLInputElement;
const quote = mountMiniEditor({
  editorEl: document.getElementById('quote-editor')!,
  toolbarRoot: document.getElementById('quote-editor-wrap')!,
  placeholder: 'The words themselves…',
  ariaLabel: 'Quote text',
});
const quoteEditor = quote.editor;
const quoteMarkdown = quote.getMarkdown;

// The only required field is the words themselves (2026-08-05, docs/plans/17a).
// Attribution used to gate this too, which is what made an unattributed quote
// unenterable — and "no attribution" is now a meaningful answer twice over
// (Michael's own words; nobody knows), not an unfinished form.
function refreshQuoteValid() {
  quoteSave.disabled = quoteEditor.isEmpty;
}
quoteEditor.on('update', refreshQuoteValid);
// The slug preview is derived from the attribution AND the opening words, so an
// edit to the body moves it exactly as an edit to the author does.
quoteEditor.on('update', () => refreshPreview());

// --- provenance facets: structured Author → Work combos (integrity by construction) ---
type Combo = HTMLElement & {
  getId(): string;
  getName(): string;
  getOption(): { id: string; name: string; authorId?: string | null } | null;
  setValue(id?: string | null, name?: string | null): void;
  clear(): void;
  setOptions(list: { id: string; name: string; authorId?: string | null }[]): void;
};
const authorCombo = document.getElementById('quote-author') as Combo;
const workCombo = document.getElementById('quote-work') as Combo;
const quoteWhere = document.getElementById('quote-where') as HTMLInputElement;
const quoteSlug = document.getElementById('quote-slug') as HTMLInputElement;
const quoteSlugNote = document.getElementById('quote-slug-note') as HTMLElement;
const previewLine = document.getElementById('quote-preview-line')!;
const previewReveal = document.getElementById('quote-preview-reveal')!;
const overrideWrap = document.getElementById('quote-attr-override') as HTMLElement;
const overrideOpenBtn = document.getElementById('quote-attr-edit') as HTMLButtonElement;
const overrideRevertBtn = document.getElementById('quote-attr-revert') as HTMLButtonElement;

// The full lists (rendered into the combos) — used to re-scope the Work list.
const allAuthors: { id: string; name: string }[] = JSON.parse(authorCombo.dataset.options || '[]');
const allWorks: { id: string; name: string; authorId: string | null }[] = JSON.parse(workCombo.dataset.options || '[]');
const authorNameById = new Map(allAuthors.map((a) => [a.id, a.name]));

// The Work list only ever offers the chosen author's works (or all of them,
// when no author is set yet) — you can't pair an author with someone else's book.
//
// ⚠ AUTHORLESS WORKS ARE ALWAYS OFFERED, from every state (2026-08-05,
// docs/plans/17a). The rule above simply does not apply to a work that belongs
// to nobody: The Bible is nobody's book, so it can't be "someone else's". It
// used to be excluded twice over — `w.authorId === aid` can never match a null,
// and an uncommitted author name returned `[]` outright — so from several states
// there was NO WAY to file a verse under the work it belongs to. The only path
// forward was to type "The Bible" again, creating a second, duplicate,
// authorless work. That is very likely how the Ecclesiastes 9:11 row ended up
// filed under no work at all, with the Bible as a loose string in `details`.
//
// (Rejected: offering them only while the author is uncommitted. That fixes the
// trap as reported and leaves the identical hole open one state over — which is
// the shape of bug that gets rediscovered rather than fixed.)
function scopedWorks() {
  const aid = authorCombo.getId();
  const authorless = allWorks.filter((w) => !w.authorId);
  if (aid === SELF_ID) return allWorks; // Me owns no `works` rows, so Me constrains nothing
  if (aid) return allWorks.filter((w) => w.authorId === aid).concat(authorless);
  if (authorCombo.getName().trim()) return authorless; // a not-yet-created author owns no attributed works
  return allWorks;
}
function recomputeWorkScope() {
  const subset = scopedWorks();
  workCombo.setOptions(subset);
  const wid = workCombo.getId();
  if (wid && !subset.some((w) => w.id === wid)) workCombo.clear(); // drop a now-orphaned work
}
authorCombo.addEventListener('combo:change', () => {
  recomputeWorkScope();
  refreshPreview();
});
workCombo.addEventListener('combo:change', () => {
  const opt = workCombo.getOption();
  // Picking an existing work asserts its author — snap Author to match (work wins).
  if (opt && opt.authorId) {
    authorCombo.setValue(opt.authorId, authorNameById.get(opt.authorId) ?? '');
    recomputeWorkScope();
  }
  refreshPreview();
});
quoteWhere.addEventListener('input', refreshPreview);

// ═══ THE DERIVED LINE (docs/plans/archive/17a-quote-matrix.md, src/lib/provenance.ts) ══
//
// THREE HANDLERS DIED HERE, and their absence is the point of the rebuild:
//
//  · `fillAttrFromAuthor` — copied the author's name into Attribution. It was
//    hiding the fact that `attribution` was a DERIVED value all along; Michael
//    performed the derivation by hand seventy-six times and typed in the result.
//    Now the derivation is a function and this copy is nonsense.
//  · the Attribution→Author seeding, and its `/\d+\s*:\s*\d+/` exemption — a
//    hardcoded rule for deciding whether "Matthew 5:43-48" was a person's name.
//    It cannot exist here any more because THERE IS NO FREE-TEXT ATTRIBUTION
//    FIELD TO TYPE A BOOK NAME INTO. A locator goes in "Where in it", a name
//    goes in "Who said it", and nothing has to guess which is which. (The fix
//    shipped in ce11bc4 narrowed that guess; this deletes the surface it lived
//    on. `scopedWorks`'s authorless rule above is still load-bearing and stays.)
//  · Work→Source title — a field that copied `works.title` into `details` and
//    was labelled "shown after the attribution" while being shown nowhere a
//    reader could reach. 42 rows, 41 of them verbatim duplicates.
//
// What replaces all three is one function, called from every input, whose
// output you can read.

/**
 * The sentinel that "Me" commits into the Author combo — see FragmentSheet's
 * `SELF_ID`. It is never sent: submit() strips it and sends `is_self` instead,
 * so `resolveAuthor` can never turn Michael into an `authors` row.
 */
const SELF_ID = 'self';
const isSelf = () => authorCombo.getId() === SELF_ID;

/** The three facts as the public renderers will read them. */
const quoteFacts = () => ({
  isSelf: isSelf(),
  who: isSelf() ? '' : authorCombo.getName(),
  from: workCombo.getName(),
  where: quoteWhere.value,
});

/** Muted italic for "there is genuinely nothing here" — never an empty gap.
 *  A blank slot in a preview reads as a bug, or as a field you forgot; a
 *  sentence reads as an answer. Same reason the workshop says `source unknown`
 *  rather than leaving the citation column empty. */
function say(el: HTMLElement, text: string, whenEmpty: string) {
  el.textContent = text || whenEmpty;
  el.classList.toggle('italic', !text);
  el.classList.toggle('opacity-55', !text);
}

// ── The address ────────────────────────────────────────────────────────────
// Mirrors `saveQuote`'s own derivation — `slugify(attribution + first 7 words)`
// — so what the field shows is what the server will store, not an approximation
// of it. The two are allowed to drift only in the direction that does not
// matter: if they ever disagree, the SERVER decides, because this preview is
// submitted as `slug` and `fragmentSlug` slugifies and uniquifies it again.
//
// Stops the moment you type in it (the writing sheet's `slugTouched` rule, same
// behaviour in the second room) and never fires for a saved quote, whose slug is
// frozen and is loaded in as-is.
let slugTouched = false;
quoteSlug.addEventListener('input', () => (slugTouched = true));

const firstWords = (text: string, n = 7) => text.trim().split(/\s+/).slice(0, n).join(' ');

function refreshSlug(line: string) {
  if (slugTouched) return;
  quoteSlug.value = slugify(`${line} ${firstWords(quoteEditor.getText())}`);
}

/** The field's two states. A saved quote's address is FROZEN, so the note stops
 *  describing a future and starts describing a promise already made. */
function setSlugState(saved: string | null) {
  slugTouched = !!saved;
  quoteSlug.value = saved ?? '';
  quoteSlugNote.textContent = saved
    ? 'Already live at this address. Changing it breaks every link that has been shared.'
    : 'Set when you first save. Change it only if this one reads badly — any link already shared stops working.';
}

function refreshPreview() {
  const { line, reveal } = deriveProvenance(quoteFacts());
  const override = quoteAttr.value.trim();
  const shown = overrideWrap.hidden ? line : override || line;
  refreshSlug(shown);
  // Two silences, two sentences. They render identically on the page and mean
  // opposite things, so the one place they must NOT look alike is the place you
  // choose between them.
  say(
    previewLine,
    shown ? `— ${shown}` : '',
    isSelf() ? 'nothing — on your own site your words need no byline' : 'nothing — the line stays silent',
  );
  say(previewReveal, reveal, 'nothing to reveal');
}

// The override opens pre-filled with the derived line, so you EDIT the sentence
// you can see rather than compose one from scratch against a blank field. If you
// then change it back, submit() drops it — an override that matches the
// derivation isn't one, and pinning it would make this row stop tracking its own
// facts for no reason anyone could later reconstruct.
function setOverrideOpen(open: boolean) {
  overrideWrap.hidden = !open;
  overrideOpenBtn.hidden = open;
}
overrideOpenBtn.addEventListener('click', () => {
  if (!quoteAttr.value.trim()) quoteAttr.value = deriveProvenance(quoteFacts()).line;
  setOverrideOpen(true);
  quoteAttr.focus();
  quoteAttr.select();
  refreshPreview();
});
overrideRevertBtn.addEventListener('click', () => {
  quoteAttr.value = '';
  setOverrideOpen(false);
  refreshPreview();
});
quoteAttr.addEventListener('input', refreshPreview);

// --- AI subject suggestions (Haiku) — pre-fill tags; new subject needs accept ---
// Both types share one implementation (docs/plans/02); only the question "what
// text is there to read" differs, which is what `gather` answers.
//
// `onError` is wrapped rather than passed by reference: `showError` is a `const`
// declared further down this file, and naming it at module-evaluation time
// would be a temporal-dead-zone throw. The lambda defers the lookup to click.
const tagsOf = (form: HTMLFormElement) =>
  ((form.elements.namedItem('subjects') as HTMLInputElement | null)?.value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const quoteSuggest = wireSubjectSuggest({
  root: document.getElementById('quote-subjects')!,
  kind: 'quote',
  gather: () => {
    const text = quoteEditor.getText().trim();
    return text ? { text } : { missing: 'Add the quote first, then suggest subjects.' };
  },
  readTags: () => tagsOf(quoteForm),
  writeTags: (tags) => setSubjects(quoteForm, tags.join(', ')),
  onStart: () => clearError(),
  onError: (m) => showError(m),
});

/*
  ⚠ THERE WAS A SECOND SUGGESTER HERE, FOR A SONG, AND ADR 0031 DELETED IT
  ALONG WITH THE FIELD IT FILLED. A song has no subjects: a subject is what a
  piece is ABOUT, and a song is not about anything you can paraphrase. The one
  time this corpus filed one that way it produced `jazz` — a genre, alone in a
  taxonomy of words about living, attached to no essay and no quote — deleted
  2026-08-11 as a category error.

  Its old comment was already most of the argument. It made the annotation
  REQUIRED before it would suggest, because title + artist + album is exactly
  the thin signal that produces *"jazz, 1950s, modal"* — true, useless, and not
  what this taxonomy is for. The annotation is gone now too, so the last input
  that could have made a song's subjects meaningful went with it.

  Songs were filed by FEELING, in /admin/listening, with the track playing, and
  nothing ever proposed those (plan 33 ruling 1). Both are gone (plan 40) — so
  no part of a song is machine-taggable, and now there is nothing on a song to
  tag at all beyond the link and who played it.
*/

// date: automatic unless the toggle is on
const quoteDateToggle = document.getElementById('quote-date-toggle') as HTMLInputElement;
const quoteOccurred = document.getElementById('quote-occurred') as HTMLInputElement;
const quoteDateNote = document.getElementById('quote-date-note') as HTMLElement;
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
quoteDateToggle.addEventListener('change', () => {
  quoteOccurred.disabled = !quoteDateToggle.checked;
  quoteDateNote.hidden = quoteDateToggle.checked;
  if (quoteDateToggle.checked && !quoteOccurred.value) quoteOccurred.value = toLocalInput(new Date().toISOString());
});
function resetQuoteDate(iso?: string, precision?: string) {
  const legacy = !!iso && precision === 'day';
  quoteDateToggle.checked = legacy;
  quoteOccurred.disabled = !legacy;
  quoteDateNote.hidden = legacy;
  quoteOccurred.value = legacy ? toLocalInput(iso!) : '';
}

const showError = (msg: string) => {
  sheetError.textContent = msg;
  sheetError.hidden = false;
};
const clearError = () => {
  sheetError.hidden = true;
  sheetError.textContent = '';
};

// --- unsaved-work guard: an accidental dismiss must never delete edits ---
let dirty = false;
// Membership applies immediately and isn't part of the form, so ticking a
// constellation must NOT arm the unsaved-work guard (it would warn about
// "unsaved edits" that were already written).
// (the arg is optional: TipTap's `update` calls this with no event)
const markDirty = (e?: Event) => {
  if (e && (e.target as Element)?.closest?.('#sheet-panel-cn')) return;
  dirty = true;
};
sheet.addEventListener('input', markDirty); // typing in any field, incl. the editor
sheet.addEventListener('change', markDirty); // toggles, selects, the date field
quoteEditor.on('update', () => markDirty()); // TipTap passes its own props, not an Event

// --- constellation membership: its own tab, one picker for both types ---
// (It applies immediately, so it never belonged inside either <form>.)
const picker = wireConstellationPicker(
  document.getElementById('sheet-panel-cn')!.querySelector('.cn-picker') as HTMLElement,
);
const tabs = wireSheetTabs(sheet);
const cnCount = document.getElementById('sheet-cn-count')!;
const cnPanel = document.getElementById('sheet-panel-cn')!;

function refreshCnCount() {
  const n = cnPanel.querySelectorAll<HTMLInputElement>('.cn-check:checked').length;
  cnCount.textContent = n ? String(n) : '';
}
cnPanel.addEventListener('change', refreshCnCount);

/** A membership edit changes the list underneath — refresh on close. */
const membershipTouched = () => picker.changed();

// --- "Shared by": the corpus side of the person link (12 · Piece 3) ---
// One handle, since ADR 0031 left one form here. The song's own copy of this
// field lives on its own sheet, beside its own provenance — a song someone sent
// and a quote someone said are the same link, asked for in two different rooms.
// Null when the roster is empty: the component renders nothing at all then.
const sharedByEl = sheet.querySelector<HTMLElement>('[data-sby="quote"]');
const sharedByHandle = sharedByEl ? wireSharedBy(sharedByEl) : null;
/** `fragment_id → person_id[]`, rendered by the server so an open needs no fetch. */
const sharedByMap: Record<string, string[]> = JSON.parse(sheet.dataset.sharedBy || '{}');
/** Set when you arrived from a profile's "Add a quote" (`?person=<slug>`). */
const linkPersonId = sheet.dataset.linkPerson || '';

function openSheet(tab = 'fields') {
  clearError();
  // Default: the content, never mid-composition. The exception is a caller that
  // names a tab — the row's membership cell asks for 'constellations', so the
  // gesture lands where you were already looking instead of one tab away.
  tabs.select(tab);
  refreshCnCount();
  openDialog(sheet); // native: focus-trap + Escape + focus restore on close
  dirty = false; // the fields we just populated don't count as user edits
}

// Every exit funnels through here so unsaved edits can't silently vanish.
async function requestClose() {
  if (dirty) {
    const ok = await confirmDialog({
      title: 'Discard changes?',
      message: 'This fragment has unsaved edits. Close without saving?',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
  }
  dirty = false;
  // ⚠ CLOSE FIRST, ALWAYS — on every path, including this one.
  //
  // This line used to read `if (membershipTouched()) return void
  // location.reload()`, and that `return` jumped straight over `sheet.close()`.
  // So on the exact gesture "assign it to a constellation, then close the
  // sheet", the sheet was never closed at all: it sat open on screen while a
  // full page load ran, and vanished only when the new document painted. There
  // was no close animation because there was no close. It read as jarring
  // because it WAS jarring — an element disappearing is not an element closing.
  const stale = membershipTouched();
  void closeWithExit(sheet);
  // Membership applies immediately, so the list/suite behind us is stale. The
  // host refreshes in place if it can; if nothing claims it, this falls back to
  // the reload that used to be here unconditionally.
  if (stale) notifyFragmentsChanged(sheet);
}

// ✕, Escape and the backdrop are three gestures with one meaning, wired in one
// call so a sheet cannot answer some of them and not others (ADR 0032).
//
// ⚠ AND IT IS SCOPED TO THE DIALOG, WHERE THIS USED TO QUERY THE DOCUMENT.
// `[data-close]` is rendered by NINE components, so `document.querySelectorAll`
// bound this sheet's close handler to every other sheet's ✕ that happened to be
// mounted on the same page. Harmless today only because the pages that mount
// FragmentSheet mount no other `[data-close]` sheet — which is a fact about the
// current page composition, not a property anything enforces.
wireSheetDismiss(sheet, requestClose);

function setField(form: HTMLFormElement, name: string, value: string) {
  const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (el) el.value = value;
}
function setSubjects(form: HTMLFormElement, value: string) {
  (form.querySelector('tag-input') as HTMLElement & { setTags?: (v: string) => void })?.setTags?.(value);
}
function toggleDelete(form: HTMLFormElement, show: boolean) {
  // The ZONE, not the button: Delete moved out of the action row to the foot of
  // the form (plan 38 · §1.4) and took an explanatory line with it. Hiding the
  // button alone would leave that sentence — and its rule — floating under a
  // brand-new quote that has nothing to delete.
  (form.querySelector('[data-delete-zone]') as HTMLElement).hidden = !show;
}

// --- New quote (the button lives in the list page) ---
// ⚠ `[data-new]` USED TO CARRY A TYPE, and "song" was the other value. Songs
// enter from the essay that wanted them (plan 40), so every remaining one says quote —
// the attribute is kept rather than renamed because the list pages, the
// composer's browser and the deep-link handler all emit it.
document.querySelectorAll<HTMLElement>('[data-new]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const form = quoteForm;
    form.reset();
    setField(form, 'id', '');
    setSubjects(form, '');
    toggleDelete(form, false);
    // emitUpdate: false — TipTap v3 fires `update` on setContent, which would
    // arm the unsaved-work guard against words we just put there ourselves.
    quoteEditor.commands.setContent('', { emitUpdate: false });
    authorCombo.clear();
    workCombo.clear();
    recomputeWorkScope();
    setOverrideOpen(false); // a fresh quote is never an exception to its own rule
    setSlugState(null); // ⚠ BEFORE refreshPreview — it clears `slugTouched`, which is what re-arms the auto-fill
    refreshPreview();
    resetQuoteDate();
    refreshQuoteValid();
    quoteSuggest.reset();
    // Nothing to be a member of yet — ticks queue until the first save. In a
    // composer context, pre-tick that constellation (the old data-place-in
    // hook, now visible in the UI rather than implicit).
    picker.setFragment(null, []);
    const placeIn = document.body.dataset.placeIn;
    if (placeIn) picker.preselect(placeIn);
    // Same shape, one table over: nothing to be shared by yet either, so ticks
    // queue until the first save. Arriving from a profile's "Add a quote"
    // pre-ticks that person, which is the whole flow §5 asked for — the quote
    // enters the corpus AND attaches, in one move.
    sharedByHandle?.setFragment(null, []);
    if (linkPersonId) sharedByHandle?.preselect(linkPersonId);
    sheetTitle.textContent = 'New quote';
    openSheet();
  });
});

// --- Edit an existing quote (opened by a row click in the manager) ---
// A SONG NO LONGER ARRIVES HERE: its row carries `data-song` and the seam
// dispatches `song:edit` instead (ADR 0031, scripts/open-editor.ts).
document.addEventListener('fragment:edit', (e) => {
  {
    // Either shape: a bare JSON string, or `{ data, tab }` from a row that
    // wants a particular tab open (src/scripts/open-editor.ts).
    const intent = readIntent((e as CustomEvent).detail, 'data');
    if (!intent) return showError('Could not read that fragment.');
    let d: any;
    try {
      d = JSON.parse(intent.value);
    } catch {
      return showError('Could not read that fragment.');
    }
    const form = quoteForm;
    form.reset();
    setField(form, 'id', d.id);
    setField(form, 'attribution', d.attribution);
    setField(form, 'status', d.status);
    setSubjects(form, d.subjects);
    {
      quoteEditor.commands.setContent(d.body || '', { emitUpdate: false });
      setField(form, 'source_url', d.source_url);
      // "Where in it" absorbs the legacy `page`, so the two locators Michael
      // recorded separately arrive as the one sentence he'd say out loud
      // ("Letter 2:3, p. 19"). Saving writes it back merged — so every quote you
      // OPEN migrates itself, and the batch migration is only catching up with
      // the ones you don't.
      setField(form, 'citation', mergePage(d.details.citation, d.details.page));
      // A self-authored quote has NO author row to restore from — the flag is
      // the whole record of it. Without this the sheet would reopen it as
      // "nobody knows", and saving would quietly clear the flag: the two
      // silences collapsing into one, which is the exact loss `is_self` exists
      // to prevent.
      if (d.isSelf) authorCombo.setValue(SELF_ID, 'Me');
      else authorCombo.setValue(d.authorId ?? '', d.authorName ?? '');
      recomputeWorkScope(); // scope the Work list to this author before selecting
      workCombo.setValue(d.workId ?? '', d.workName ?? '');
      // Is the stored line an OVERRIDE, or just the derivation written down by
      // hand? Compare. 74 of 76 live rows are the latter, so this opens closed
      // and empty almost always — and the ones where it opens are exactly the
      // rows whose facts don't yet produce their own line. That is not a
      // nuisance, it is the migration's to-do list surfacing where you can act
      // on it: move "Matthew 5:43-48" into Where in it, and the override goes.
      const stored = (d.attribution ?? '').trim();
      const overridden = !!stored && stored !== deriveProvenance(quoteFacts()).line;
      quoteAttr.value = overridden ? stored : '';
      setOverrideOpen(overridden);
      setSlugState(d.slug ?? null); // ⚠ BEFORE refreshPreview, or the auto-fill overwrites the stored slug
      refreshPreview();
      resetQuoteDate(d.occurredIso, d.datePrecision);
      refreshQuoteValid();
      quoteSuggest.reset();
    }
    toggleDelete(form, true);
    picker.setFragment(d.id, Array.isArray(d.constellationIds) ? d.constellationIds : []);
    sharedByHandle?.setFragment(d.id, sharedByMap[d.id] ?? []);
    sheetTitle.textContent = 'Edit quote';
    openSheet(intent.tab);
  }
});

// ⚠ THE SPOTIFY LOOKUP LIVED HERE AND HAS MOVED (ADR 0031). It filled this
// form's artist/album/year from a pasted link, merge-never-replace, with a
// sequence token so a paste-then-correct could not land out of order. All of
// that is now the song sheet's paste bar (`scripts/song-sheet.ts`), which owns
// the same `songs.lookup` call — one lookup path, not two.

// --- submit via the action ---
{
  const form = quoteForm;
  const action = actions.fragments.saveQuote;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    {
      quoteBody.value = quoteMarkdown();
      if (quoteEditor.isEmpty) {
        showError('A quote needs its words.');
        return;
      }
    }
    const fd = new FormData(form);
    if (!quoteDateToggle.checked) fd.delete('occurred_at'); // absent = automatic
    {
      // ABSENT `attribution` MEANS "derive it" — the server owns that, so a
      // stale sheet can never write a line that disagrees with its own facts.
      // Sent only when it is a genuine exception: the box is open AND says
      // something the derivation wouldn't. (The input is `hidden`, not
      // `disabled`, so it submits regardless — hence reading the box's state
      // rather than trusting the field to be empty.)
      const override = overrideWrap.hidden ? '' : quoteAttr.value.trim();
      if (override && override !== deriveProvenance(quoteFacts()).line) fd.set('attribution', override);
      else fd.delete('attribution');
      // ⚠ THE SENTINEL NEVER LEAVES THE BROWSER. `author_id` is a uuid on the
      // server and `author_name` is what `resolveAuthor` upserts — sending "Me"
      // in either would fail validation or, worse, mint an `authors` row called
      // Me and give the derivation a name to lead with on every one of these.
      if (isSelf()) {
        fd.delete('author_id');
        fd.delete('author_name');
        fd.set('is_self', '1');
      } else {
        fd.delete('is_self');
      }
    }
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    // ⚠ THIS WAS THE WORST BUG IN THE TREE, found by the 2026-08-08 audit. The
    // save had no try and no `callAction`, and `astro:actions` THROWS on a dead
    // network rather than returning `{ error }` — so offline, the rejection
    // skipped `submitBtn.disabled = false` and every line under it: Save stuck
    // disabled for the life of the sheet, NOTHING said on screen, and an
    // unhandled rejection in the console nobody was reading. The line below
    // formatted *returned* errors only, which is the exact half-pattern
    // `action-error.ts` was written to warn about.
    //
    // `reusable` because this sheet is CLOSED AND REOPENED, never replaced —
    // and the song form's Save has no validity rule to switch it back on the
    // way in, unlike the quote form's `refreshQuoteValid`.
    // ⚠ `busy` ADDED 2026-08-17 (plan 42 · §4.A.6). This was the ONE save in the
    // building that said nothing while it ran: eight surfaces pass a busy label
    // through `submitAction`, two hand-roll one, two drive a spinner — and this
    // one passed neither, on a full-width primary reading **Save quote**. The
    // exception is argued once, at `goal-sheet.ts`, and it is about a TRASH
    // GLYPH: *"this button is a trash glyph and one word… the disabled state is
    // the whole signal."* That does not reach a labelled primary.
    //
    // ⚠ What this sheet was NOT missing is the confirmation afterwards. It
    // closes on success, which is what task, goal, event, person and the song
    // sheet all do — `docs/admin.md` §4a said otherwise and has been corrected.
    const res = await submitAction(() => action(fd), {
      button: submitBtn,
      busy: 'Saving…',
      onError: showError,
      reusable: true,
    });
    if (!res.ok) return;

    // A brand-new fragment's queued memberships (including the composer's
    // pre-ticked constellation, and a profile's pre-ticked person) can only be
    // written once it has an id.
    //
    // ⚠ SAVED IS NOT DONE. These are two MORE action calls, on the same network
    // that may have just come back — and their rejection used to be unhandled
    // too, which meant a dead network here closed nothing, said nothing and
    // left the sheet sitting open with the save half written. Both flushes now
    // report whether what was queued actually landed.
    if (res.data?.id) {
      const wrote = await picker.flush(res.data.id);
      const linked = (await sharedByHandle?.flush(res.data.id)) ?? true;
      // The id goes back into the form whatever happens, so pressing Save again
      // UPDATES this fragment rather than minting a second one. Without it the
      // retry after a half-written save is a duplicate quote, which is a worse
      // outcome than the failure being retried.
      setField(form, 'id', res.data.id);
      if (!wrote || !linked) {
        // ⚠ CLEARED HERE TOO, and it is not an oversight to resist. The FIELDS
        // are saved — only the relations failed, and a relation never armed
        // this flag in the first place (`markDirty` ignores the constellations
        // panel deliberately). Leaving it true would meet a close with "this
        // fragment has unsaved edits", about edits that are in the database.
        dirty = false;
        // Held open on purpose. The ticks are still on screen and the picker
        // now knows the fragment's id, so re-ticking one writes it immediately
        // — there is nothing to re-type and nothing lost.
        showError('Saved — but its constellations or people didn’t take. Re-tick them once you’re back online.');
        return;
      }
    }
    dirty = false; // saved — don't prompt the unsaved-work guard on the way out
    // The reload used to be what closed this sheet after a save. It isn't any
    // more, so the close is explicit and load-bearing rather than tidying.
    void closeWithExit(sheet);
    notifyFragmentsChanged(sheet);
  });
}

// --- delete from within the editor ---
document.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const form = btn.closest('form') as HTMLFormElement;
    const id = (form.elements.namedItem('id') as HTMLInputElement).value;
    if (!id) return;
    const ok = await confirmDialog({
      title: 'Move to trash',
      message: 'Move this fragment to trash? You can restore it later.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('id', id);
    // `reusable` for the same reason the submit above needs it, and it fixes a
    // latent one: the sheet is refreshed in place rather than reloaded, so a
    // successful trash used to leave Delete permanently disabled for the next
    // fragment you opened. `error.message` is gone too — it printed
    // `Failed to fetch` at a human on the one failure it was written for.
    const res = await submitAction(() => actions.fragments.trash(fd), {
      button: btn,
      onError: showError,
      reusable: true,
    });
    if (!res.ok) return;
    dirty = false; // trashed — nothing left here worth guarding
    void closeWithExit(sheet);
    notifyFragmentsChanged(sheet);
  });
});

// --- arriving from a profile's "Add a quote" (12 · Piece 3, §5) ------------
// The whole flow is one click from the person's Shared zone to a quote sheet
// that is already attributed to them. Opening it HERE rather than from an
// inline script on the page removes any question of module ordering: by the
// time this line runs, the New button's own listener is already bound.
//
// `history.replaceState` so a refresh — or Back, later — does not reopen a
// sheet you deliberately closed. The link brought you here once; it is not a
// property of the room.
if (sheet.dataset.autoNew === 'quote') {
  document.querySelector<HTMLElement>('[data-new="quote"]')?.click();
  const url = new URL(window.location.href);
  url.searchParams.delete('new');
  url.searchParams.delete('person');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
