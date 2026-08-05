// Client logic for the FragmentSheet drawer (components/admin/FragmentSheet.astro)
// — the quote & song quick-editors: two short-form TipTap bodies (the quote's
// words, the song's annotation), the Author→Work provenance combos, AI subject
// suggestions, the Spotify lookup, and the constellations tab. Kept out of the
// .astro file so the markup stays legible.
import { actions } from 'astro:actions';
import { deriveProvenance, mergePage } from '../lib/provenance';
import { formatActionError } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { notifyFragmentsChanged } from './fragments-changed';
import { wireConstellationPicker } from './constellation-picker';
import { wireSharedBy } from './shared-by';
import { mountMiniEditor } from './rich-editor';
import { wireSheetTabs } from './sheet-tabs';
import { wireSubjectSuggest } from './subject-suggest';

const sheet = document.getElementById('sheet') as HTMLDialogElement;
const sheetTitle = document.getElementById('sheet-title')!;
const sheetError = document.getElementById('sheet-error') as HTMLParagraphElement;
const quoteForm = document.getElementById('quote-form') as HTMLFormElement;
const songForm = document.getElementById('song-form') as HTMLFormElement;

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

// --- song annotation: the same editor, the same register (ADR-0009). This is
// the "why", the field Spotify doesn't have — optional, and it LEADS the public
// stanza, with the embed closing as citation. ---
const songBody = document.getElementById('song-body') as HTMLInputElement;
const song = mountMiniEditor({
  editorEl: document.getElementById('song-editor')!,
  toolbarRoot: document.getElementById('song-editor-wrap')!,
  placeholder: 'Why this one…',
  ariaLabel: 'Why this song',
});

// The only required field is the words themselves (2026-08-05, docs/plans/17a).
// Attribution used to gate this too, which is what made an unattributed quote
// unenterable — and "no attribution" is now a meaningful answer twice over
// (Michael's own words; nobody knows), not an unfinished form.
function refreshQuoteValid() {
  quoteSave.disabled = quoteEditor.isEmpty;
}
quoteEditor.on('update', refreshQuoteValid);

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

// ═══ THE DERIVED LINE (docs/plans/17a-quote-matrix.md, src/lib/provenance.ts) ══
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

function refreshPreview() {
  const { line, reveal } = deriveProvenance(quoteFacts());
  const override = quoteAttr.value.trim();
  const shown = overrideWrap.hidden ? line : override || line;
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

const songSuggest = wireSubjectSuggest({
  root: document.getElementById('song-subjects')!,
  kind: 'song',
  /**
   * The annotation is REQUIRED here, though the field itself is optional on a
   * song (ADR 0009). Title + artist + album is exactly the thin signal that
   * produces "jazz, 1950s, modal" — true, useless, and not what this taxonomy
   * is for. A song's subjects on this site come from why it matters, and the
   * only place that exists is what you wrote about it.
   */
  gather: () => {
    const why = song.editor.getText().trim();
    if (!why) {
      return {
        missing: 'Say why this one first — a song’s subjects come from what you wrote about it, not from its genre.',
      };
    }
    const field = (n: string) => (songForm.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? '';
    const heading = [field('title'), field('attribution')].filter(Boolean).join(' — ');
    return { text: [heading, field('album'), '', why].filter((l, i) => l || i === 2).join('\n') };
  },
  readTags: () => tagsOf(songForm),
  writeTags: (tags) => setSubjects(songForm, tags.join(', ')),
  onStart: () => clearError(),
  onError: (m) => showError(m),
});

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
song.editor.on('update', () => markDirty());

// --- constellation membership: its own tab, one picker for both types ---
// (It applies immediately, so it never belonged inside either <form>.)
const picker = wireConstellationPicker(
  document.getElementById('sheet-panel-cn')!.querySelector('.cn-picker') as HTMLElement,
);
const tabs = wireSheetTabs(sheet);
const cnCount = document.getElementById('sheet-cn-count')!;
const fieldsTabLabel = document.getElementById('sheet-tab-fields-label')!;
const cnPanel = document.getElementById('sheet-panel-cn')!;

function refreshCnCount() {
  const n = cnPanel.querySelectorAll<HTMLInputElement>('.cn-check:checked').length;
  cnCount.textContent = n ? String(n) : '';
}
cnPanel.addEventListener('change', refreshCnCount);

/** A membership edit changes the list underneath — refresh on close. */
const membershipTouched = () => picker.changed();

// --- "Shared by": the corpus side of the person link (12 · Piece 3) ---
// One handle per form, because the field lives beside the provenance facets in
// each rather than in a shared tab — a song someone sent and a quote someone
// said are the same link, but they are asked for in two different places.
// Absent when the roster is empty: the component renders nothing at all then.
const sharedByHandles = new Map<'quote' | 'song', ReturnType<typeof wireSharedBy>>();
for (const scope of ['quote', 'song'] as const) {
  const el = sheet.querySelector<HTMLElement>(`[data-sby="${scope}"]`);
  if (el) sharedByHandles.set(scope, wireSharedBy(el));
}
/** `fragment_id → person_id[]`, rendered by the server so an open needs no fetch. */
const sharedByMap: Record<string, string[]> = JSON.parse(sheet.dataset.sharedBy || '{}');
/** Set when you arrived from a profile's "Add a quote" (`?person=<slug>`). */
const linkPersonId = sheet.dataset.linkPerson || '';

function openSheet(type: 'quote' | 'song') {
  clearError();
  quoteForm.hidden = type !== 'quote';
  songForm.hidden = type !== 'song';
  fieldsTabLabel.textContent = type === 'quote' ? 'Quote' : 'Song';
  tabs.select('fields'); // always open on the content, never mid-composition
  refreshCnCount();
  sheet.showModal(); // native: focus-trap + Escape + focus restore on close
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
  sheet.close();
  // Membership applies immediately, so the list/suite behind us is stale. The
  // host refreshes in place if it can; if nothing claims it, this falls back to
  // the reload that used to be here unconditionally.
  if (stale) notifyFragmentsChanged(sheet);
}

document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => requestClose()));
// Escape → route through the guard instead of the native instant-close.
sheet.addEventListener('cancel', (e) => {
  e.preventDefault();
  requestClose();
});
// Backdrop dismiss, but ONLY when the press both STARTED and ENDED on the
// backdrop. A right-to-left text selection that begins inside the sheet and
// releases on the backdrop must not close it (that was losing work mid-edit).
let pressedOnBackdrop = false;
sheet.addEventListener('pointerdown', (e) => (pressedOnBackdrop = e.target === sheet));
sheet.addEventListener('click', (e) => {
  if (e.target === sheet && pressedOnBackdrop) requestClose();
});

