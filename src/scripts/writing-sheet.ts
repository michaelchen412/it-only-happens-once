// Client logic for the WritingSheet drawer (components/admin/WritingSheet.astro).
// TipTap (WYSIWYG → Markdown, ADR-0006), continuous autosave for drafts,
// explicit save for published pieces, the publish/details dialog, and the
// constellations tab. Kept out of the .astro file so the markup stays legible
// — the same split as admin-list.ts and fragment-panel.ts.
//
// ONLINE-FIRST, deliberately (ADR-0010). This sheet briefly had an IndexedDB
// outbox that queued edits offline and drained them later; it was removed on
// 2026-07-30. A save that can't reach the server is a save that didn't happen,
// and the UI says so plainly rather than implying a safety net that iOS can't
// honour (Safari has no Background Sync, so a queue could only ever drain
// while the app was open anyway).
//
// What survives from that work, because it is NOT offline machinery:
// `base_updated_at` optimistic concurrency. Two tabs — or a stale tab on one
// device against an edit made on another — used to overwrite each other
// silently. Now the second save is rejected as a CONFLICT and the human is
// offered "keep both".
//
// Crash safety for published pieces is now handled server-side by plan 07's
// draft versions: a published piece still never autosaves to the LIVE row, but
// its edits are written to `fragment_versions` on the same debounce a draft
// uses. So the words survive a crash without the public site changing under a
// reader — and every prompt below can finally say where they went.
import { mountRichEditor } from './rich-editor';
import { wireAltDialog } from './alt-dialog';
import { uploadImage } from './upload';
import { actions } from 'astro:actions';
import { slugify } from '../lib/slug';
import { countWords, minutesForWords } from '../lib/reading';
import { formatActionError, nowTime } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { notifyFragmentsChanged } from './fragments-changed';
import { wireConstellationPicker } from './constellation-picker';
import { readIntent } from './open-editor';
import { wireSheetTabs } from './sheet-tabs';
import { wireVersionsPanel } from './versions-panel';
import { wireMusicPanel, type PairedSong } from './music-panel';
import { wireAddMenu } from './fragment-panel';
import { wireProofread } from './writing-proofread';
import { wirePublishDialog } from './writing-publish-dialog';
import { onBackdropDismiss } from './backdrop-close';

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

/**
 * A class, not `hidden` (docs/plans/16 · Piece 1). app.css hides the spinner
 * with `visibility`, so its box survives — `hidden` handed ~1rem of the command
 * row back and took it again on every autosave, which on a draft is every 1.2
 * seconds for as long as you keep writing. It was the worst of the five shifts
 * precisely because it was the one on a timer.
 */
const setSpinner = (on: boolean) => spinner.classList.toggle('is-on', on);

form.addEventListener('submit', (e) => e.preventDefault()); // no implicit submit

// ---- TipTap editor (WYSIWYG → Markdown) + toolbar + link/alt dialogs ----
const askAlt = wireAltDialog(document.getElementById('ws-alt-dialog') as HTMLDialogElement);

const {
  editor,
  getMarkdown,
  proofread: marks,
} = mountRichEditor({
  // The composer is the only editor that asks for this — the capture box, the
  // notes room and the About builder's two bodies all mount the same function and
  // get none of it (docs/plans/22 · Piece 4). *Said "the interest notes" until
  // 2026-08-07; that editor was removed with ADR-0020.*
  proofread: true,
  editorEl: document.getElementById('ws-editor')!,
  toolbarRoot: sheet.querySelector('[role="toolbar"]') as HTMLElement,
  linkDialog: document.getElementById('ws-link-dialog') as HTMLDialogElement,
  placeholder: 'Start writing…',
  content: '',
  ariaLabel: 'Article body',
  // Images (docs/plans/03). Files are keyed on the FRAGMENT ID, not the slug:
  // ids are minted client-side before the row exists, so this works on a piece
  // that has never been saved, and a later rename never moves the files.
  images: {
    upload: async (file) =>
      (await uploadImage(file, { pathFor: (hash, ext) => `essays/${idField.value}/${hash}.${ext}` })).url,
    askAlt,
    onStatus: (m) => (m ? setStatusNote(m) : restStatus()),
    onError: (m) => {
      jsError.textContent = m;
      jsError.hidden = false;
    },
  },
});

