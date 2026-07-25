// Client logic for the WritingSheet drawer (components/admin/WritingSheet.astro).
// TipTap (WYSIWYG → Markdown, ADR-0006), continuous autosave for drafts,
// explicit save for published pieces, the publish/details dialog, and the
// constellations tab. Kept out of the .astro file so the markup stays legible
// — the same split as admin-list.ts and fragment-panel.ts.
import { mountRichEditor } from './rich-editor';
import { actions } from 'astro:actions';
import { slugify } from '../lib/slug';
import { formatActionError, nowTime } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { wireConstellationPicker } from './constellation-picker';
import { wireSheetTabs } from './sheet-tabs';

const sheet = document.getElementById('wsheet') as HTMLDialogElement;
const form = document.getElementById('ws-form') as HTMLFormElement;
const idField = form.elements.namedItem('id') as HTMLInputElement;
const bodyField = document.getElementById('ws-body-field') as HTMLInputElement;
const titleField = form.elements.namedItem('title') as HTMLInputElement;
const slugField = document.getElementById('slug-field') as HTMLInputElement;
const excerptField = document.getElementById('excerpt-field') as HTMLTextAreaElement;
const jsError = document.getElementById('ws-error') as HTMLParagraphElement;
const spinner = document.getElementById('ws-spinner') as HTMLElement;
const statusText = document.getElementById('ws-status-text') as HTMLElement;

form.addEventListener('submit', (e) => e.preventDefault()); // no implicit submit

// ---- TipTap editor (WYSIWYG → Markdown) + toolbar + link dialog ----
const { editor, getMarkdown } = mountRichEditor({
  editorEl: document.getElementById('ws-editor')!,
  toolbarRoot: sheet.querySelector('[role="toolbar"]') as HTMLElement,
  linkDialog: document.getElementById('ws-link-dialog') as HTMLDialogElement,
  placeholder: 'Start writing…',
  content: '',
  ariaLabel: 'Article body',
});

// ---- status indicator ----
function setSaving() {
  spinner.hidden = false;
  statusText.textContent = 'Saving…';
  statusText.classList.remove('text-error');
}
function setSaved(msg = 'Saved ' + nowTime()) {
  spinner.hidden = true;
  statusText.textContent = msg;
  statusText.classList.remove('text-error');
}
function setStatusError(msg: string) {
  spinner.hidden = true;
  statusText.textContent = msg;
  statusText.classList.add('text-error');
}

// ---- publish-state bar toggle ----
const draftActions = document.getElementById('ws-actions-draft')!;
const publishedActions = document.getElementById('ws-actions-published')!;
const saveChangesBtn = document.getElementById('ws-save-changes') as HTMLButtonElement;
const discardBtn = document.getElementById('ws-discard') as HTMLButtonElement;
const viewLink = document.getElementById('ws-view-link') as HTMLAnchorElement;
const deleteBtn = document.getElementById('ws-delete') as HTMLButtonElement;
let savedStatus = 'draft';
let dirty = false;
let everSaved = false; // any successful save this open → reload on close
let loadFailed = false; // fetch failed → sheet is inert (view-only shell)
let prevHash = ''; // the hash to restore on close (e.g. the browser's #browse)
const isPublished = () => savedStatus === 'published';

function reflectStatus() {
  draftActions.hidden = isPublished();
  publishedActions.hidden = !isPublished();
  updateDirtyUI();
}
function updateViewLink(slug: string) {
  viewLink.hidden = !(isPublished() && slug);
  if (slug) viewLink.href = `/blog/${slug}`;
}

/**
 * Published posts DON'T autosave — edits accumulate and are pushed via an
 * explicit "Save changes" (docs/admin.md §5). This reflects that dirty state.
 */
function updateDirtyUI() {
  if (isPublished()) {
    saveChangesBtn.disabled = !dirty;
    discardBtn.hidden = !dirty;
    if (dirty) {
      spinner.hidden = true;
      statusText.textContent = 'Unsaved changes';
      statusText.classList.add('text-warning');
      return;
    }
  }
  statusText.classList.remove('text-warning');
}

