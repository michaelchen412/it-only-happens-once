// Client logic for the FragmentSheet drawer (components/admin/FragmentSheet.astro)
// — the quote & song quick-editors: a minimal TipTap body, the Author→Work
// provenance combos, AI subject suggestions, the Spotify lookup, and the
// constellations tab. Kept out of the .astro file so the markup stays legible.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { wireConstellationPicker } from './constellation-picker';
import { wireSheetTabs } from './sheet-tabs';

const sheet = document.getElementById('sheet') as HTMLDialogElement;
const sheetTitle = document.getElementById('sheet-title')!;
const sheetError = document.getElementById('sheet-error') as HTMLParagraphElement;
const quoteForm = document.getElementById('quote-form') as HTMLFormElement;
const songForm = document.getElementById('song-form') as HTMLFormElement;

// --- quote body: a minimal TipTap editor (bold/italic only; breaks preserved) ---
const quoteBody = document.getElementById('quote-body') as HTMLInputElement;
const quoteSave = document.getElementById('quote-save') as HTMLButtonElement;
const quoteAttr = quoteForm.elements.namedItem('attribution') as HTMLInputElement;
const quoteEditor = new Editor({
  element: document.getElementById('quote-editor')!,
  extensions: [
    StarterKit.configure({
      heading: false,
      bulletList: false,
      orderedList: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
    }),
    Markdown.configure({ breaks: true, transformPastedText: true }),
    Placeholder.configure({ placeholder: 'The words themselves…' }),
  ],
  content: '',
  editorProps: { attributes: { class: 'reading tiptap-doc focus:outline-none', 'aria-label': 'Quote text' } },
});
const quoteMarkdown = () => (quoteEditor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

const qBtns = Array.from(quoteForm.querySelectorAll<HTMLButtonElement>('.tt-btn'));
const qCmds: Record<string, () => void> = {
  bold: () => quoteEditor.chain().focus().toggleBold().run(),
  italic: () => quoteEditor.chain().focus().toggleItalic().run(),
};
qBtns.forEach((b) => b.addEventListener('click', () => qCmds[b.dataset.qcmd!]?.()));
function syncQuoteToolbar() {
  qBtns.forEach((b) => {
    const on = quoteEditor.isActive(b.dataset.qcmd!);
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
quoteEditor.on('selectionUpdate', syncQuoteToolbar);
quoteEditor.on('transaction', syncQuoteToolbar);

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
const quoteSubjects = quoteForm.elements.namedItem('subjects') as HTMLInputElement;
const suggestBtn = document.getElementById('quote-suggest') as HTMLButtonElement;
const suggestLabel = document.getElementById('quote-suggest-label')!;
const proposedBox = document.getElementById('quote-proposed') as HTMLElement;
const proposedName = document.getElementById('quote-proposed-name')!;
const proposedDef = document.getElementById('quote-proposed-def')!;
const proposedAdd = document.getElementById('quote-proposed-add') as HTMLButtonElement;
const currentTags = () => quoteSubjects.value.split(',').map((s) => s.trim()).filter(Boolean);
const addTags = (extra: string[]) => setSubjects(quoteForm, Array.from(new Set([...currentTags(), ...extra])).join(', '));

suggestBtn.addEventListener('click', async () => {
  const text = quoteEditor.getText().trim();
  if (!text) return showError('Add the quote first, then suggest subjects.');
  clearError();
  proposedBox.hidden = true;
  suggestBtn.disabled = true;
  suggestLabel.textContent = 'Thinking…';
  const { data, error } = await actions.fragments.suggestSubjects({ text, kind: 'quote' });
  suggestBtn.disabled = false;
  suggestLabel.textContent = 'Suggest with AI';
  if (error || !data) return showError(error ? formatActionError(error) : 'No suggestions came back.');
  addTags(data.existing);
  if (data.proposed) {
    proposedName.textContent = data.proposed.name;
    proposedDef.textContent = data.proposed.definition;
    proposedAdd.onclick = () => {
      addTags([data.proposed!.name]);
      proposedBox.hidden = true;
    };
    proposedBox.hidden = false;
  }
});
document.getElementById('quote-proposed-dismiss')!.addEventListener('click', () => (proposedBox.hidden = true));

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
      quoteEditor.commands.setContent('');
      authorCombo.clear();
      workCombo.clear();
      recomputeWorkScope();
      resetQuoteDate();
      refreshQuoteValid();
      proposedBox.hidden = true;
    }
    if (type === 'song') document.getElementById('song-lookup')!.textContent = '';
    // Nothing to be a member of yet — ticks queue until the first save. In a
    // composer context, pre-tick that constellation (the old data-place-in
    // hook, now visible in the UI rather than implicit).
    picker.setFragment(null, []);
    const placeIn = document.body.dataset.placeIn;
    if (placeIn) picker.preselect(placeIn);
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
      quoteEditor.commands.setContent(d.body || '');
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
      proposedBox.hidden = true;
    } else {
      setField(form, 'year', String(d.year));
      setField(form, 'title', d.title);
      setField(form, 'spotify_url', d.source_url);
      setField(form, 'spotify_id', d.details.spotify_id ?? '');
      setField(form, 'thumbnail_url', d.details.thumbnail_url ?? '');
      setField(form, 'album', d.details.album ?? '');
      document.getElementById('song-lookup')!.textContent = '';
    }
    toggleDelete(form, true);
    picker.setFragment(d.id, Array.isArray(d.constellationIds) ? d.constellationIds : []);
    sheetTitle.textContent = type === 'quote' ? 'Edit quote' : 'Edit song';
    openSheet(type);
  }
});

// --- Spotify lookup on paste/change ---
const urlField = songForm.elements.namedItem('spotify_url') as HTMLInputElement;
const lookupNote = document.getElementById('song-lookup')!;
async function runLookup() {
  const url = urlField.value.trim();
  if (!url) return;
  lookupNote.textContent = 'Looking up…';
  const { data, error } = await actions.songs.lookup({ url });
  if (error || !data) {
    lookupNote.textContent = 'Couldn’t read that link — fill the fields manually.';
    return;
  }
  if (!(songForm.elements.namedItem('title') as HTMLInputElement).value) setField(songForm, 'title', data.title);
  setField(songForm, 'spotify_id', data.spotifyId);
  if (data.thumbnailUrl) setField(songForm, 'thumbnail_url', data.thumbnailUrl);
  lookupNote.textContent = `✓ ${data.title}`;
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
    }
    const fd = new FormData(form);
    if (form === quoteForm && !quoteDateToggle.checked) fd.delete('occurred_at'); // absent = automatic
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    const { data, error } = await action(fd);
    submitBtn.disabled = false;
    if (!error) {
      // A brand-new fragment's queued memberships (including the composer's
      // pre-ticked constellation) can only be written once it has an id.
      if (data?.id) await picker.flush(data.id);
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
