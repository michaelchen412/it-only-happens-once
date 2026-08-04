// The Versions tab of the WritingSheet (plan 07, docs/admin.md §5).
//
// Kept out of writing-sheet.ts for the same reason constellation-picker.ts is:
// the sheet is already the file every editor feature touches, and this is a
// self-contained panel with one job — show what versions exist, let one become
// canonical, let one be thrown away.
//
// It renders the markdown SOURCE for previews rather than rendered HTML. That
// is deliberate: renderMarkdown is a server module (marked + sanitize-html),
// and shipping a second sanitizer to the client to preview your own prose
// would be a real cost for a cosmetic gain. Source is unambiguous, and the
// question this panel answers is "is this the version I meant", not "how will
// it look" — the piece itself is one promote away from showing you that.
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';
import { confirmDialog } from './confirm-dialog';

interface VersionItem {
  id: string;
  kind: string;
  label: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  matchesCanonical: boolean;
}

export interface VersionsPanelHandle {
  /** Point the panel at a piece. Null (or a draft) empties it. */
  setFragment(id: string | null, hasVersions: boolean): void;
  refresh(): Promise<void>;
  /** How many versions the last refresh found — drives the tab's count. */
  count(): number;
  /** True if a working version exists: the "your edits are held" signal. */
  hasWorking(): boolean;
}