function setField(form: HTMLFormElement, name: string, value: string) {
  const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (el) el.value = value;
}
function setSubjects(form: HTMLFormElement, value: string) {
  (form.querySelector('tag-input') as HTMLElement & { setTags?: (v: string) => void })?.setTags?.(value);
}
function toggleDelete(form: HTMLFormElement, show: boolean) {
  (form.querySelector('[data-delete]') as HTMLElement).hidden = !show;
}

// --- New quote / New song (buttons live in the list page) ---
document.querySelectorAll<HTMLElement>('[data-new]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.new as 'quote' | 'song';
    const form = type === 'quote' ? quoteForm : songForm;
    form.reset();
    setField(form, 'id', '');
    setSubjects(form, '');
    toggleDelete(form, false);
    if (type === 'quote') {
      // emitUpdate: false — TipTap v3 fires `update` on setContent, which would
      // arm the unsaved-work guard against words we just put there ourselves.
      quoteEditor.commands.setContent('', { emitUpdate: false });
      authorCombo.clear();
      workCombo.clear();
      recomputeWorkScope();
      setOverrideOpen(false); // a fresh quote is never an exception to its own rule
      refreshPreview();
      resetQuoteDate();
      refreshQuoteValid();
      quoteSuggest.reset();
    }
    if (type === 'song') {
      song.editor.commands.setContent('', { emitUpdate: false });
      document.getElementById('song-lookup')!.textContent = '';
      songSuggest.reset();
    }
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
    sharedByHandles.get(type)?.setFragment(null, []);
    if (linkPersonId) sharedByHandles.get(type)?.preselect(linkPersonId);
    sheetTitle.textContent = type === 'quote' ? 'New quote' : 'New song';
    openSheet(type);
  });
});

// --- Edit existing quote / song (opened by a row click in the manager) ---
document.addEventListener('fragment:edit', (e) => {
  {
    let d: any;
    try {
      d = JSON.parse((e as CustomEvent).detail);
    } catch {
      return showError('Could not read that fragment.');
    }
    const type = d.type as 'quote' | 'song';
    const form = type === 'quote' ? quoteForm : songForm;
    form.reset();
    setField(form, 'id', d.id);
    setField(form, 'attribution', d.attribution);
    setField(form, 'status', d.status);
    setSubjects(form, d.subjects);
    if (type === 'quote') {
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
      refreshPreview();
      resetQuoteDate(d.occurredIso, d.datePrecision);
      refreshQuoteValid();
      quoteSuggest.reset();
    } else {
      setField(form, 'year', String(d.year));
      setField(form, 'title', d.title);
      setField(form, 'spotify_url', d.source_url);
      setField(form, 'thumbnail_url', d.details.thumbnail_url ?? '');
      setField(form, 'album', d.details.album ?? '');
      // Carry the Web API provenance back in. `form.reset()` blanked these, and
      // saveSong writes `details` wholesale — so without this, opening a song
      // and pressing Save would quietly drop the ids the lookup had found.
      setField(form, 'release_year', d.details.release_year != null ? String(d.details.release_year) : '');
      setField(form, 'spotify_album_id', d.details.spotify_album_id ?? '');
      setField(form, 'spotify_artist_ids', (d.details.spotify_artist_ids ?? []).join(','));
      song.editor.commands.setContent(d.body || '', { emitUpdate: false });
      document.getElementById('song-lookup')!.textContent = '';
      songSuggest.reset();
    }
    toggleDelete(form, true);
    picker.setFragment(d.id, Array.isArray(d.constellationIds) ? d.constellationIds : []);
    sharedByHandles.get(type)?.setFragment(d.id, sharedByMap[d.id] ?? []);
    sheetTitle.textContent = type === 'quote' ? 'Edit quote' : 'Edit song';
    openSheet(type);
  }
});