// ---- status indicator ----
function setSaving() {
  setSpinner(true);
  statusText.textContent = 'Saving…';
  statusText.classList.remove('text-error', 'text-warning');
}
function setSaved(msg = 'Saved ' + nowTime()) {
  setSpinner(false);
  statusText.textContent = msg;
  statusText.classList.remove('text-error', 'text-warning');
}
function setStatusError(msg: string) {
  setSpinner(false);
  statusText.textContent = msg;
  statusText.classList.remove('text-warning');
  statusText.classList.add('text-error');
}
/** Off-band notices: saved-locally, second-tab, will-sync. Never red. */
function setStatusNote(msg: string) {
  setSpinner(false);
  statusText.textContent = msg;
  statusText.classList.remove('text-error');
  statusText.classList.add('text-warning');
}

// ---- live signals: how long is this (docs/plans/06) ----
// Counted from TipTap's own plain text, not from the serialized Markdown, so
// typing doesn't pay for a Markdown round-trip 200ms at a time. The ARITHMETIC
// is shared with the public read time (../lib/reading) — that module exists
// precisely so these two can't drift into disagreeing about the same piece.
const countEl = document.getElementById('ws-count') as HTMLElement;

function measure(): { words: number; minutes: number } {
  const words = countWords(editor.getText({ blockSeparator: ' ' }));
  return { words, minutes: minutesForWords(words) };
}

function renderCount() {
  const { words, minutes } = measure();
  countEl.hidden = words === 0; // an empty sheet shouldn't announce "0 words · 1 min"
  // The trailing separator belongs to the count, so the status text beside it
  // stays a plain sentence: "1,240 words · 6 min · Saved 14:32".
  countEl.textContent = `${words === 1 ? '1 word' : `${words.toLocaleString()} words`} · ${minutes} min ·`;
}

let countTimer: number | undefined;
function scheduleCount() {
  clearTimeout(countTimer);
  countTimer = window.setTimeout(renderCount, 250);
}
// Its own listener rather than a line inside onEdit(): length is not a save
// concern, and it should keep updating in states where saving is paused.
editor.on('update', scheduleCount);

// ---- publish-state bar toggle ----
const draftActions = document.getElementById('ws-actions-draft')!;
const publishedActions = document.getElementById('ws-actions-published')!;
const saveChangesBtn = document.getElementById('ws-save-changes') as HTMLButtonElement;
const discardBtn = document.getElementById('ws-discard') as HTMLButtonElement;
const viewLink = document.getElementById('ws-view-link') as HTMLAnchorElement;
const deleteBtn = document.getElementById('ws-delete') as HTMLButtonElement;
/** Delete's home since plan 16: the foot of the document, below a rule. */
const deleteZone = document.getElementById('ws-delete-zone') as HTMLElement;
const toDraftBtn = document.getElementById('ws-to-draft') as HTMLButtonElement;
const detailsBtn = document.getElementById('ws-open-details') as HTMLButtonElement;
const unpublishBtn = document.getElementById('ws-unpublish') as HTMLButtonElement;
const moreBtn = document.getElementById('ws-more-btn') as HTMLButtonElement;
const proofreadBtn = document.getElementById('ws-proofread') as HTMLButtonElement;
/**
 * The ⋯ overflow (docs/plans/16 · Piece 1). `wireAddMenu` is reused rather than
 * a second dropdown invented: it already carries keyboard nav, outside-click
 * and Escape, and it is what the other two menus in the admin are. A second
 * implementation is how two menus start behaving differently.
 */
const { close: closeMoreMenu } = wireAddMenu(moreBtn, document.getElementById('ws-more-menu')!);
const headingLabel = document.getElementById('ws-heading-label') as HTMLElement;
const versionsTab = sheet.querySelector('[data-tab="versions"]') as HTMLButtonElement;
let savedStatus = 'draft';
let dirty = false;
let everSaved = false; // any successful server save this open → reload on close
let loadFailed = false; // fetch failed → sheet is inert (view-only shell)
let prevHash = ''; // the hash to restore on close (e.g. the browser's #browse)
/** The server row exists (vs. an id we minted that the server hasn't seen). */
let serverHasRow = false;
/** Opaque concurrency token: the server `updated_at` this copy is based on. */
let baseUpdatedAt: string | null = null;
/** A declined conflict: autosave stops re-asking; explicit saves re-surface it.
 *  (Kept post-ADR-0010 — conflicts are an ONLINE hazard too, and without this
 *  a declined dialog would return every time the autosave timer fires.) */
