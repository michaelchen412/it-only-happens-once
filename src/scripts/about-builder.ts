// Client logic for the About page builder (src/pages/admin/about.astro).
//
// Assembles the two-movement `content` (me · site · contact) from the per-section
// fields and saves it to the `pages` row via the `pages.save` action. Each
// movement has its own TipTap body (the shared editor supports multiple
// instances). The portrait uploads to the public `site` bucket using the admin's
// browser session (RLS enforces is_admin()). No autosave — About is always live.
import { actions } from 'astro:actions';
import { mountRichEditor, type RichEditorHandle } from './rich-editor';
import { formatActionError, nowTime } from './action-error';
import { uploadImage } from './upload';

const init = JSON.parse(document.getElementById('about-init')!.textContent || '{}');

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const val = (id: string) => ($(id) as HTMLInputElement | HTMLTextAreaElement).value.trim();

const saveBtn = $('save-about') as HTMLButtonElement;
const spinner = $('about-spinner');
const statusText = $('about-status-text');
const errorBox = $('about-error') as HTMLParagraphElement;

// ---- dirty tracking ----
let dirty = false;
function markDirty() {
  dirty = true;
  saveBtn.disabled = false;
  statusText.textContent = 'Unsaved changes';
  statusText.classList.add('text-warning');
}

// ---- the two movement editors ----
const meEditor = mountRichEditor({
  editorEl: $('me-editor'),
  toolbarRoot: document.querySelector('[data-editor="me"] [role="toolbar"]') as HTMLElement,
  linkDialog: $('me-link') as unknown as HTMLDialogElement,
  placeholder: 'Your story…',
  content: init.meBody || '',
  ariaLabel: 'Who I am — body',
  onChange: markDirty,
});
const siteEditor = mountRichEditor({
  editorEl: $('site-editor'),
  toolbarRoot: document.querySelector('[data-editor="site"] [role="toolbar"]') as HTMLElement,
  linkDialog: $('site-link') as unknown as HTMLDialogElement,
  placeholder: 'Why I write here…',
  content: init.siteBody || '',
  ariaLabel: 'What this is — body',
  onChange: markDirty,
});

$('about-form').addEventListener('input', markDirty);

// ---- portrait upload (browser session → site bucket, RLS = is_admin) ----
const portraitInput = $('portrait-input') as HTMLInputElement;
const portraitPath = $('portrait-path') as HTMLInputElement;
const portraitPreview = $('portrait-preview') as HTMLImageElement;
const portraitPlaceholder = $('portrait-placeholder');
const portraitRemove = $('portrait-remove') as HTMLButtonElement;

// Shares scripts/upload.ts with the essay composer (docs/plans/03) rather than
// keeping its own copy. That matters now that the bucket enforces a mime
// allowlist and a size cap: the helper rejects an unsupported file with a
// sentence you can act on, where the raw upload would have come back with
// whatever the storage API says. It also downscales, so a 12MP portrait stops
// being a 5MB page load.
//
// The fixed path is why `pathFor` ignores the content hash: there is exactly
// one portrait, and replacing it must overwrite rather than accumulate.
portraitInput.addEventListener('change', async () => {
  const file = portraitInput.files?.[0];
  if (!file) return;
  statusText.textContent = 'Uploading photo…';
  spinner.hidden = false;
  try {
    const { path, url } = await uploadImage(file, {
      pathFor: (_hash, ext) => `about/portrait.${ext}`,
      upsert: true,
    });
    portraitPath.value = path;
    // Cache-buster: the path is stable, so the browser would show the old one.
    portraitPreview.src = `${url}?v=${Date.now()}`;
    portraitPreview.classList.remove('hidden');
    portraitPlaceholder.classList.add('hidden');
    portraitRemove.classList.remove('hidden');
    markDirty();
  } catch (e) {
    showError(formatActionError(e));
  } finally {
    spinner.hidden = true;
    portraitInput.value = '';
  }
});

portraitRemove.addEventListener('click', () => {
  portraitPath.value = '';
  portraitPreview.src = '';
  portraitPreview.classList.add('hidden');
  portraitPlaceholder.classList.remove('hidden');
  portraitRemove.classList.add('hidden');
  markDirty();
});

