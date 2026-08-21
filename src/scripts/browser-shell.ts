// The FragmentBrowser drawer's SHELL — everything both modes do identically,
// and nothing either does alone (plan 39 · §1).
//
// What lives here: fetching the fragments-panel partial into the drawer, wiring
// it, the error line, showModal/close with ADR 0032's three dismissals, and
// refreshing the rows when something on top of the drawer changes a fragment.
//
// What deliberately does NOT: the verb. `constellations.place` and `songs.pair`
// are different writes with different cardinality, different collision rules and
// different row states, and folding them into one parameterised `commit()` would
// have bought a shared function whose body is two branches all the way down.
// The callers own their verb; the drawer owns the browsing.
//
// ⚠ EVERY LOOKUP IS root.querySelector, NEVER document. /admin/fragments now
// carries a manage-mode panel AND this drawer, and a second surface could
// always mount both again — so a document-wide read of `.fb-panel`
// finds whichever came first in the DOM, which is a bug that looks like a
// caching problem.
import { wireFragmentPanel, type PanelHandle, type PanelOpts } from './fragment-panel';
import './subject-filter'; // the fetched partial's <subject-filter> needs the definition
import { onFragmentsChanged } from './fragments-changed';
import { closeWithExit, openDialog } from './dialog-close';
import { wireSheetDismiss } from './sheet-dismiss';
import { sheetError } from './sheet-error';

export interface ShellOpts {
  /** Params pinned to every panel fetch (e.g. { mode: 'pair', song: id }). */
  params: () => Record<string, string>;
  /** Panel wiring the caller owns — row clicks, per-row actions, the cart. */
  panel: Omit<PanelOpts, 'extraParams' | 'historyBase'>;
  /** After the drawer opens (and after the panel is first loaded). */
  onOpen?: () => void;
  /** After it closes — the composer refreshes its suite here. */
  onClose?: () => void;
}

export interface ShellHandle {
  root: HTMLDialogElement;
  /** null until the first open — the panel is fetched lazily. */
  panel: () => PanelHandle | null;
  open: () => void;
  close: () => void;
  showError: (m: string) => void;
  clearError: () => void;
  /** Re-fetch the rows. Safe to call when closed; it simply doesn't. */
  refresh: () => Promise<void>;
  /**
   * Throw the loaded panel away so the next open refetches from scratch.
   *
   * ⚠ THE PAIR DRAWER NEEDS THIS AND THE COMPOSER'S NEVER WILL. A composer
   * browser is opened on ONE constellation for the life of the page, so its
   * params are constant and a kept panel is always correct. The pair drawer is
   * opened on whichever song the sheet has loaded, so a panel kept across two
   * opens would mark the SECOND song's rows with the FIRST song's pairings.
   */
  reset: () => void;
  /** The header's live name (the constellation's, or the song's). */
  setName: (name: string) => void;
  setNote: (words: string) => void;
}

export function wireBrowserShell(root: HTMLDialogElement, opts: ShellOpts): ShellHandle {
  const panelHost = root.querySelector<HTMLElement>('.fb-panel')!;
  // By role, not by id (plan 38 · §3) — and scoped to this drawer, because a
  // role is not unique and /admin/fragments holds several of these elements.
  const errBox = sheetError(root)!;
  const nameEl = root.querySelector<HTMLElement>('.fb-cname');
  const noteEl = root.querySelector<HTMLElement>('.fb-cdesc');

  const showError = (m: string) => ((errBox.textContent = m), (errBox.hidden = false));
  const clearError = () => (errBox.hidden = true);

  let panel: PanelHandle | null = null;

  async function loadPanel() {
    const qs = new URLSearchParams(opts.params()).toString();
    const res = await fetch(`/admin/fragments-panel?${qs}`, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) {
      panelHost.innerHTML =
        '<p class="font-sans text-sm text-error">Couldn’t load the fragments — close and try again.</p>';
      return;
    }
    panelHost.innerHTML = await res.text();
    const panelRoot = panelHost.querySelector('.fpanel') as HTMLElement;
    panel = wireFragmentPanel(panelRoot, {
      ...opts.panel,
      extraParams: opts.params(),
      historyBase: null,
    });
  }

  const handle: ShellHandle = {
    root,
    panel: () => panel,
    open() {
      clearError();
      openDialog(root);
      if (!panel) void loadPanel();
      opts.onOpen?.();
    },
    close() {
      // ⚠ `onClose` RUNS *DURING* THE EXIT, NOT AFTER IT, and the ordering is
      // load-bearing rather than incidental. The composer's `onClose` calls
      // `notifyFragmentsChanged(root)`, whose `settled` promise is
      // `afterDialogClose(root)` — a listener for the transition `closeWithExit`
      // has just started. Awaiting the close first would hand that helper an
      // already-shut dialog with no transition left to hear, and the host's
      // refresh would sit on the 350ms fallback timer instead. Started together,
      // the fetch overlaps the slide and the swap lands the moment it ends,
      // which is the whole arrangement `fragments-changed.ts` describes.
      void closeWithExit(root);
      opts.onClose?.();
    },
    showError,
    clearError,
    async refresh() {
      if (!root.open) return;
      // ⚠ A REBUILD, NOT A REFRESH, when the target changed. `panel.refresh()`
      // re-fetches with the params captured at wire time; the pair drawer opens
      // on a different song each time, so its caller drops the panel first and
      // this reloads it against the current ones.
      if (!panel) return void loadPanel();
      await panel.refresh();
    },
    setName(name) {
      if (nameEl) nameEl.textContent = name;
    },
    setNote(words) {
      if (!noteEl) return;
      noteEl.textContent = words;
      noteEl.title = words;
      noteEl.hidden = !words;
    },
    reset() {
      panel = null;
      panelHost.innerHTML = '<p class="text-whisper font-sans text-sm">Loading fragments…</p>';
    },
  };

  // ✕, Escape and the backdrop, in one call (ADR 0032).
  //
  // ⚠ NO DISCARD GUARD, AND THAT IS THE RIGHT ANSWER FOR BOTH MODES rather
  // than an omission. This drawer holds no pending state: placing and pairing
  // both write immediately, and `close` exists to refresh what is behind it on
  // the way out, not to protect anything. Escape refreshing too is the whole
  // reason it is intercepted.
  wireSheetDismiss(root, () => handle.close(), '[data-fb-close]');

  // A fragment created from this drawer, or edited in a sheet on top of it,
  // should appear in these rows. Only while it is open — refetching a list
  // nobody is looking at is work for nothing, and the next open is fresh.
  onFragmentsChanged(({ settled }) => {
    if (!root.open) return false; // not handled — let the host underneath answer
    void settled.then(() => handle.refresh());
    return true;
  });

  return handle;
}