let conflictParked = false;
/**
 * A working draft version holds this session's edits on the server (plan 07).
 * Only set after a version save actually lands — the close prompt reads it, so
 * an optimistic value here would be a lie about where someone's words are.
 */
let versionHeld = false;
const isPublished = () => savedStatus === 'published';
/** The scratch tier (docs/plans/09 Piece 2) — autosaves exactly like a draft. */
const isNote = () => savedStatus === 'note';

/**
 * What the bar says when nothing is happening. Extracted from `populate` so an
 * image upload can put it back: the upload borrows the line for "Uploading
 * image…", and on failure nothing else would ever reclaim it.
 */
function restStatus() {
  setSpinner(false);
  statusText.classList.remove('text-error', 'text-warning');
  statusText.textContent = isPublished()
    ? 'Up to date'
    : isNote()
      ? 'A note — autosaves, never public'
      : 'Autosaves as you write';
  updateDirtyUI(); // a published piece mid-edit has more to say than "Up to date"
}

function reflectStatus() {
  draftActions.hidden = isPublished();
  publishedActions.hidden = !isPublished();
  toDraftBtn.hidden = !isNote();
  detailsBtn.hidden = !isPublished();
  unpublishBtn.hidden = !isPublished();
  // The word left the row; only the flip survives, as a chip (see the markup).
  headingLabel.hidden = !isNote();
  // Only a published piece has versions: a draft simply edits itself.
  versionsTab.hidden = !(isPublished() && serverHasRow);
  updateDirtyUI();
}

/**
 * The ⋯ button exists only when there is something behind it. A plain draft has
 * nothing — Publish… is in the row and Delete is at the foot of the document —
 * so the door would open onto an empty box. Hiding it is safe motion-wise: what
 * this piece IS only changes at open time, or on an explicit publish/unpublish
 * you just pressed, never mid-sentence.
 */
function syncMoreMenu() {
  // ⚠ `proofreadBtn` IS IN THIS LIST AND IS NEVER HIDDEN, so the ⋯ button is now
  // permanent (docs/plans/22 · Piece 6). Before, a plain draft hid all four of
  // the others and the door went with them — a Proofread behind it would have
  // been unreachable in exactly the state you press it in. The comment above
  // still holds for the other four; what changed is that there is now always
  // something behind the door.
  const items = [proofreadBtn, toDraftBtn, detailsBtn, discardBtn, unpublishBtn];
  moreBtn.hidden = !items.some((el) => !el.hidden);
  if (moreBtn.hidden) closeMoreMenu();
}
/**
 * The permalink button. Published pieces get "View"; drafts and notes get
 * "Preview" pointing at the SAME url — plan 01 made /blog/[slug] render an
 * unpublished piece for an admin session, so there is no separate preview route
 * to send them to, and that is the point: what you check is what ships.
 *
 * Hidden until the row exists on the server. The slug is auto-filled from the
 * title as you type, so before the first save this would be a link to a piece
 * the database has never heard of — a 404 with your name on it.
 */
function updateViewLink(slug: string) {
  const show = !!slug && serverHasRow;
  viewLink.hidden = !show;
  if (!show) return;
  viewLink.href = `/blog/${slug}`;
  viewLink.textContent = isPublished() ? 'View ↗' : 'Preview ↗';
  viewLink.title = isPublished() ? '' : 'Opens the real public page — only you can see it until it’s published';
}

/**
 * Published posts never autosave to the LIVE row — edits accumulate and go out
 * via an explicit "Save changes" (docs/admin.md §5), because republishing
 * without a human present is the one thing this editor must not do.
 *
 * They DO autosave into a draft version (plan 07), so the dirty state is
 * "not public yet", not "not saved anywhere". `versionHeld` tracks whether
 * that has actually landed this session, so the wording never claims a safety
 * net that isn't there yet — during the first debounce, it isn't.
 */
