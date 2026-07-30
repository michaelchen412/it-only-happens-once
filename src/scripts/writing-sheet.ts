// Client logic for the WritingSheet drawer (components/admin/WritingSheet.astro).
// TipTap (WYSIWYG → Markdown, ADR-0006), continuous autosave for drafts,
// explicit save for published pieces, the publish/details dialog, and the
// constellations tab. Kept out of the .astro file so the markup stays legible
// — the same split as admin-list.ts and fragment-panel.ts.
//
// Durability (docs/plans/09 Piece 1): every edit is written to IndexedDB
// (the outbox, outbox.ts) BEFORE the network is attempted, on a short local
// debounce. Ids are minted client-side, so a fragment exists locally before
// the server ever hears of it. A failed push is a pending outbox entry that
// drains on startup / online / visibilitychange / retry backoff; a push over
// a server copy that moved is a CONFLICT surfaced to the human, never a
// silent overwrite. Losing the network means delay, not loss.
import { mountRichEditor } from './rich-editor';
import { actions } from 'astro:actions';
import { slugify } from '../lib/slug';
import { formatActionError, nowTime } from './action-error';
import { confirmDialog } from './confirm-dialog';
import { wireConstellationPicker } from './constellation-picker';
import { wireSheetTabs } from './sheet-tabs';
import * as outbox from './outbox';

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

