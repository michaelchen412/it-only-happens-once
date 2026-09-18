// A short-form editor that costs nothing until somebody opens the sheet it
// lives in (2026-09-18).
//
// ⚠ THE PROBLEM IS ONE NUMBER: `rich-editor` is **512 KB raw / 171 KB gzipped**,
// by a wide margin the largest chunk this site ships. `capture.ts` measured it
// on 2026-08-07 and moved the ✚ behind an `import()`, and its header names the
// eight rooms that were paying for an editor nobody had asked for yet.
//
// What that fix could not reach is the SHEETS. `TaskSheet`, `EventSheet` and
// `LogSheet` each mount a notes field, each imported `mountMiniEditor`
// statically, and the pile mounts all three — so /admin/notes went on fetching,
// parsing and executing TipTap on every single load, by three routes at once,
// to fill a field behind a dialog that was not open. The Agenda, Today and a
// person's profile paid the same toll. Michael, on the pile: *"a lot of these
// actions on the notes page seem to take a long time."*
//
// ⚠ WHY A FAÇADE RATHER THAN MAKING EVERY CALLER ASYNC. The obvious fix is to
// await the import in each sheet's `open()`, and it spreads: `open` becomes
// async, so its callers do, so the event handlers that dispatch to them do, and
// three sheets' worth of carefully-ordered DOM work grows an await in the
// middle of it. That is a lot of blast radius for a field that is almost always
// empty.
//
// The whole of what these sheets ask an editor is **set the document** and
// **give me the Markdown back**. Both are answerable before TipTap exists — the
// first by remembering, the second by returning what was remembered. So the
// façade is synchronous, the call sites do not move, and the import happens on
// idle like every other warm-up in this building.
//
// ⚠ WHAT THIS IS NOT: a general editor wrapper. It holds exactly the two
// methods the three sheets use. A fourth caller wanting `editor.commands`
// should reach for `mountMiniEditor` directly and pay the static import, or
// this file should grow that method deliberately — not gain an `editor` getter
// that is null half the time and lets the question spread.
import type { MiniEditorOptions, RichEditorHandle } from './rich-editor';

export interface LazyMiniEditor {
  /** Replace the document. Safe before the editor exists. */
  setContent(md: string): void;
  /**
   * The document's Markdown — the editor's once it is mounted, otherwise the
   * last thing `setContent` was given.
   *
   * ⚠ THE FALLBACK IS CORRECT, NOT A GUESS. With no editor mounted there is no
   * way for the text to have changed: nothing is editable, because the only
   * editable element is the one TipTap creates.
   */
  getMarkdown(): string;
  /**
   * Is there nothing in the document?
   *
   * ⚠ A QUESTION, NOT A `getText()`, and the difference is deliberate. Both
   * callers that used the editor's text used it for exactly this — *should Save
   * be disabled* — and exposing the text itself would be promising a faithful
   * plain-text rendering this cannot give before TipTap exists. Asking the
   * narrow question lets the unmounted answer be honestly derived from the
   * Markdown instead.
   *
   * The one inexactness is a document of pure syntax (`**`, `- `), which reads
   * as non-empty here and as empty to the editor. It resolves itself the
   * instant the editor mounts, and the only thing riding on it is whether a
   * button is grey for a moment.
   */
  isBlank(): boolean;
  /** Put the caret in the box. A no-op until the editor exists. */
  focus(where?: 'start' | 'end'): void;
  /**
   * Start the import and mount. Idempotent, and safe to call on every open.
   * Returns once the editor is live, for the rare caller that wants to know.
   */
  warm(): Promise<RichEditorHandle>;
  /**
   * Tear the editor down, if one was ever built.
   *
   * ⚠ ARRIVED WITH `<ClientRouter />` (plan 24 · §9) AND IS NOT OPTIONAL. Under
   * the router `onPage` re-runs each sheet's boot on every arrival, so a second
   * visit mounts a second editor into the new element while the first goes on
   * holding its plugins, its input hooks and a detached document. ProseMirror
   * stays reachable through its own listeners, so it is never collected — walk
   * in and out ten times and ten editors are alive.
   */
  destroy(): void;
}

export function lazyMiniEditor(opts: MiniEditorOptions): LazyMiniEditor {
  let live: RichEditorHandle | null = null;
  let booting: Promise<RichEditorHandle> | null = null;
  /** What the document should say, while there is nobody to say it to. */
  let pending = '';

  async function mount(): Promise<RichEditorHandle> {
    const { mountMiniEditor } = await import('./rich-editor');
    live = mountMiniEditor(opts);
    /*
      ⚠ THE PENDING DOCUMENT IS APPLIED ON ARRIVAL, and this is the line the
      whole façade turns on. A sheet opens, writes the row's notes into the
      field and THEN the import lands; without this the editor would mount empty
      and the note would be silently dropped — a data loss that looks exactly
      like a field that was always blank.

      `emitUpdate: false` for the reason every other `setContent` in this
      building passes it: TipTap fires `update` on a programmatic set, which
      downstream reads as the reader having typed.
    */
    if (pending) live.editor.commands.setContent(pending, { emitUpdate: false });
    return live;
  }

  return {
    setContent(md) {
      pending = md;
      live?.editor.commands.setContent(md, { emitUpdate: false });
    },
    getMarkdown() {
      return live ? live.getMarkdown() : pending;
    },
    isBlank() {
      return live ? live.editor.getText().trim().length === 0 : pending.trim().length === 0;
    },
    focus(where = 'end') {
      /*
        ⚠ NOT QUEUED, AND THAT IS THE RIGHT CALL. A focus that lands whenever an
        import happens to finish is a caret appearing in a field the reader has
        since left — or worse, a keyboard thrown up on a phone a second after
        they started reading. Focus is a claim about *now*; if the editor is not
        there yet, the honest thing is to leave the reader alone.
      */
      live?.editor.commands.focus(where);
    },
    warm() {
      return (booting ??= mount());
    },
    destroy() {
      live?.editor.destroy();
      live = null;
      booting = null;
      // `pending` is deliberately kept: it is the document, not the editor, and
      // a boot that sets content before warming must still find it afterwards.
    },
  };
}

/**
 * Warm a set of editors once the page has finished the work that matters.
 *
 * ⚠ `requestIdleCallback` IS STILL MISSING ON SAFARI VERSIONS MICHAEL ACTUALLY
 * USES, and a silently-absent warm-up would move the whole parse back onto the
 * first sheet opening — which is precisely the trade this refuses. The timeout
 * fallback is the same one `capture.ts` carries, with the same number.
 */
export function warmOnIdle(...editors: LazyMiniEditor[]): void {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
  idle(() => {
    for (const e of editors) void e.warm();
  });
}