function updateDirtyUI() {
  if (isPublished()) {
    saveChangesBtn.disabled = !dirty;
    // Discard used to be a BUTTON APPEARING IN THE ROW on your first keystroke,
    // shoving Save changes and everything beside it sideways mid-sentence — the
    // single worst of the shifts this piece was opened for. Inside the ⋯ menu it
    // can come and go for free, which is the whole argument for the menu.
    discardBtn.hidden = !dirty;
    syncMoreMenu();
    if (dirty) {
      setSpinner(false);
      statusText.textContent = versionHeld ? `Kept as a draft version · not public yet` : 'Unsaved changes';
      statusText.classList.add('text-warning');
      return;
    }
  } else {
    discardBtn.hidden = true;
    syncMoreMenu();
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

// ---- edits: autosave on a debounce (drafts to the row, published to a version) ----
const NET_MS = 1200;
let timer: number | undefined;
let lock: Promise<unknown> = Promise.resolve();

/**
 * A published piece's edits go to its working version, never to the live row
 * (plan 07). Failure is quiet on purpose: the visible state is already
 * "unsaved and not public", so a red banner every 1.2 seconds while a tunnel
 * eats the connection would add noise, not information — and "Save changes"
 * reports loudly when it can't reach the server.
 */
async function saveWorkingVersion(): Promise<void> {
  if (!serverHasRow || !idField.value) return;
  const fd = new FormData();
  fd.set('fragment_id', idField.value);
  fd.set('title', titleField.value);
  fd.set('excerpt', excerptField.value);
  fd.set('body', getMarkdown());
  try {
    const { error } = await actions.versions.saveWorking(fd);
    if (error) return;
    versionHeld = true;
    versionsPanel.setFragment(idField.value, true);
    if (dirty) updateDirtyUI(); // upgrade the wording now that it's true
  } catch {
    // offline or server down — the piece is unchanged and the UI already says so
  }
}

function onEdit() {
  if (loadFailed || !sheet.open) return;
  dirty = true;
  if (isPublished()) {
    updateDirtyUI(); // the LIVE row waits for an explicit Save changes…
    clearTimeout(timer);
    timer = window.setTimeout(() => void saveWorkingVersion(), NET_MS); // …the words don't
    return;
  }
  if (conflictParked) return; // only explicit saves re-ask
  clearTimeout(timer);
  timer = window.setTimeout(() => save(savedStatus, { silentEmpty: true }), NET_MS);
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

/** One serialization of the form — also reused verbatim by the conflict copy. */
function buildFields(status: string): Record<string, string> {
  bodyField.value = getMarkdown();
  const fd = new FormData(form);
  fd.set('body', bodyField.value);
  fd.set('status', status);
  if (!dateToggle.checked) fd.delete('occurred_at'); // absent = automatic date
  if (baseUpdatedAt) fd.set('base_updated_at', baseUpdatedAt);
  const fields: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (typeof v === 'string') fields[k] = v;
  });
  return fields;
}

async function doSave(status: string, opts: { silentEmpty?: boolean }): Promise<boolean> {
  if (loadFailed) return false;
  if (!hasContent()) {
    if (!opts.silentEmpty) setStatusError('Add a title or some words first');
    return false;
  }
  setSaving();
  const fields = buildFields(status);
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  // astro:actions THROWS on a dead network (a bare fetch under the hood) — it
  // only *returns* { error } for failures the server sent back, so the offline
  // case has to be caught, not checked. Nothing stores these words but the
  // editor itself, so say that rather than implying a queue (ADR-0010).
  let result: Awaited<ReturnType<typeof actions.fragments.saveWriting>> | null = null;
  try {
    result = await actions.fragments.saveWriting(fd);
  } catch {
    setStatusError('Can’t reach the server — these words are unsaved');
    return false;
  }
  const { data, error } = result;

  if (error || !data) {
    if (error?.code === 'CONFLICT') return handleConflict();
    setStatusError('Save failed');
    jsError.textContent = error ? formatActionError(error) : 'The server returned no data.';
    jsError.hidden = false;
    return false;
  }
  jsError.hidden = true;
  conflictParked = false;
  baseUpdatedAt = data.updated_at;
  if (!serverHasRow) {
    serverHasRow = true;
    // Whatever was ticked before the piece existed (including the
    // composer's pre-tick) can only be written now that the row exists.
    await picker.flush(idField.value);
    setHash(`#edit=${idField.value}`);
    deleteZone.hidden = false;
  }
  if (!slugTouched && data.slug) slugField.value = data.slug;
  savedStatus = status;
  updateViewLink(data.slug ?? slugField.value); // after savedStatus: it picks View vs Preview from it
  everSaved = true;
  dirty = false;
  reflectStatus();
  setSaved();
  return true;
}

// ---- conflicts: never silently lose prose ----

/** Save the given state as a fresh draft ("keep both"). Never throws. */
async function saveAsCopy(fields: Record<string, string>): Promise<boolean> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set('id', crypto.randomUUID());
  fd.set('title', `${fields.title || 'Untitled'} (conflict copy ${nowTime()})`);
  fd.set('status', 'draft');
  fd.delete('slug'); // regenerate — the original keeps its slug
  fd.delete('base_updated_at');
  let error: unknown;
  try {
    ({ error } = await actions.fragments.saveWriting(fd));
  } catch (e) {
    error = e; // offline — the caller keeps the words local
  }
  if (error) {
    jsError.textContent = formatActionError(error);
    jsError.hidden = false;
  }
  return !error;
}

