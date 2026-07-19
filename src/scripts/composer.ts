// Client logic for the writing composer (src/pages/admin/writing/[id].astro).
// TipTap (WYSIWYG → Markdown, ADR-0006) + a fixed toolbar, continuous autosave,
// and the publish/details dialog. Kept out of the .astro file so it stays lean.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
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

// ---- TipTap editor (WYSIWYG that serializes to Markdown) ----
const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    Markdown.configure({ transformPastedText: true, transformCopiedText: true }),
    Placeholder.configure({ placeholder: 'Start writing…' }),
  ],
  content: init.body || '',
  editorProps: { attributes: { class: 'reading tiptap-doc focus:outline-none', 'aria-label': 'Article body' } },
});
const getMarkdown = () => (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();

// ---- toolbar ----
const cmds: Record<string, () => void> = {
  undo: () => editor.chain().focus().undo().run(),
  redo: () => editor.chain().focus().redo().run(),
  h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  bold: () => editor.chain().focus().toggleBold().run(),
  italic: () => editor.chain().focus().toggleItalic().run(),
  strike: () => editor.chain().focus().toggleStrike().run(),
  blockquote: () => editor.chain().focus().toggleBlockquote().run(),
  bulletList: () => editor.chain().focus().toggleBulletList().run(),
  orderedList: () => editor.chain().focus().toggleOrderedList().run(),
  hr: () => editor.chain().focus().setHorizontalRule().run(),
  link: () => openLinkDialog(),
};
const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('.tt-btn'));
btns.forEach((b) => b.addEventListener('click', () => cmds[b.dataset.cmd!]?.()));

function syncToolbar() {
  const active: Record<string, boolean> = {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    blockquote: editor.isActive('blockquote'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    link: editor.isActive('link'),
    h2: editor.isActive('heading', { level: 2 }),
    h3: editor.isActive('heading', { level: 3 }),
  };
  btns.forEach((b) => {
    const on = !!active[b.dataset.cmd!];
    b.classList.toggle('is-active', on);
    if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on)); // toggles only
  });
}
editor.on('selectionUpdate', syncToolbar);
editor.on('transaction', syncToolbar);

// ---- link dialog (replaces prompt) ----
const linkDialog = document.getElementById('link-dialog') as HTMLDialogElement;
const linkUrl = document.getElementById('link-url') as HTMLInputElement;
const linkRemove = document.getElementById('link-remove') as HTMLButtonElement;

function openLinkDialog() {
  const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
  linkUrl.value = prev;
  linkRemove.hidden = !prev;
  linkDialog.showModal();
  linkUrl.focus();
  linkUrl.select();
}
function applyLink() {
  const url = linkUrl.value.trim();
  linkDialog.close();
  if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}
document.getElementById('link-apply')!.addEventListener('click', applyLink);
document.getElementById('link-cancel')!.addEventListener('click', () => linkDialog.close());
linkRemove.addEventListener('click', () => {
  linkDialog.close();
  editor.chain().focus().unsetLink().run();
});
linkDialog.addEventListener('click', (e) => {
  if (e.target === linkDialog) linkDialog.close();
});
linkUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyLink();
  }
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
let savedStatus: string = init.status || 'draft';
function reflectStatus() {
  const published = savedStatus === 'published';
  draftActions.hidden = published;
  publishedActions.hidden = !published;
}
reflectStatus();

// ---- auto-slug from title until slug is touched ----
let slugTouched = slugField.value.trim().length > 0;
slugField.addEventListener('input', () => (slugTouched = true));
titleField.addEventListener('input', () => {
  if (!slugTouched) slugField.value = slugify(titleField.value);
  scheduleAutosave();
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

// ---- autosave: debounced, serialized via a promise mutex ----
let dirty = false;
let timer: number | undefined;
let lock: Promise<unknown> = Promise.resolve();

function scheduleAutosave() {
  dirty = true;
  clearTimeout(timer);
  timer = window.setTimeout(() => save(savedStatus, { silentEmpty: true }), 1200);
}
editor.on('update', scheduleAutosave);
form.addEventListener('input', scheduleAutosave);

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

const deleteBtn = document.getElementById('delete') as HTMLButtonElement | null;
deleteBtn?.addEventListener('click', async () => {
  if (!idField.value) return;
  const ok = await confirmDialog({
    title: 'Delete piece',
    message: 'Delete this piece? This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  deleteBtn.disabled = true;
  const fd = new FormData();
  fd.set('id', idField.value);
  const { error } = await actions.fragments.remove(fd);
  if (error) {
    deleteBtn.disabled = false;
    return setStatusError(error.message);
  }
  dirty = false;
  window.location.href = '/admin';
});
