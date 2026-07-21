// Client logic for the writing composer (src/pages/admin/writing/[id].astro).
// TipTap (WYSIWYG → Markdown, ADR-0006) + a fixed toolbar, continuous autosave,
// and the publish/details dialog. Kept out of the .astro file so it stays lean.
import { mountRichEditor } from './rich-editor';
import { actions } from 'astro:actions';
import { slugify } from '../lib/slug';
import { formatActionError, nowTime } from './action-error';
import { confirmDialog } from './confirm-dialog';

const init = JSON.parse(document.getElementById('composer-init')!.textContent || '{}');

const form = document.getElementById('writing-form') as HTMLFormElement;
const idField = form.elements.namedItem('id') as HTMLInputElement;
const bodyField = document.getElementById('body-field') as HTMLInputElement;
const titleField = form.elements.namedItem('title') as HTMLInputElement;
const slugField = document.getElementById('slug-field') as HTMLInputElement;
const jsError = document.getElementById('js-error') as HTMLParagraphElement;
const spinner = document.getElementById('spinner') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;

form.addEventListener('submit', (e) => e.preventDefault()); // no implicit submit

// ---- TipTap editor (WYSIWYG → Markdown) + toolbar + link dialog ----
const { editor, getMarkdown } = mountRichEditor({
  editorEl: document.getElementById('editor')!,
  toolbarRoot: document.querySelector('[role="toolbar"]') as HTMLElement,
  linkDialog: document.querySelector('.link-dialog') as HTMLDialogElement,
  placeholder: 'Start writing…',
  content: init.body || '',
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
const draftActions = document.getElementById('actions-draft')!;
const publishedActions = document.getElementById('actions-published')!;
const saveChangesBtn = document.getElementById('save-changes') as HTMLButtonElement;
const discardBtn = document.getElementById('discard-changes') as HTMLButtonElement;
let savedStatus: string = init.status || 'draft';
let dirty = false;
const isPublished = () => savedStatus === 'published';

function reflectStatus() {
  draftActions.hidden = isPublished();
  publishedActions.hidden = !isPublished();
  updateDirtyUI();
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
reflectStatus();
statusText.textContent = isPublished() ? 'Up to date' : 'Autosaves as you write';

// ---- auto-slug from title until slug is touched ----
let slugTouched = slugField.value.trim().length > 0;
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
if (init.occurredIso && dateToggle.checked) occurredField.value = toLocalInput(init.occurredIso);
dateToggle.addEventListener('change', () => {
  occurredField.disabled = !dateToggle.checked;
  dateAutoNote.hidden = dateToggle.checked;
  if (dateToggle.checked && !occurredField.value) occurredField.value = toLocalInput(new Date().toISOString());
});

// ---- edits: drafts autosave; published posts wait for an explicit Save ----
let timer: number | undefined;
let lock: Promise<unknown> = Promise.resolve();

function onEdit() {
  dirty = true;
  if (isPublished()) {
    updateDirtyUI(); // no autosave — light up Save changes / Discard
    return;
  }
  clearTimeout(timer);
  timer = window.setTimeout(() => save(savedStatus, { silentEmpty: true }), 1200);
}
editor.on('update', onEdit);
form.addEventListener('input', onEdit);

/** Serialize saves so a Publish click never races an in-flight autosave. */
function save(status: string, opts: { silentEmpty?: boolean } = {}): Promise<boolean> {
  const result = lock.then(() => doSave(status, opts));
  lock = result.catch(() => {});
  return result;
}

async function doSave(status: string, opts: { silentEmpty?: boolean }): Promise<boolean> {
  bodyField.value = getMarkdown();
  const hasContent = titleField.value.trim() !== '' || bodyField.value.trim() !== '';
  if (!hasContent) {
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
      history.replaceState(null, '', `/admin/writing/${data.id}`);
    }
    if (!slugTouched && data.slug) slugField.value = data.slug;
  }
  savedStatus = status;
  dirty = false;
  reflectStatus();
  setSaved();
  return true;
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
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
document.getElementById('open-publish')?.addEventListener('click', () => openDialog('publish'));
document.getElementById('open-details')?.addEventListener('click', () => openDialog('details'));
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

const unpublishBtn = document.getElementById('unpublish') as HTMLButtonElement | null;
unpublishBtn?.addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Unpublish',
    message: 'Move this back to drafts? It will no longer be public.',
    confirmLabel: 'Unpublish',
  });
  if (!ok) return;
  unpublishBtn.disabled = true;
  const saved = await save('draft');
  unpublishBtn.disabled = false;
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
  dirty = false; // bypass the unload guard, then reload the saved version
  window.location.reload();
});

const deleteBtn = document.getElementById('delete') as HTMLButtonElement | null;
deleteBtn?.addEventListener('click', async () => {
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
  if (error) {
    deleteBtn.disabled = false;
    return setStatusError(error.message);
  }
  dirty = false;
  window.location.href = '/admin';
});