async function handleConflict(): Promise<false> {
  setStatusError('Conflict — this piece changed elsewhere');
  const ok = await confirmDialog({
    title: 'This piece changed on the server',
    message:
      'It was edited somewhere else after this copy loaded. Keep both? Your version here becomes a separate draft copy, and this editor reloads the server version. Cancel keeps everything as it is — you will be asked again on your next explicit save.',
    confirmLabel: 'Keep both',
  });
  if (ok) {
    const saved = await saveAsCopy(buildFields(savedStatus));
    if (saved) {
      conflictParked = false;
      dirty = false;
      everSaved = true; // the list underneath must refresh (a copy now exists)
      await openEdit(idField.value);
    } else {
      setStatusError('Could not save the copy — your words are still here');
      conflictParked = true; // stop autosave from re-asking while it can't resolve
    }
  } else {
    // Parked: the entry stays marked, drain skips it, autosave stops asking.
    // Any explicit save (publish, Save changes, close-flush) re-surfaces this.
    conflictParked = true;
  }
  return false;
}

window.addEventListener('beforeunload', (e) => {
  // Still warn on any dirty state. A published piece's words are usually held
  // in a draft version by now (plan 07), but "usually" is the whole point: the
  // debounce may not have fired, and this is the last chance to say so.
  if (sheet.open && dirty) {
    // `preventDefault()` is the whole trigger. The `e.returnValue = ''` that
    // used to sit here was the legacy spelling for Chrome/Edge before 119
    // (Oct 2023) and is deprecated; every browser that can sign into this
    // admin area honours the standard form. Removed 2026-08-07 — and only
    // here, in rooms one person uses, never on a public page.
    e.preventDefault();
  }
});

// ---- second-tab guard: one writer per fragment ----
// Web Locks, not IndexedDB — this is the warning half of the same hazard
// `base_updated_at` catches at save time, and it stays post-ADR-0010. It spans
// tabs in one browser only; across devices, the concurrency token is the guard.
let editLockRelease: (() => void) | null = null;
function releaseEditLock() {
  editLockRelease?.();
  editLockRelease = null;
}
function acquireEditLock(id: string) {
  releaseEditLock();
  if (!navigator.locks) return; // pre-15.4 Safari: CAS still prevents silent loss
  void navigator.locks.request(`ioho-frag-${id}`, { ifAvailable: true }, (grant) => {
    if (!grant) {
      setStatusNote('Also open in another tab — edits may collide');
      return;
    }
    // Hold until closed; the browser releases it if this tab dies.
    return new Promise<void>((resolve) => {
      editLockRelease = resolve;
    });
  });
}

// ---- constellation membership (its own tab) ----
const cnPanel = document.getElementById('ws-panel-cn') as HTMLElement;
const picker = wireConstellationPicker(cnPanel.querySelector('.cn-picker') as HTMLElement);
const cnCount = document.getElementById('ws-cn-count')!;
const toolbar = document.getElementById('ws-toolbar') as HTMLElement;

// ---- the paired song (its own tab, ADR-0009) ----
const musicPanel = wireMusicPanel({
  root: document.getElementById('ws-panel-music') as HTMLElement,
  markEl: document.getElementById('ws-music-mark')!,
});

// The formatting toolbar belongs to the document; hide it on the other tabs.
// The music panel loads its list here rather than on open — one round trip,
// and only if you actually go looking for a song.
const tabs = wireSheetTabs(sheet, (key) => {
  toolbar.hidden = key !== 'doc';
  if (key === 'music') musicPanel.refresh();
});

