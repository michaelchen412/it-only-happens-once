// The "Suggest with AI" flow, for a quote or a piece of writing (docs/plans/02).
//
// The kind is interpolated into the system prompt and used nowhere else —
// there are no per-kind branches on the server and never were. This is the UI,
// written once, so the call sites can't drift apart.
//
// ⚠ THERE WERE THREE KINDS AND THERE ARE NOW TWO (ADR 0031). A song has no
// subjects: a subject is what a piece is ABOUT, and a song is not about
// anything you can paraphrase — the one time this corpus filed one that way it
// produced `jazz`, a genre alone in a taxonomy of words about living. What a
// song does to you is a FEELING, and a feeling is not a property of the song at
// all; it is what happened in Michael, which no model has access to. So there
// is no `suggestFeelings` anywhere, and **no part of a song is
// machine-taggable.** That is a cleaner line than the one it replaced.
//
// THE HUMAN STAYS IN THE LOOP BY CONSTRUCTION, which is the whole design:
// existing subjects are MERGED into the tag field rather than replacing what
// you put there, and a proposed *new* subject is only ever offered — it becomes
// real only if it's still in the field when you save. Nothing here writes to
// the database.
import { actions } from 'astro:actions';
import { formatActionError } from './action-error';

/** The text to tag — or the sentence explaining why there isn't any yet. */
export type Gathered = { text: string } | { missing: string };

export interface SubjectSuggestOptions {
  /** The element rendered by SubjectsField.astro. */
  root: HTMLElement;
  kind: 'quote' | 'writing';
  /** What to send. Each type is incomplete in its own way — see the callers. */
  gather(): Gathered;
  readTags(): string[];
  writeTags(tags: string[]): void;
  /** A run is starting — clear whatever error is on screen from the last one. */
  onStart?(): void;
  onError(message: string): void;
}

export interface SubjectSuggestHandle {
  /** Drop a stale proposal — call when an editor opens on a different row. */
  reset(): void;
}

const IDLE = 'Suggest with AI';

export function wireSubjectSuggest(opts: SubjectSuggestOptions): SubjectSuggestHandle {
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => opts.root.querySelector<T>(sel)!;
  const btn = q<HTMLButtonElement>('[data-ai-run]');
  const label = q('[data-ai-label]');
  const box = q('[data-ai-proposed]');
  const name = q('[data-ai-name]');
  const def = q('[data-ai-def]');
  const add = q<HTMLButtonElement>('[data-ai-add]');

  /**
   * Add, never replace. Case-insensitive, matching TagInput's own duplicate
   * rule — otherwise accepting a suggestion you already typed in a different
   * case would leave the same subject in the field twice.
   */
  const merge = (extra: string[]) => {
    const have = opts.readTags();
    const seen = new Set(have.map((t) => t.toLowerCase()));
    opts.writeTags([...have, ...extra.filter((t) => !seen.has(t.toLowerCase()))]);
  };

  btn.addEventListener('click', async () => {
    const gathered = opts.gather();
    if ('missing' in gathered) return opts.onError(gathered.missing);

    opts.onStart?.();
    box.hidden = true;
    btn.disabled = true;
    label.textContent = 'Thinking…';
    try {
      const { data, error } = await actions.fragments.suggestSubjects({ text: gathered.text, kind: opts.kind });
      if (error || !data) return opts.onError(error ? formatActionError(error) : 'No suggestions came back.');
      merge(data.existing);
      if (data.proposed) {
        name.textContent = data.proposed.name;
        def.textContent = data.proposed.definition;
        add.onclick = () => {
          merge([data.proposed!.name]);
          box.hidden = true;
        };
        box.hidden = false;
      }
    } catch (e) {
      // astro:actions THROWS on a dead network rather than returning { error },
      // so this needs a catch as well as a check. The quote-only version had no
      // catch: offline, the button stuck on "Thinking…" for the life of the page.
      opts.onError(formatActionError(e));
    } finally {
      btn.disabled = false;
      label.textContent = IDLE;
    }
  });

  q('[data-ai-dismiss]').addEventListener('click', () => (box.hidden = true));

  return { reset: () => (box.hidden = true) };
}
