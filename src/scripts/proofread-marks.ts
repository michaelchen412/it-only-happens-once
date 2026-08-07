// The marks (docs/plans/22 · Piece 4): a ProseMirror decoration plugin, and
// deliberately NOT document edits.
//
// ⚠ DECORATIONS, CATEGORICALLY, NEVER DOCUMENT STEPS. Four reasons, and the
// first one alone settles it:
//
//  1. A draft autosaves 1.2s after you stop typing. If a mark were a document
//     change, pressing Proofread would dirty the piece and arm that timer —
//     three marks, three saves, for a highlight.
//  2. `getMarkdown()` stays clean, so `#ws-body-field` and everything
//     downstream never sees them.
//  3. Undo history is untouched. A mark is not a step you can ⌘Z through, which
//     matters because ⌘Z is how you take back a Fix it.
//  4. They map through transactions for free, so they stay glued to their word
//     while you type above them.
//
// The rejected alternative was applying fixes through `setContent`, which
// flattens undo history — and having flattened it, needs to grow its own undo
// affordance to give back what it took. Fix it is a normal document step, so ⌘Z
// already works and no such control exists.
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { countInDoc, locate, readsAs } from './proofread-locate';

export interface PendingFix {
  before: string;
  after: string;
}

/** A fix that has been placed, with the id its `<span>` carries. */
export interface PlacedFix extends PendingFix {
  id: string;
}

type Action = { type: 'place'; decos: Decoration[] } | { type: 'clear' } | { type: 'drop'; id: string };

const key = new PluginKey<DecorationSet>('proofreadMarks');

/**
 * The attribute a click is resolved through. Same delegation the image alt
 * handler already uses in `rich-editor.ts` — one listener on the editable
 * surface, `closest()` to find which one was hit — rather than binding to spans
 * that a transaction can recreate underneath the listener.
 */
export const MARK_ATTR = 'data-pf';

export const ProofreadMarks = Extension.create({
  name: 'proofreadMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const action = tr.getMeta(key) as Action | undefined;
            if (action?.type === 'clear') return DecorationSet.empty;
            if (action?.type === 'place') return DecorationSet.create(tr.doc, action.decos);

            let next = set.map(tr.mapping, tr.doc);
            if (action?.type === 'drop') {
              next = next.remove(next.find().filter((d) => d.spec.id === action.id));
            }
            if (!tr.docChanged) return next;

            // THE STALENESS RULE. Edit the text under a mark and the mark goes:
            // it is pointing at words that no longer exist, and an underline on
            // the wrong word is worse than no underline at all. Mapping alone
            // keeps the range alive through the edit, which is precisely the
            // case this has to catch.
            const stale = next.find().filter((d) => !readsAs(tr.doc, { from: d.from, to: d.to }, d.spec.before));
            return stale.length ? next.remove(stale) : next;
          },
        },
        props: {
          decorations: (state) => key.getState(state) ?? DecorationSet.empty,
        },
      }),
    ];
  },
});

export interface ProofreadHandle {
  /** Place marks for the fixes still findable. Returns how many landed. */
  place(fixes: PendingFix[]): number;
  /** Drop every mark — a stale mark must not outlive the piece it was read on. */
  clear(): void;
  /** Drop one, by the id its span carries. */
  dismiss(id: string): void;
  /** The fix behind a span, or null once it has gone stale. */
  at(id: string): PlacedFix | null;
  /** Replace it in place. A normal document step, so ⌘Z takes it back. */
  apply(id: string): boolean;
  /** How many marks are live right now. */
  count(): number;
}

let seq = 0;

export function proofreadHandle(editor: Editor): ProofreadHandle {
  const decos = () => key.getState(editor.state)?.find() ?? [];
  const byId = (id: string) => decos().find((d) => d.spec.id === id) ?? null;

  return {
    place(fixes) {
      const made: Decoration[] = [];
      for (const fix of fixes) {
        // ⚠ THE EXACT-ONCE CHECK RUNS AGAIN, HERE. The server verified against
        // the text as SENT; this call takes ~2s and autosave fires every 1.2s,
        // so by now the live document can hold zero or two occurrences of a
        // string that had exactly one. Silently drop what no longer matches —
        // there is no user-facing story that makes "stale" legible, and a mark
        // on the wrong word costs more than a missing mark.
        if (countInDoc(editor.state.doc, fix.before) !== 1) continue;
        const range = locate(editor.state.doc, fix.before);
        if (!range) continue;
        const id = `pf${(seq += 1)}`;
        made.push(
          Decoration.inline(
            range.from,
            range.to,
            { class: 'pf-mark', [MARK_ATTR]: id },
            { id, before: fix.before, after: fix.after },
          ),
        );
      }
      editor.view.dispatch(editor.state.tr.setMeta(key, { type: 'place', decos: made } satisfies Action));
      return made.length;
    },

    clear() {
      if (!decos().length) return;
      editor.view.dispatch(editor.state.tr.setMeta(key, { type: 'clear' } satisfies Action));
    },

    dismiss(id) {
      editor.view.dispatch(editor.state.tr.setMeta(key, { type: 'drop', id } satisfies Action));
    },

    at(id) {
      const d = byId(id);
      return d ? { id, before: d.spec.before, after: d.spec.after } : null;
    },

    apply(id) {
      const d = byId(id);
      if (!d) return false;
      // ⚠ `insertText`, NOT `insertContentAt`. The editor has the Markdown
      // extension configured with `transformPastedText`, and a content-level
      // insert can put the replacement through a parser — so an `after`
      // containing `_`, `*`, `#` or a backtick would be mangled into formatting.
      // `insertText` cannot do that.
      //
      // It takes its marks from `marksAcross(from, to)`, which is why Piece 1's
      // prompt asks for the SHORTEST unique span: a span that starts inside bold
      // and ends outside it comes back unformatted.
      const tr = editor.state.tr;
      tr.insertText(d.spec.after, d.from, d.to);
      tr.setMeta(key, { type: 'drop', id } satisfies Action);
      editor.view.dispatch(tr);
      editor.commands.focus();
      return true;
    },

    count: () => decos().length,
  };
}
