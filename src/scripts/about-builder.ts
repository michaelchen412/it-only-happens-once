// Client logic for the About page builder (src/pages/admin/about.astro).
//
// Assembles the two-movement `content` (me · site · contact) from the per-section
// fields and saves it to the `pages` row via the `pages.save` action. Each
// movement has its own TipTap body (the shared editor supports multiple
// instances). The portrait uploads to the public `site` bucket using the admin's
// browser session (RLS enforces is_admin()). No autosave — About is always live.
//
// ⚠ An interests repeater lived here until 2026-08-07 — a per-row TipTap instance
// in a WeakMap, a clone <template>, and four delegated buttons. Removed with the
// section it served (ADR-0020; the reasoning is in src/pages/about.astro's header).
//
// ⚠ AND IF YOU ADD OR REMOVE A FIELD HERE, READ THIS FIRST. `$` below is
// `getElementById(id) as T` with no null check — the cast lies. A reference to an
// element that no longer exists throws a TypeError at module top level, and
// everything below the throw never runs. Put such a reference ABOVE the
// `saveBtn.addEventListener` at the foot of this file and the Save button never
// gets its listener: the room looks completely normal and silently cannot save.
// TypeScript cannot see it (the cast) and neither can `astro check`.
//
// ⚠ The ordering is the whole subtlety, and it was measured rather than assumed
// (2026-08-07). The same broken reference appended at the very END of this file
// leaves saving perfectly functional, because the listener was already
// registered. So "a stray reference kills the module" is only half true — it
// kills whatever had not yet executed. The repeater removed above lived exactly
// where it is dangerous: between the editors and the save block.
//
// `tests/e2e/about-builder.spec.ts` now guards this, and was watched failing
// against a deliberate break in that position before being trusted.
import { actions } from 'astro:actions';
import { mountRichEditor } from './rich-editor';
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
      portrait: portraitPath.value || null,
      portrait_caption: val('f-portrait-caption'),
      body: meEditor.getMarkdown(),
    },
    site: {
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
    // `preventDefault()` alone triggers the prompt; the legacy `returnValue`
    // spelling (Chrome/Edge < 119) is deprecated. See writing-sheet.ts.
    e.preventDefault();
  }
});