// ---- interests repeater ----
const list = $('interests-list');
const template = $('interest-template') as HTMLTemplateElement;

// Each row owns a slim, link-free rich editor for its note. Keyed by the row so
// we can harvest it at save time and tear it down on remove. The note's initial
// Markdown rides in the row's hidden `.interest-note-src` textarea.
const interestEditors = new WeakMap<Element, RichEditorHandle>();

function mountInterestRow(row: Element) {
  if (interestEditors.has(row)) return;
  const editorEl = row.querySelector<HTMLElement>('.interest-note-editor');
  const toolbar = row.querySelector<HTMLElement>('.interest-toolbar');
  const src = row.querySelector<HTMLTextAreaElement>('.interest-note-src');
  if (!editorEl || !toolbar) return;
  interestEditors.set(
    row,
    mountRichEditor({
      editorEl,
      toolbarRoot: toolbar,
      placeholder: 'Why this is part of who I am…',
      content: src?.value ?? '',
      ariaLabel: 'Why this matters',
      onChange: markDirty,
    }),
  );
}

// Mount the server-rendered rows up front (so their notes save even if never expanded).
list.querySelectorAll('.interest-row').forEach(mountInterestRow);

$('interest-add').addEventListener('click', () => {
  const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  list.appendChild(row);
  mountInterestRow(row);
  row.querySelector<HTMLInputElement>('.interest-term')?.focus();
  markDirty();
});
list.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  const row = btn.closest('.interest-row');
  if (!row) return;
  if (btn.classList.contains('interest-remove')) {
    interestEditors.get(row)?.editor.destroy();
    interestEditors.delete(row);
    row.remove();
    markDirty();
  } else if (btn.classList.contains('interest-toggle')) {
    const wrap = row.querySelector<HTMLElement>('.interest-note-wrap');
    if (!wrap) return;
    const opening = wrap.hasAttribute('hidden');
    wrap.toggleAttribute('hidden', !opening);
    btn.setAttribute('aria-expanded', String(opening));
    row.querySelector('.interest-caret')?.classList.toggle('rotate-180', opening);
    if (opening) interestEditors.get(row)?.editor.commands.focus();
  } else if (btn.classList.contains('interest-up') && row.previousElementSibling) {
    row.parentElement!.insertBefore(row, row.previousElementSibling);
    markDirty();
  } else if (btn.classList.contains('interest-down') && row.nextElementSibling) {
    row.parentElement!.insertBefore(row.nextElementSibling, row);
    markDirty();
  }
});

function readInterests() {
  return Array.from(list.querySelectorAll('.interest-row'))
    .map((row) => ({
      term: (row.querySelector('.interest-term') as HTMLInputElement)?.value.trim() ?? '',
      note: interestEditors.get(row)?.getMarkdown().trim() ?? '',
    }))
    .filter((it) => it.term || it.note);
}

// ---- save ----
function showError(msg: string) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  spinner.hidden = true;
  statusText.textContent = 'Save failed';
  statusText.classList.remove('text-warning');
  statusText.classList.add('text-error');
}

saveBtn.addEventListener('click', async () => {
  errorBox.hidden = true;
  saveBtn.disabled = true;
  spinner.hidden = false;
  statusText.textContent = 'Saving…';
  statusText.classList.remove('text-warning', 'text-error');

  const content = {
    me: {
      headline: val('f-me-headline'),
      portrait: portraitPath.value || null,
      portrait_caption: val('f-portrait-caption'),
      body: meEditor.getMarkdown(),
      interests: readInterests(),
    },
    site: {
      thesis: val('f-site-thesis'),
      body: siteEditor.getMarkdown(),
      name: {
        blurb: val('f-blurb'),
        spotify_url: val('f-spotify'),
      },
    },
    contact: {
      intro: val('f-contact-intro'),
    },
  };

  const { error } = await actions.pages.save({ slug: 'about', content });
  spinner.hidden = true;
  if (error) {
    showError(formatActionError(error));
    return;
  }
  dirty = false;
  saveBtn.disabled = true;
  statusText.textContent = 'Saved ' + nowTime();
  statusText.classList.remove('text-warning', 'text-error');
});

// warn on navigating away with unsaved edits
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