// ---- draft versions (its own tab, published pieces only) ----
const versionsPanel = wireVersionsPanel({
  listEl: document.getElementById('ws-ver-list') as HTMLElement,
  errorEl: document.getElementById('ws-ver-error') as HTMLElement,
  countEl: document.getElementById('ws-ver-count') as HTMLElement,
  // Promotion rewrote the live piece: reload it so the editor shows what is
  // actually published rather than whatever was on screen a moment ago.
  onPromoted() {
    dirty = false;
    versionHeld = false;
    everSaved = true; // the list underneath shows a new "edited" time
    void openEdit(idField.value);
  },
  /**
   * Put a version's words back in the editor. Nothing is published and the
   * fragment is untouched — this loads text, and from here on it's an ordinary
   * edit of a published piece, autosaving into the working version.
   *
   * The guard exists because editing always resumes into the ONE working
   * version, so loading a different set of words destroys whatever that version
   * held as soon as the debounce fires.
   *
   * TWO different things can be at stake, and a destructive prompt that names
   * the wrong one is worse than no prompt. Resuming the working version can
   * only cost the keystrokes the debounce hasn't written yet — the version
   * itself is where these words came from. Starting from a kept variant
   * overwrites the entire pending rewrite, including one recovered from a
   * crash, which is the case this whole feature exists for. `dirty` is
   * consulted separately from `hasWorking()` because edits typed inside the
   * last debounce exist only in the editor, where the panel's list can't see
   * them.
   */
  async onResume(words, fromWorking) {
    const risk = fromWorking
      ? dirty && {
          title: 'Go back to the saved rewrite?',
          message:
            'Your most recent typing hasn’t reached this version yet. Loading it replaces what’s in the editor with the last copy the server took.',
          confirmLabel: 'Load the saved rewrite',
        }
      : (dirty || versionsPanel.hasWorking()) && {
          title: 'Replace the pending rewrite?',
          message:
            'Editing always resumes into a single working version, so loading these words throws away the edits it holds now. Kept variants and the published piece are unaffected.',
          confirmLabel: 'Load these words',
        };
    if (risk && !(await confirmDialog({ ...risk, danger: true }))) return;
    titleField.value = words.title;
    excerptField.value = words.excerpt;
    editor.commands.setContent(words.body, { emitUpdate: false });
    renderCount(); // setContent emits no update, so the signals need telling
    // Truthful the moment it's set, unlike the autosave path: these words were
    // just read back OFF the server, so "kept as a version" is already the case.
    versionHeld = true;
    tabs.select('doc'); // before focus — the editor is hidden on the other tab
    onEdit(); // marks dirty and arms the autosave into the working version
    editor.commands.focus('end');
  },
});

function setCnLabel(n: number) {
  cnCount.textContent = n ? String(n) : '';
}
cnPanel.addEventListener('change', () => {
  setCnLabel(cnPanel.querySelectorAll<HTMLInputElement>('.cn-check:checked').length);
});

// ---- opening ----
const setHash = (h: string) => history.replaceState(null, '', location.pathname + location.search + h);
const setSubjects = (v: string) =>
  (document.querySelector('#publish-dialog tag-input') as HTMLElement & { setTags?: (v: string) => void })?.setTags?.(
    v,
  );

interface Loaded {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  status: string;
  occurredIso: string;
  updatedAt: string;
  subjects: string;
  constellationIds?: string[];
  /** The paired song (ADR-0009), or null. Comes from `fragments.get`. */
  paired?: PairedSong | null;
}

function populate(d: Loaded | null) {
  loadFailed = false;
  clearTimeout(timer);
  // Ids are minted client-side and the action upserts by id, so a new piece
  // has a stable identity before its first save — which is what lets the
  // constellation picker queue memberships for a row that doesn't exist yet.
  idField.value = d?.id ?? crypto.randomUUID();
  serverHasRow = !!d;
  baseUpdatedAt = d?.updatedAt ?? null;
  conflictParked = false;
  titleField.value = d?.title ?? '';
  // TipTap v3 emits `update` from setContent by default — that would arm the
  // save timer and mark unchanged content dirty.
  editor.commands.setContent(d?.body ?? '', { emitUpdate: false });
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
  versionHeld = false;
  jsError.hidden = true;
  deleteZone.hidden = !d;
  reflectStatus();
  // Versions are a published-piece concern; the panel fetches on its own and
  // reports back through the tab's count, including any working version left
  // behind by a crash.
  versionsPanel.setFragment(d?.id ?? null, !!d && d.status === 'published');
  restStatus();
  renderCount(); // setContent above emits no update, so measure it directly
  updateViewLink(d?.slug ?? '');
  const memberIds = d?.constellationIds ?? [];
  picker.setFragment(d?.id ?? null, memberIds);
  setCnLabel(memberIds.length);
  // A brand-new piece has no row yet, so there's nothing to point a pairing at
  // until the first save — `pair` updates by id, which must exist.
  musicPanel.setFragment(d?.id ?? null, d?.paired ?? null);
  tabs.select('doc'); // always open on the writing, never mid-composition
  pfReset(); // a mark from the last piece must not linger (docs/plans/22 · Piece 7)
  acquireEditLock(idField.value);
}