// --- metadata lookup on paste/change (docs/plans/04 Piece 4) ---
// The Web API fills artist, album and release year; oEmbed can only manage a
// title (and, on YouTube, the channel). Either way this only ever writes into
// an EMPTY field — merge, never replace, so a correction you typed survives
// re-pasting the link.
const urlField = songForm.elements.namedItem('spotify_url') as HTMLInputElement;
const lookupNote = document.getElementById('song-lookup')!;
/** Write `value` only if the field is currently blank. Returns what's there now. */
function fillIfEmpty(name: string, value: string | null | undefined): string {
  const el = songForm.elements.namedItem(name) as HTMLInputElement | null;
  if (!el) return '';
  if (!el.value.trim() && value) setField(songForm, name, value);
  return el.value;
}
async function runLookup() {
  const url = urlField.value.trim();
  if (!url) return;
  lookupNote.textContent = 'Looking up…';
  const { data, error } = await actions.songs.lookup({ url });
  if (error || !data) {
    lookupNote.textContent =
      'Couldn’t read that link — paste a Spotify track/album or a YouTube video, or fill the fields in by hand.';
    return;
  }
  fillIfEmpty('title', data.title);
  fillIfEmpty('attribution', data.artist);
  fillIfEmpty('album', data.album);
  if (data.thumbnailUrl) setField(songForm, 'thumbnail_url', data.thumbnailUrl);
  // Hidden provenance — always overwritten, because unlike the visible fields
  // these are never hand-edited and a stale id is worse than none.
  setField(songForm, 'release_year', data.releaseYear != null ? String(data.releaseYear) : '');
  setField(songForm, 'spotify_album_id', data.albumId ?? '');
  setField(songForm, 'spotify_artist_ids', data.artistIds.join(','));

  // Name the kind: an album link is easy to paste by accident, and the whole
  // record embeds rather than the one song.
  const kind = data.ref.kind === 'album' ? ' — the whole album' : data.ref.kind === 'video' ? ' — a YouTube video' : '';
  // Say when we're on the thin tier, so an empty Artist field reads as a known
  // limitation rather than a bug. This is the difference Piece 4 bought.
  const thin = data.source === 'oembed' && !data.artist ? ' · no artist from this link — type it in' : '';
  lookupNote.textContent = `✓ ${data.title}${kind}${thin}`;
}
urlField.addEventListener('change', runLookup);
urlField.addEventListener('paste', () => setTimeout(runLookup, 50));

// --- submit via the action ---
for (const [form, action] of [
  [quoteForm, actions.fragments.saveQuote],
  [songForm, actions.fragments.saveSong],
] as const) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    if (form === quoteForm) {
      quoteBody.value = quoteMarkdown();
      if (quoteEditor.isEmpty) {
        showError('A quote needs its words.');
        return;
      }
    } else if (form === songForm) {
      // An empty doc still serializes to whitespace — send nothing at all, so
      // an unannotated song stores `body: null` rather than a blank paragraph.
      songBody.value = song.editor.isEmpty ? '' : song.getMarkdown();
    }
    const fd = new FormData(form);
    if (form === quoteForm && !quoteDateToggle.checked) fd.delete('occurred_at'); // absent = automatic
    if (form === quoteForm) {
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
    submitBtn.disabled = true;
    const { data, error } = await action(fd);
    submitBtn.disabled = false;
    if (!error) {
      // A brand-new fragment's queued memberships (including the composer's
      // pre-ticked constellation, and a profile's pre-ticked person) can only
      // be written once it has an id.
      if (data?.id) {
        await picker.flush(data.id);
        await sharedByHandles.get(form === quoteForm ? 'quote' : 'song')?.flush(data.id);
      }
      dirty = false; // saved — don't prompt the unsaved-work guard on the way out
      // The reload used to be what closed this sheet after a save. It isn't any
      // more, so the close is explicit and load-bearing rather than tidying.
      sheet.close();
      notifyFragmentsChanged(sheet);
      return;
    }
    showError(formatActionError(error));
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
    btn.disabled = true;
    const fd = new FormData();
    fd.set('id', id);
    const { error } = await actions.fragments.trash(fd);
    if (error) {
      btn.disabled = false;
      return showError(error.message);
    }
    dirty = false; // trashed — nothing left here worth guarding
    sheet.close();
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