// ---- auto-slug from title until slug is touched ----
let slugTouched = false;
slugField.addEventListener('input', () => (slugTouched = true));
titleField.addEventListener('input', () => {
  if (!slugTouched) slugField.value = slugify(titleField.value);
  onEdit();
});

// ---- date override (local-time round-trip, not UTC) ----
const dateToggle = document.getElementById('date-toggle') as HTMLInputElement;
const occurredField = document.getElementById('occurred-field') as HTMLInputElement;
const dateAutoNote = document.getElementById('date-auto-note') as HTMLElement;

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
dateToggle.addEventListener('change', () => {
  occurredField.disabled = !dateToggle.checked;
  dateAutoNote.hidden = dateToggle.checked;
  if (dateToggle.checked && !occurredField.value) occurredField.value = toLocalInput(new Date().toISOString());
});

// ---- edits: drafts autosave; published posts wait for an explicit Save ----
let timer: number | undefined;
let lock: Promise<unknown> = Promise.resolve();

function onEdit() {
  if (loadFailed || !sheet.open) return;
  dirty = true;
  if (isPublished()) {
    updateDirtyUI(); // no autosave — light up Save changes / Discard
    return;
  }
  clearTimeout(timer);
  timer = window.setTimeout(() => save(savedStatus, { silentEmpty: true }), 1200);
}
editor.on('update', onEdit);
// The constellations tab lives inside the form element, but membership is a
// relationship that already persisted itself — never treat it as an edit
// (it would arm "Unsaved changes" and kick off an autosave).
form.addEventListener('input', (e) => {
  if ((e.target as Element)?.closest?.('#ws-panel-cn')) return;
  onEdit();
});

/** Serialize saves so a Publish click never races an in-flight autosave. */
function save(status: string, opts: { silentEmpty?: boolean } = {}): Promise<boolean> {
  const result = lock.then(() => doSave(status, opts));
  lock = result.catch(() => {});
  return result;
}

const hasContent = () => titleField.value.trim() !== '' || getMarkdown().trim() !== '';

async function doSave(status: string, opts: { silentEmpty?: boolean }): Promise<boolean> {
  if (loadFailed) return false;
  bodyField.value = getMarkdown();
  if (!hasContent()) {
    if (!opts.silentEmpty) setStatusError('Add a title or some words first');
    return false;
  }
  setSaving();
  const fd = new FormData(form);
  fd.set('body', bodyField.value);
  fd.set('status', status);
  if (!dateToggle.checked) fd.delete('occurred_at'); // absent = automatic date

  const { data, error } = await actions.fragments.saveWriting(fd);
  if (error) {
    setStatusError('Save failed');
    jsError.textContent = formatActionError(error);
    jsError.hidden = false;
    return false;
  }
  jsError.hidden = true;
  if (data) {
    if (!idField.value) {
      idField.value = data.id;
      // Whatever was ticked before the piece existed (including the
      // composer's pre-tick) can only be written now that it has an id.
      await picker.flush(data.id);
      setHash(`#edit=${data.id}`);
      deleteBtn.hidden = false;
    }
    if (!slugTouched && data.slug) slugField.value = data.slug;
    updateViewLink(data.slug ?? slugField.value);
  }
  savedStatus = status;
  everSaved = true;
  dirty = false;
  reflectStatus();
  setSaved();
  return true;
}