function openSheet(hash: string, fromHash: boolean) {
  prevHash = fromHash ? '' : location.hash;
  setHash(hash);
  if (!sheet.open) sheet.showModal();
}

function openNew(fromHash = false, asNote = false) {
  populate(null);
  if (asNote) {
    savedStatus = 'note';
    reflectStatus();
    statusText.textContent = 'A note — autosaves, never public';
  }
  // Composer context: pre-tick that constellation, so the implicit
  // data-place-in hook is now something you can see and untick.
  const placeIn = document.body.dataset.placeIn;
  if (placeIn) {
    picker.preselect(placeIn);
    setCnLabel(1);
  }
  openSheet(asNote ? '#new-note' : '#new-writing', fromHash);
  titleField.focus();
}

async function openEdit(id: string, fromHash = false, tab?: string) {
  let loaded: Loaded | null = null;
  let loadError: unknown = null;
  try {
    const { data, error } = await actions.fragments.get({ id });
    if (error || !data || data.type !== 'writing') loadError = error ?? null;
    else loaded = data as Loaded;
  } catch (e) {
    loadError = e; // the workshop needs a connection to open a piece (ADR-0010)
  }
  if (!loaded) {
    // open an inert shell with the error visible — nothing here can save
    populate(null);
    loadFailed = true;
    jsError.textContent = loadError ? formatActionError(loadError) : 'That piece could not be loaded.';
    jsError.hidden = false;
    openSheet('', fromHash);
    return;
  }
  populate(loaded);
  // AFTER populate, which resets to the document — a caller that named a tab
  // (the list's membership cell asks for 'constellations') is overruling that
  // default, so it has to land second. Only on the success path: the inert
  // error shell above has nothing to show on any other tab.
  if (tab) tabs.select(tab);
  openSheet(`#edit=${id}`, fromHash);
}

