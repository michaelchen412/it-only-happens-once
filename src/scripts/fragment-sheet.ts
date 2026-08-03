// Client logic for the FragmentSheet drawer (components/admin/FragmentSheet.astro)
// — the quote & song quick-editors: two short-form TipTap bodies (the quote's
// words, the song's annotation), the Author→Work provenance combos, AI subject
// suggestions, the Spotify lookup, and the constellations tab. Kept out of the
// .astro file so the markup stays legible.
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';
import { confirmDialog } from './confirm-dialog';
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

// required-field gate: Quote + Attribution must be non-empty to save
function refreshQuoteValid() {
  quoteSave.disabled = quoteEditor.isEmpty || !quoteAttr.value.trim();
}
quoteEditor.on('update', refreshQuoteValid);
quoteAttr.addEventListener('input', refreshQuoteValid);

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
const quoteSourceTitle = quoteForm.elements.namedItem('source_title') as HTMLInputElement;
const scriptureRe = /\d+\s*:\s*\d+/; // "Matthew 5:43-48" — a citation, not an author name

// The full lists (rendered into the combos) — used to re-scope the Work list.
const allAuthors: { id: string; name: string }[] = JSON.parse(authorCombo.dataset.options || '[]');
const allWorks: { id: string; name: string; authorId: string | null }[] = JSON.parse(workCombo.dataset.options || '[]');
const authorNameById = new Map(allAuthors.map((a) => [a.id, a.name]));

// The Work list only ever offers the chosen author's works (or all of them,
// when no author is set yet) — you can't pair an author with someone else's book.
function scopedWorks() {
  const aid = authorCombo.getId();
  const aname = authorCombo.getName().trim();
  if (aid) return allWorks.filter((w) => w.authorId === aid);
  if (aname) return []; // a not-yet-created author owns no existing works
  return allWorks;
}
function recomputeWorkScope() {
  const subset = scopedWorks();
  workCombo.setOptions(subset);
  const wid = workCombo.getId();
  if (wid && !subset.some((w) => w.id === wid)) workCombo.clear(); // drop a now-orphaned work
}
// Author fills the shown attribution when it's still blank (no double-entry).
function fillAttrFromAuthor() {
  const n = authorCombo.getName().trim();
  if (n && !quoteAttr.value.trim()) {
    quoteAttr.value = n;
    refreshQuoteValid();
  }
}

authorCombo.addEventListener('combo:change', () => {
  fillAttrFromAuthor();
  recomputeWorkScope();
});
workCombo.addEventListener('combo:change', () => {
  const opt = workCombo.getOption();
  // Picking an existing work asserts its author — snap Author to match (work wins).
  if (opt && opt.authorId) {
    authorCombo.setValue(opt.authorId, authorNameById.get(opt.authorId) ?? '');
    recomputeWorkScope();
    fillAttrFromAuthor();
  }
  const wname = workCombo.getName().trim();
  if (wname && !quoteSourceTitle.value.trim()) quoteSourceTitle.value = wname;
});

// Typing a plain attribution seeds the Author facet (unless it's scripture).
quoteAttr.addEventListener('change', () => {
  const v = quoteAttr.value.trim();
  if (v && !authorCombo.getName().trim() && !scriptureRe.test(v)) {
    authorCombo.setValue('', v);
    recomputeWorkScope();
  }
});
quoteSourceTitle.addEventListener('change', () => {
  const v = quoteSourceTitle.value.trim();
  if (v && !workCombo.getName().trim()) workCombo.setValue('', v);
});

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
      return { missing: 'Say why this one first — a song’s subjects come from what you wrote about it, not from its genre.' };
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
const picker = wireConstellationPicker(document.getElementById('sheet-panel-cn')!.querySelector('.cn-picker') as HTMLElement);
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
  // Membership applies immediately, so the list/suite behind us is stale.
  if (membershipTouched()) return void window.location.reload();
  sheet.close();
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
      setField(form, 'source_title', d.details.source_title ?? '');
      setField(form, 'source_author', d.details.source_author ?? '');
      setField(form, 'work_year', d.details.work_year != null ? String(d.details.work_year) : '');
      setField(form, 'page', d.details.page != null ? String(d.details.page) : '');
      setField(form, 'citation', d.details.citation ?? '');
      authorCombo.setValue(d.authorId ?? '', d.authorName ?? '');
      recomputeWorkScope(); // scope the Work list to this author before selecting
      workCombo.setValue(d.workId ?? '', d.workName ?? '');
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
    lookupNote.textContent = 'Couldn’t read that link — paste a Spotify track/album or a YouTube video, or fill the fields in by hand.';
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
      if (quoteEditor.isEmpty || !quoteAttr.value.trim()) {
        showError('A quote needs both its words and an attribution.');
        return;
      }
    } else if (form === songForm) {
      // An empty doc still serializes to whitespace — send nothing at all, so
      // an unannotated song stores `body: null` rather than a blank paragraph.
      songBody.value = song.editor.isEmpty ? '' : song.getMarkdown();
    }
    const fd = new FormData(form);
    if (form === quoteForm && !quoteDateToggle.checked) fd.delete('occurred_at'); // absent = automatic
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
      dirty = false; // saved — don't prompt on the reload
      window.location.reload();
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
    window.location.reload();
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