window.addEventListener('beforeunload', (e) => {
  if (sheet.open && dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---- constellation membership (its own tab) ----
const cnPanel = document.getElementById('ws-panel-cn') as HTMLElement;
const picker = wireConstellationPicker(cnPanel.querySelector('.cn-picker') as HTMLElement);
const cnCount = document.getElementById('ws-cn-count')!;
const toolbar = document.getElementById('ws-toolbar') as HTMLElement;
// The formatting toolbar belongs to the document; hide it on the other tab.
const tabs = wireSheetTabs(sheet, (key) => (toolbar.hidden = key !== 'doc'));

function setCnLabel(n: number) {
  cnCount.textContent = n ? String(n) : '';
}
cnPanel.addEventListener('change', () => {
  setCnLabel(cnPanel.querySelectorAll<HTMLInputElement>('.cn-check:checked').length);
});

// ---- opening ----
const setHash = (h: string) => history.replaceState(null, '', location.pathname + location.search + h);
const setSubjects = (v: string) =>
  (document.querySelector('#publish-dialog tag-input') as HTMLElement & { setTags?: (v: string) => void })?.setTags?.(v);

interface Loaded {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  status: string;
  occurredIso: string;
  subjects: string;
  constellationIds?: string[];
}

function populate(d: Loaded | null) {
  loadFailed = false;
  clearTimeout(timer);
  idField.value = d?.id ?? '';
  titleField.value = d?.title ?? '';
  editor.commands.setContent(d?.body ?? '');
  slugField.value = d?.slug ?? '';
  slugTouched = !!d?.slug;
  excerptField.value = d?.excerpt ?? '';
  setSubjects(d?.subjects ?? '');
  savedStatus = d?.status ?? 'draft';
  // existing pieces keep their stored date by default (custom date checked)
  dateToggle.checked = !!d;
  occurredField.disabled = !d;
  dateAutoNote.hidden = !!d;
  occurredField.value = d?.occurredIso ? toLocalInput(d.occurredIso) : '';
  dirty = false;
  everSaved = false;
  jsError.hidden = true;
  deleteBtn.hidden = !d;
  reflectStatus();
  statusText.classList.remove('text-error', 'text-warning');
  statusText.textContent = isPublished() ? 'Up to date' : 'Autosaves as you write';
  spinner.hidden = true;
  updateViewLink(d?.slug ?? '');
  const memberIds = d?.constellationIds ?? [];
  picker.setFragment(d?.id ?? null, memberIds);
  setCnLabel(memberIds.length);
  tabs.select('doc'); // always open on the writing, never mid-composition
}

function openSheet(hash: string, fromHash: boolean) {
  prevHash = fromHash ? '' : location.hash;
  setHash(hash);
  if (!sheet.open) sheet.showModal();
}

function openNew(fromHash = false) {
  populate(null);
  // Composer context: pre-tick that constellation, so the implicit
  // data-place-in hook is now something you can see and untick.
  const placeIn = document.body.dataset.placeIn;
  if (placeIn) {
    picker.preselect(placeIn);
    setCnLabel(1);
  }
  openSheet('#new-writing', fromHash);
  titleField.focus();
}

async function openEdit(id: string, fromHash = false) {
  const { data, error } = await actions.fragments.get({ id });
  if (error || !data || data.type !== 'writing') {
    // open an inert shell with the error visible — nothing here can save
    populate(null);
    loadFailed = true;
    jsError.textContent = error ? formatActionError(error) : 'That piece could not be loaded.';
    jsError.hidden = false;
    openSheet('', fromHash);
    return;
  }
  populate(data as Loaded);
  openSheet(`#edit=${id}`, fromHash);
}

// ---- closing (every exit funnels through here) ----
function closeNow() {
  dirty = false;
  const reload = everSaved || picker.changed();
  setHash(prevHash); // restore the underlying context (e.g. #browse) first
  sheet.close();
  if (reload) location.reload();
}
async function requestClose() {
  if (!loadFailed && dirty) {
    if (isPublished()) {
      const ok = await confirmDialog({
        title: 'Discard changes?',
        message: 'This piece has unsaved edits. Close without saving?',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return;
    } else {
      // drafts autosave — flush the pending one instead of losing it
      clearTimeout(timer);
      const ok = await save(savedStatus, { silentEmpty: true });
      if (!ok && hasContent()) return; // real save failure — stay, error is shown
    }
  }
  closeNow();
}
sheet.querySelector('[data-ws-close]')?.addEventListener('click', () => requestClose());
sheet.addEventListener('cancel', (e) => {
  e.preventDefault(); // Escape → route through the guard
  requestClose();
});
// Backdrop dismiss only when the press STARTED and ENDED on the backdrop
// (a text selection released outside must not close the sheet).
let pressedOnBackdrop = false;
sheet.addEventListener('pointerdown', (e) => (pressedOnBackdrop = e.target === sheet));
sheet.addEventListener('click', (e) => {
  if (e.target === sheet && pressedOnBackdrop) requestClose();
});

// ---- publish / details dialog ----
const dialog = document.getElementById('publish-dialog') as HTMLDialogElement;
const dialogTitle = document.getElementById('dialog-title')!;
const dialogSub = document.getElementById('dialog-sub')!;
const dialogConfirm = document.getElementById('dialog-confirm') as HTMLButtonElement;
const dialogError = document.getElementById('dialog-error') as HTMLParagraphElement;

let dialogMode: 'publish' | 'details' = 'publish';
function openDialog(mode: 'publish' | 'details') {
  dialogMode = mode;
  dialogError.hidden = true;
  dialogTitle.textContent = mode === 'publish' ? 'Publish this piece' : 'Post details';
  dialogSub.textContent =
    mode === 'publish' ? 'A few last details, then it goes live.' : 'Update the metadata for this published piece.';
  dialogConfirm.textContent = mode === 'publish' ? 'Publish now' : 'Save details';
  dialog.showModal();
}
document.getElementById('ws-open-publish')?.addEventListener('click', () => openDialog('publish'));
document.getElementById('ws-open-details')?.addEventListener('click', () => openDialog('details'));
document.getElementById('dialog-cancel')?.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close(); // backdrop click
});

dialogConfirm.addEventListener('click', async () => {
  dialogError.hidden = true;
  if (dialogMode === 'publish') {
    bodyField.value = getMarkdown();
    if (!titleField.value.trim() || !bodyField.value.trim()) {
      dialogError.textContent = 'Add a title and some words before publishing.';
      dialogError.hidden = false;
      return;
    }
  }
  dialogConfirm.disabled = true;
  const target = dialogMode === 'publish' ? 'published' : savedStatus;
  const ok = await save(target);
  dialogConfirm.disabled = false;
  if (ok) {
    dialog.close();
    if (dialogMode === 'publish') setSaved('Published ' + nowTime());
  } else {
    dialogError.textContent = jsError.textContent || 'Something went wrong.';
    dialogError.hidden = false;
  }
});

document.getElementById('ws-unpublish')?.addEventListener('click', async () => {
  const btn = document.getElementById('ws-unpublish') as HTMLButtonElement;
  const ok = await confirmDialog({
    title: 'Unpublish',
    message: 'Move this back to drafts? It will no longer be public.',
    confirmLabel: 'Unpublish',
  });
  if (!ok) return;
  btn.disabled = true;
  const saved = await save('draft');
  btn.disabled = false;
  if (saved) setSaved('Moved to drafts ' + nowTime());
});

// ---- published: explicit Save changes / Discard (no autosave) ----
saveChangesBtn.addEventListener('click', async () => {
  saveChangesBtn.disabled = true;
  const ok = await save('published');
  if (!ok) saveChangesBtn.disabled = false; // still dirty
});
discardBtn.addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Discard changes',
    message: 'Discard your unsaved edits to this published piece?',
    confirmLabel: 'Discard',
    danger: true,
  });
  if (!ok) return;
  // reload the saved version in place — the sheet stays open
  dirty = false;
  await openEdit(idField.value);
});

deleteBtn.addEventListener('click', async () => {
  if (!idField.value) return;
  const ok = await confirmDialog({
    title: 'Move to trash',
    message: 'Move this piece to trash? You can restore it later.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  deleteBtn.disabled = true;
  const fd = new FormData();
  fd.set('id', idField.value);
  const { error } = await actions.fragments.trash(fd);
  deleteBtn.disabled = false;
  if (error) return setStatusError(error.message);
  dirty = false;
  everSaved = true; // the list underneath must refresh
  closeNow();
});

// ---- triggers: events, buttons, deep links ----
document.addEventListener('writing:edit', (e) => {
  const id = (e as CustomEvent).detail;
  if (typeof id === 'string' && id) void openEdit(id);
});
document.querySelectorAll<HTMLElement>('[data-new-writing]').forEach((btn) => btn.addEventListener('click', () => openNew()));

const m = location.hash.match(/^#edit=([0-9a-f][0-9a-f-]{30,40})$/i);
if (m) void openEdit(m[1], true);
else if (location.hash === '#new-writing') openNew(true);