interface Options {
  listEl: HTMLElement;
  errorEl: HTMLElement;
  countEl: HTMLElement;
  /** A version became canonical — the sheet must reload from the server. */
  onPromoted(): void;
  /**
   * Put a version's words back in the editor — the way out of the cul-de-sac
   * this panel used to be. Reading a version told you what you'd written;
   * promoting it published immediately. There was no "and now keep working on
   * it" short of copy-paste out of the preview.
   *
   * `fromWorking` distinguishes resuming the pending rewrite (the crash case —
   * same words, nothing at risk) from starting out of a kept variant, which
   * REPLACES the pending rewrite once the autosave fires. The sheet decides
   * what to prompt: it's the side that knows whether the editor is dirty.
   */
  onResume(words: { title: string; excerpt: string; body: string }, fromWorking: boolean): Promise<void>;
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ` ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function wireVersionsPanel(opts: Options): VersionsPanelHandle {
  const { listEl, errorEl, countEl } = opts;
  let fragmentId: string | null = null;
  let items: VersionItem[] = [];
  let openPreview: string | null = null;

  const showError = (m: string) => ((errorEl.textContent = m), (errorEl.hidden = false));
  const clearError = () => (errorEl.hidden = true);

  function render() {
    countEl.textContent = items.length ? String(items.length) : '';
    if (!items.length) {
      listEl.innerHTML =
        '<li class="rounded-box border border-dashed border-base-300 px-4 py-6 text-center text-sm text-base-content/50">' +
        'No other versions. Edit this piece and your changes are held here until you promote them.</li>';
      return;
    }
    listEl.innerHTML = items
      .map((v) => {
        const working = v.kind === 'working';
        const heading = working ? 'Unsaved rewrite' : v.label || 'Kept version';
        // A version identical to the live piece can't be promoted into anything.
        const promotable = !v.matchesCanonical;
        return `
          <li class="rounded-box border border-base-300 p-3" data-ver="${v.id}">
            <div class="flex items-baseline gap-2">
              <span class="admin-chip ${working ? 'admin-chip--on' : 'admin-chip--off'}">${working ? 'working' : 'kept'}</span>
              <span class="font-sans text-sm">${escapeHtml(heading)}</span>
              <span class="ml-auto font-sans text-xs text-base-content/45">${when(working ? v.updatedAt : v.createdAt)}</span>
            </div>
            ${v.title ? `<p class="mt-1.5 truncate font-display text-base">${escapeHtml(v.title)}</p>` : ''}
            <p class="mt-1 line-clamp-2 text-sm text-base-content/60">${escapeHtml(v.preview) || '<em>empty</em>'}</p>
            ${v.matchesCanonical ? '<p class="admin-hint mt-1.5">Identical to what’s live.</p>' : ''}
            <div class="mt-2.5 flex flex-wrap items-center gap-1">
              <button type="button" class="btn btn-ghost btn-xs normal-case" data-act="preview">${openPreview === v.id ? 'Hide' : 'Read'}</button>
              <button type="button" class="btn btn-ghost btn-xs normal-case" data-act="resume">${working ? 'Resume editing' : 'Edit from this'}</button>
              <button type="button" class="btn btn-xs normal-case ${promotable ? 'btn-primary' : 'btn-ghost'}" data-act="promote" ${promotable ? '' : 'disabled'}>Make this the piece</button>
              ${working ? '<button type="button" class="btn btn-ghost btn-xs normal-case" data-act="keep">Keep as a variant</button>' : ''}
              <button type="button" class="btn btn-ghost btn-xs normal-case text-error" data-act="remove">Delete</button>
            </div>
            ${
              openPreview === v.id
                ? '<pre class="reading mt-3 max-h-96 overflow-y-auto rounded-box bg-base-200 p-3 text-sm whitespace-pre-wrap" data-body>Loading…</pre>'
                : ''
            }
          </li>`;
      })
      .join('');
    if (openPreview) void loadPreview(openPreview);
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }

  async function loadPreview(id: string) {
    const pre = listEl.querySelector<HTMLElement>(`[data-ver="${id}"] [data-body]`);
    if (!pre) return;
    try {
      const { data, error } = await actions.versions.get({ id });
      if (error) return void (pre.textContent = formatActionError(error));
      pre.textContent = data.body || '(this version is empty)';
    } catch (e) {
      pre.textContent = formatActionError(e);
    }
  }

  async function refresh() {
    if (!fragmentId) {
      items = [];
      render();
      return;
    }
    try {
      const { data, error } = await actions.versions.list({ fragment_id: fragmentId });
      if (error) {
        showError(formatActionError(error));
        return;
      }
      clearError();
      items = data.versions;
      // A preview whose version was promoted or deleted must not linger.
      if (openPreview && !items.some((v) => v.id === openPreview)) openPreview = null;
      render();
    } catch (e) {
      showError(formatActionError(e));
    }
  }

  listEl.addEventListener('click', async (e) => {
    const btn = (e.target as Element)?.closest?.('[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    const id = btn.closest<HTMLElement>('[data-ver]')?.dataset.ver;
    if (!id) return;
    const act = btn.dataset.act;
    clearError();

    if (act === 'preview') {
      openPreview = openPreview === id ? null : id;
      render();
      return;
    }

    if (act === 'resume') {
      // Fetched here rather than in the sheet so the sheet never has to know
      // this action exists — the same reason `preview` lives here.
      btn.disabled = true;
      try {
        const { data, error } = await actions.versions.get({ id });
        if (error) showError(formatActionError(error));
        else
          await opts.onResume({ title: data.title, excerpt: data.excerpt, body: data.body }, data.kind === 'working');
      } catch (err) {
        showError(formatActionError(err));
      }
      // Unconditional: the sheet may have declined, and the button has to work
      // again either way. A successful resume switches tabs, so this is unseen.
      btn.disabled = false;
      return;
    }

    if (act === 'promote') {
      const ok = await confirmDialog({
        title: 'Make this the piece',
        message:
          'This replaces what readers see right now. The current text is kept as a version, so nothing is lost — you can put it back.',
        confirmLabel: 'Promote',
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        const { error } = await actions.versions.promote(formOf({ id }));
        if (error) {
          btn.disabled = false;
          return showError(formatActionError(error));
        }
      } catch (err) {
        btn.disabled = false;
        return showError(formatActionError(err));
      }
      opts.onPromoted();
      return;
    }

    if (act === 'keep') {
      btn.disabled = true;
      try {
        const { error } = await actions.versions.keep(formOf({ fragment_id: fragmentId! }));
        if (error) showError(formatActionError(error));
      } catch (err) {
        showError(formatActionError(err));
      }
      await refresh();
      return;
    }

    if (act === 'remove') {
      const working = items.find((v) => v.id === id)?.kind === 'working';
      const ok = await confirmDialog({
        title: 'Delete this version',
        message: working
          ? 'Throw away this rewrite? The published piece is unaffected, but these edits are gone.'
          : 'Throw away this kept version? The published piece is unaffected.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        const { error } = await actions.versions.remove(formOf({ id }));
        if (error) showError(formatActionError(error));
      } catch (err) {
        showError(formatActionError(err));
      }
      await refresh();
    }
  });

  function formOf(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  return {
    setFragment(id, hasVersions) {
      fragmentId = id;
      openPreview = null;
      items = [];
      clearError();
      countEl.textContent = '';
      if (id && hasVersions) void refresh();
      else render();
    },
    refresh,
    count: () => items.length,
    hasWorking: () => items.some((v) => v.kind === 'working'),
  };
}