// ---- closing (every exit funnels through here) ----
function closeNow() {
  dirty = false;
  releaseEditLock();
  // A pairing counts too: it applied immediately, so the feed underneath is
  // now stale in exactly the way a membership change makes it stale.
  const stale = everSaved || picker.changed() || musicPanel.changed();
  setHash(prevHash); // restore the underlying context (e.g. #browse) first
  sheet.close();
  // This used to be `location.reload()` on the very next line, which meant the
  // 0.28s slide-out got a frame or two before the page started tearing down —
  // the "instantly disappears, and there's some bit of lag" of the report. The
  // close is real now, and the host refreshes in place around it.
  if (stale) notifyFragmentsChanged(sheet);
}
async function requestClose() {
  if (!loadFailed && dirty) {
    if (isPublished()) {
      // One last attempt to park the words in a draft version, then tell the
      // truth about where they are. Before plan 07 this branch could only warn
      // that closing lost them outright; now that's the exception, not the rule.
      clearTimeout(timer);
      await saveWorkingVersion();
      if (versionHeld) {
        const ok = await confirmDialog({
          title: 'Close without publishing?',
          message:
            'Your edits are kept as a draft version — the live piece is unchanged. Reopen this piece and they’ll be waiting under Versions.',
          confirmLabel: 'Close',
        });
        if (!ok) return;
      } else {
        const ok = await confirmDialog({
          title: 'Discard changes?',
          message: 'These edits haven’t reached the server, so they aren’t stored anywhere else. Close without saving?',
          confirmLabel: 'Discard',
          danger: true,
        });
        if (!ok) return;
      }
    } else {
      // Drafts: one last save attempt. If it can't land, closing loses the
      // words, so ask rather than closing quietly.
      clearTimeout(timer);
      const ok = await save(savedStatus, { silentEmpty: true });
      if (!ok && hasContent()) {
        const discard = await confirmDialog({
          title: 'Couldn’t save',
          message: 'These words haven’t reached the server. Close anyway and lose them?',
          confirmLabel: 'Close and lose them',
          danger: true,
        });
        if (!discard) return;
      }
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
// (a text selection released outside must not close the sheet) — see
// `backdrop-close.ts`, which is where that guard lives now.
onBackdropDismiss(sheet, requestClose);

// ---- publish / details dialog ----
// A surface of its own (src/scripts/writing-publish-dialog.ts): the preflight,
// the subject suggester and the confirm that serves both modes. It looks up its
// own DOM; what it borrows from here is behaviour.
wirePublishDialog({
  form,
  measure,
  getMarkdown,
  setSubjects,
  save,
  setSaved,
  // ⚠ A GETTER. `savedStatus` moves while the dialog is open.
  currentStatus: () => savedStatus,
  selectTab: (key) => tabs.select(key),
});

// ---- notes: one step up the pipeline (note → draft) ----
// No confirmation: nothing is destroyed, nothing goes public, and the reverse
// move is one click away in the manager's bulk bar.
toDraftBtn.addEventListener('click', async () => {
  toDraftBtn.disabled = true;
  const saved = await save('draft');
  toDraftBtn.disabled = false;
  if (!saved) return;
  reflectStatus(); // save() has already advanced savedStatus
  setSaved('Now a draft ' + nowTime());
  everSaved = true; // the list underneath moves it out of Notes
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

// ---- published: explicit Save changes / Discard (the live row waits for you) ----

/** No pending rewrite any more — for either reason. Never throws. */
async function dropWorkingVersion(): Promise<void> {
  if (!idField.value) return;
  const fd = new FormData();
  fd.set('fragment_id', idField.value);
  try {
    await actions.versions.discardWorking(fd);
  } catch {
    // A stale working version is untidy, not dangerous: it shows in the panel
    // as "identical to what's live" and is one click from being deleted.
  }
  versionHeld = false;
}

saveChangesBtn.addEventListener('click', async () => {
  saveChangesBtn.disabled = true;
  const ok = await save('published');
  if (!ok) return void (saveChangesBtn.disabled = false); // still dirty
  clearTimeout(timer); // an autosave in flight would re-create what we just cleared
  await dropWorkingVersion(); // these words ARE the piece now
  versionsPanel.setFragment(idField.value, true);
});

discardBtn.addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Discard changes',
    message:
      'Throw away your edits to this published piece? The live version is unaffected — and if you might want them later, close instead: they’re kept as a draft version.',
    confirmLabel: 'Discard',
    danger: true,
  });
  if (!ok) return;
  clearTimeout(timer);
  await dropWorkingVersion();
  // reload the saved version in place — the sheet stays open
  dirty = false;
  await openEdit(idField.value);
});

deleteBtn.addEventListener('click', async () => {
  if (!idField.value || !serverHasRow) return;
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
  let error: unknown;
  try {
    ({ error } = await actions.fragments.trash(fd));
  } catch (e) {
    error = e; // no connection — keep the piece as it is
  }
  deleteBtn.disabled = false;
  if (error) return setStatusError(formatActionError(error));
  dirty = false;
  everSaved = true; // the list underneath must refresh
  closeNow();
});

// ---- proofreading (docs/plans/22) ----
// Explicit press, never automatic: it is a paid call, and the composer's whole
// contract is instruments that never act on their own.
const { reset: pfReset } = wireProofread({
  editor,
  marks,
  titleField,
  jsError,
  proofreadBtn,
  sheet,
  closeMenu: closeMoreMenu,
});

// ---- triggers: events, buttons, deep links ----
document.addEventListener('writing:edit', (e) => {
  // Either shape: a bare id, or `{ id, tab }` (src/scripts/open-editor.ts).
  const intent = readIntent((e as CustomEvent).detail, 'id');
  if (intent) void openEdit(intent.value, false, intent.tab);
});
document
  .querySelectorAll<HTMLElement>('[data-new-writing]')
  .forEach((btn) => btn.addEventListener('click', () => openNew()));
document
  .querySelectorAll<HTMLElement>('[data-new-note]')
  .forEach((btn) => btn.addEventListener('click', () => openNew(false, true)));

const m = location.hash.match(/^#edit=([0-9a-f][0-9a-f-]{30,40})$/i);
if (m) void openEdit(m[1], true);
else if (location.hash === '#new-writing') openNew(true);
else if (location.hash === '#new-note') openNew(true, true);