// Ask the browser to spare this origin from storage-pressure eviction. A
// request, not a guarantee — and no help against iOS's 7-day ITP wipe, which
// only a home-screen install avoids (docs/plans/09 Piece 4).
if (navigator.storage?.persist) void navigator.storage.persist();
if (navigator.storage?.estimate) {
  void navigator.storage.estimate().then(({ usage, quota }) => {
    // The outbox is KBs against a quota of GBs; if this ever fires, something
    // else is eating the origin. Surfacing it in UI is the "global sync
    // indicator" open question in docs/plans/09.
    if (usage && quota && usage / quota > 0.9) console.warn(`Origin storage ${Math.round((usage / quota) * 100)}% full — IndexedDB writes may start failing`);
  });
}

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
  statusText.classList.remove('text-error', 'text-warning');
}
function setSaved(msg = 'Saved ' + nowTime()) {
  spinner.hidden = true;
  statusText.textContent = msg;
  statusText.classList.remove('text-error', 'text-warning');
}
function setStatusError(msg: string) {
  spinner.hidden = true;
  statusText.textContent = msg;
  statusText.classList.remove('text-warning');
  statusText.classList.add('text-error');
}
/** Off-band notices: saved-locally, second-tab, will-sync. Never red. */
function setStatusNote(msg: string) {
  spinner.hidden = true;
  statusText.textContent = msg;
  statusText.classList.remove('text-error');
  statusText.classList.add('text-warning');
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
let everSaved = false; // any successful server save this open → reload on close
let loadFailed = false; // fetch failed → sheet is inert (view-only shell)
let prevHash = ''; // the hash to restore on close (e.g. the browser's #browse)
/** The server row exists (vs. an id we minted that the server hasn't seen). */
let serverHasRow = false;
/** Opaque concurrency token: the server `updated_at` this copy is based on. */
let baseUpdatedAt: string | null = null;
/** Edits newer than the last IndexedDB write (the only truly at-risk state). */
let localDirty = false;
/** A declined conflict: autosave stops re-asking; explicit saves re-surface it. */
let conflictParked = false;
/** Fragment whose local entry is mid-restore-offer — drains must skip it. */
let settling: string | null = null;
const isPublished = () => savedStatus === 'published';

/** Fire-and-forget outbox bookkeeping — IndexedDB trouble must never break a save. */
const quiet = (p: Promise<unknown>) => void p.catch(() => {});

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
 * (They ARE snapshotted to the outbox as crash insurance — kind 'manual',
 * never auto-pushed; see writeLocal.)
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

// ---- edits: IndexedDB on a short debounce, network on a longer one ----
// Local writes are nearly free, so the at-risk window is ~LOCAL_MS of typing;
// the network keeps its old cadence. Published pieces get the local snapshot
// only (no auto-push).
const LOCAL_MS = 300;
const NET_MS = 1200;
let localTimer: number | undefined;
let timer: number | undefined;
let lock: Promise<unknown> = Promise.resolve();

function onEdit() {
  if (loadFailed || !sheet.open) return;
  dirty = true;
  localDirty = true;
  clearTimeout(localTimer);
  localTimer = window.setTimeout(() => void writeLocal(), LOCAL_MS);
  if (isPublished()) {
    updateDirtyUI(); // no auto-push — light up Save changes / Discard
    return;
  }
  if (conflictParked) return; // local snapshots continue; only explicit saves re-ask
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

/**
 * One serialization of the form for both destinations: what goes to
 * IndexedDB is byte-for-byte what would go to the server, so a drained
 * entry replays exactly.
 */
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

/** The IndexedDB-first half of every save. localDirty clears only once the
 *  words are truly in IndexedDB — if the put fails they exist nowhere but the
 *  editor, and beforeunload must still warn. */
async function writeLocal(): Promise<void> {
  clearTimeout(localTimer);
  if (loadFailed || !sheet.open || !hasContent()) {
    localDirty = false; // nothing worth losing
    return;
  }
  try {
    await outbox.put(idField.value, buildFields(savedStatus), isPublished() ? 'manual' : 'auto');
    localDirty = false;
  } catch {
    // IndexedDB unavailable — the words live only in the editor for now.
  }
}

async function doSave(status: string, opts: { silentEmpty?: boolean }): Promise<boolean> {
  if (loadFailed) return false;
  if (!hasContent()) {
    if (!opts.silentEmpty) setStatusError('Add a title or some words first');
    return false;
  }
  setSaving();
  const fields = buildFields(status);
  // Local first — from here on, the words survive anything short of
  // IndexedDB itself failing (and then the network attempt below still runs).
  let entry: outbox.OutboxEntry | null = null;
  try {
    entry = await outbox.put(idField.value, fields, 'auto');
    localDirty = false;
  } catch {
    // IndexedDB unavailable: degrade to network-only; beforeunload still warns.
  }

  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  // astro:actions THROWS on a dead network (a bare fetch under the hood) —
  // it only *returns* { error } for failures the server sent back. Offline
  // is a state here, not an exception.
  let result: Awaited<ReturnType<typeof actions.fragments.saveWriting>> | null = null;
  try {
    result = await actions.fragments.saveWriting(fd);
  } catch {
    setStatusNote(entry ? 'Saved on this device — will sync' : 'Offline — retrying soon');
    scheduleRetry();
    return false;
  }
  const { data, error } = result;

  if (error || !data) {
    if (error?.code === 'CONFLICT') return handleConflict();
    // The server answered and said no — a real rejection, not connectivity.
    // The words stay queued (retries are backoff-capped), but say what happened.
    setStatusError(entry ? 'Save failed — kept on this device' : 'Save failed');
    jsError.textContent = error ? formatActionError(error) : 'The server returned no data.';
    jsError.hidden = false;
    scheduleRetry();
    return false;
  }
  jsError.hidden = true;
  conflictParked = false;
  baseUpdatedAt = data.updated_at;
  if (entry) quiet(outbox.confirmSent(entry.id, entry.rev));
  if (!serverHasRow) {
    serverHasRow = true;
    // Whatever was ticked before the piece existed (including the
    // composer's pre-tick) can only be written now that the row exists.
    await picker.flush(idField.value);
    setHash(`#edit=${idField.value}`);
    deleteBtn.hidden = false;
  }
  if (!slugTouched && data.slug) slugField.value = data.slug;
  updateViewLink(data.slug ?? slugField.value);
  savedStatus = status;
  everSaved = true;
  dirty = false;
  reflectStatus();
  setSaved();
  void drainOutbox(); // a good connection — move anything else that's waiting
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
  quiet(outbox.markConflict(idField.value));
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
      // The words are safe in the copy — only now may the entry go.
      quiet(outbox.remove(idField.value));
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

// ---- the outbox drain: startup, online, visibilitychange, backoff ----
// Background Sync doesn't exist on iOS, so these foreground triggers ARE the
// sync mechanism (docs/plans/09).
const RETRY_MIN = 5_000;
const RETRY_MAX = 300_000;
let retryDelay = RETRY_MIN;
let retryTimer: number | undefined;

/** Exponential backoff toward the next drain; any success or trigger resets it. */
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void drainOutbox(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
}

async function pushEntry(entry: outbox.OutboxEntry): Promise<outbox.PushResult> {
  // Mid-restore-offer for this id (openEdit → offerLocalEntry): pushing now
  // could overwrite the crash words with the stale form. Wait a round.
  if (entry.id === settling) return 'retry';
  // The fragment open in this sheet goes through the sheet's serialized save:
  // single-flight, fresher words (the live form beats the stored snapshot),
  // and conflicts surface through the sheet's own dialog.
  if (sheet.open && !loadFailed && entry.id === idField.value) {
    return (await save(savedStatus, { silentEmpty: true })) ? 'done' : 'retry';
  }
  const fd = new FormData();
  for (const [k, v] of Object.entries(entry.fields)) fd.set(k, v);
  try {
    const { error } = await actions.fragments.saveWriting(fd);
    if (!error) return 'done';
    return error.code === 'CONFLICT' ? 'conflict' : 'retry';
  } catch {
    return 'retry'; // offline — the next trigger tries again
  }
}

async function drainOutbox(): Promise<void> {
  clearTimeout(retryTimer);
  let summary: outbox.DrainSummary;
  try {
    summary = await outbox.drain(pushEntry);
  } catch {
    return; // IndexedDB unavailable — nothing to drain from
  }
  if (summary.remaining > 0) scheduleRetry();
  else retryDelay = RETRY_MIN;
}

window.addEventListener('online', () => {
  retryDelay = RETRY_MIN;
  void drainOutbox();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void drainOutbox();
});
// NOTE: the startup drain fires at the END of this module, after the deep-link
// handlers — openEdit must set `settling` before the first drain can touch a
// crash-recovery entry.

// Last-resort flushes. pagehide can't await IndexedDB, but an initiated write
// usually completes — and the LOCAL_MS debounce keeps this window tiny.
window.addEventListener('pagehide', () => {
  if (localDirty) void writeLocal();
});
window.addEventListener('beforeunload', (e) => {
  // Warn only for words not yet in IndexedDB (or a published piece's
  // explicit-save contract) — locally-safe words don't need a scare dialog.
  if (sheet.open && (localDirty || (isPublished() && dirty))) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---- second-tab guard: one writer per fragment ----
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
  updatedAt: string;
  subjects: string;
  constellationIds?: string[];
}

function populate(d: Loaded | null) {
  loadFailed = false;
  clearTimeout(timer);
  clearTimeout(localTimer);
  // A fragment has an id from its first keystroke — the server learns it on
  // the first successful push (docs/plans/09 Piece 1).
  idField.value = d?.id ?? crypto.randomUUID();
  serverHasRow = !!d;
  baseUpdatedAt = d?.updatedAt ?? null;
  conflictParked = false;
  titleField.value = d?.title ?? '';
  // TipTap v3 emits `update` from setContent by default — that would arm the
  // save timers and mint a phantom outbox snapshot of unchanged content.
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
  localDirty = false;
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
  acquireEditLock(idField.value);
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

/**
 * Local edits that never reached the server (a crash, a closed lid, a dead
 * tab). Based on the current server version → a draft applies silently (it
 * is just the autosave that didn't finish) and a published piece asks.
 * Based on an OLDER version → conflict: offer to keep both.
 *
 * Declining a prompt NEVER discards — the entry stays for next time. The
 * only paths that drop local words are the explicit ones: the Discard
 * button, trash, and a successfully saved conflict copy.
 */
async function offerLocalEntry(d: Loaded): Promise<void> {
  let local: outbox.OutboxEntry | undefined;
  try {
    local = await outbox.get(d.id);
  } catch {
    return; // IndexedDB unavailable — nothing to offer
  }
  if (!local) return;
  const basedOnCurrent = (local.fields.base_updated_at ?? null) === d.updatedAt;

  if (basedOnCurrent && local.kind === 'auto') {
    applyFields(local.fields);
    dirty = true;
    setStatusNote('Saved on this device — syncing');
    clearTimeout(timer);
    timer = window.setTimeout(() => save(savedStatus, { silentEmpty: true }), NET_MS);
    return;
  }

  if (basedOnCurrent) {
    // A published piece's unsaved edits, intact from last time.
    const ok = await confirmDialog({
      title: 'Unsaved edits found',
      message: `This piece has unsaved local edits from ${nowTime(local.savedAt)}. Restore them here? Cancel keeps them for next time.`,
      confirmLabel: 'Restore',
    });
    if (ok) {
      applyFields(local.fields);
      dirty = true;
      updateDirtyUI(); // lights up Save changes
    }
    return;
  }

  // The server moved past what these local edits were based on.
  const ok = await confirmDialog({
    title: 'Older local edits found',
    message:
      'Local edits to this piece were made against an older version than the server now has. Keep them as a separate draft copy? Cancel keeps them for next time.',
    confirmLabel: 'Keep both',
  });
  if (!ok) return;
  if (await saveAsCopy(local.fields)) {
    everSaved = true; // the list underneath must refresh (a copy now exists)
    quiet(outbox.remove(d.id)); // safe in the copy — only now may the entry go
  } else {
    setStatusError('Could not save the copy — your local edits are kept');
  }
}

function applyFields(f: Record<string, string>) {
  titleField.value = f.title ?? '';
  editor.commands.setContent(f.body ?? '', { emitUpdate: false });
  excerptField.value = f.excerpt ?? '';
  if (f.subjects !== undefined) setSubjects(f.subjects);
  if (f.slug) {
    slugField.value = f.slug;
    slugTouched = true;
  }
  if (f.occurred_at) {
    dateToggle.checked = true;
    occurredField.disabled = false;
    dateAutoNote.hidden = true;
    occurredField.value = f.occurred_at;
  }
}

async function openEdit(id: string, fromHash = false) {
  settling = id; // set before any await — a racing drain must skip this id
  let loaded: Loaded | null = null;
  let loadError: unknown = null;
  try {
    const { data, error } = await actions.fragments.get({ id });
    if (error || !data || data.type !== 'writing') loadError = error ?? null;
    else loaded = data as Loaded;
  } catch (e) {
    loadError = e; // offline — existing pieces need the network to load (for now)
  }
  if (!loaded) {
    settling = null;
    // open an inert shell with the error visible — nothing here can save
    populate(null);
    loadFailed = true;
    jsError.textContent = loadError ? formatActionError(loadError) : 'That piece could not be loaded.';
    jsError.hidden = false;
    openSheet('', fromHash);
    return;
  }
  populate(loaded);
  openSheet(`#edit=${id}`, fromHash);
  try {
    await offerLocalEntry(loaded);
  } finally {
    settling = null;
  }
}

// ---- closing (every exit funnels through here) ----
function closeNow() {
  dirty = false;
  localDirty = false;
  releaseEditLock();
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
      await outbox.remove(idField.value); // discarding = the snapshot goes too
    } else {
      // drafts: make the words safe locally, then try the network once.
      clearTimeout(timer);
      await writeLocal();
      const ok = await save(savedStatus, { silentEmpty: true });
      // Locally safe is safe enough to close — the outbox drains later.
      if (!ok && hasContent() && localDirty) return; // only truly-unsaved words block
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
  await outbox.remove(idField.value); // discarding = the snapshot goes too
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
    error = e; // offline — trash is an online action, keep the piece
  }
  deleteBtn.disabled = false;
  if (error) return setStatusError(formatActionError(error));
  quiet(outbox.remove(idField.value)); // don't resurrect what was just trashed
  dirty = false;
  localDirty = false;
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

// Startup drain LAST: a deep-linked openEdit above has already set `settling`
// synchronously, so the drain cannot clobber a crash-recovery entry that the
// restore flow is about to offer.
void drainOutbox(); // yesterday's flight lands now
