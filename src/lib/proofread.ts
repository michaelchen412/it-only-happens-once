// Proofreading a piece of writing (server-only). Given a title and a body as
// PLAIN TEXT, ask Claude for outright mistakes — typos, dropped words, agreement,
// punctuation, doubled words — and nothing else. Structured output
// (zodOutputFormat) guarantees the shape; the `kind` enum is what makes
// "definitely not stylistic" structural rather than a plea in the prompt.
// Never imported client-side (it holds the API key path).
//
// SIBLING, NOT REPLACEMENT: `suggest-subjects.ts` is the other tenant of
// ANTHROPIC_API_KEY (docs/plans/02) and is untouched by this. The two were
// deliberately NOT merged into one call. The saving would have been about ten
// cents across the whole corpus, and sharing would have cost the thing that
// makes this feature possible: the subject call sends `getMarkdown()`, so every
// `before` would come back carrying `**` that does not exist as characters in
// the ProseMirror document, and every position would be wrong. This call sends
// plain text so the model's output and the document's contents are the same
// alphabet. See docs/plans/22 §1.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'astro/zod';

/**
 * Which field a fix was found in. The body gets an in-editor mark; the title
 * cannot (an `<input>` holds no decoration) and is reported in the status chip
 * instead. Concatenating the two before sending would make this unrecoverable,
 * which is why the action takes two fields rather than one string.
 */
export type Where = 'title' | 'body';

export interface Fix {
  where: Where;
  /** Verbatim from the text sent, and the SHORTEST span that is unique. */
  before: string;
  after: string;
  kind: 'typo' | 'missing-word' | 'agreement' | 'punctuation' | 'repeated-word';
}

/**
 * ONE CONSTANT, ON PURPOSE (docs/plans/22 · Q1). Precision is this feature's
 * entire product and Haiku is the weakest current model — but cost cannot pick
 * for us either: a run is ~$0.003 here and ~$0.016 on Opus 5, which across every
 * piece on the site is pennies per year. So the id is swappable in one place and
 * the decision is made by reading the output on three real essays, not by the
 * invoice.
 */
const MODEL = 'claude-haiku-4-5';

/**
 * Sized for this call, NOT copied from suggestSubjects' 400 — that budget was
 * for at most three tag names. See the `stop_reason` guard below for why the
 * number matters more than it looks.
 */
const MAX_TOKENS = 1500;

const SYSTEM =
  `You proofread a finished piece of personal writing for OUTRIGHT MISTAKES ONLY.\n\n` +
  `Report only errors the author would agree are errors the moment they saw them: ` +
  `misspellings and typing slips, a missing or duplicated word, subject-verb or ` +
  `number disagreement, and punctuation that is plainly wrong.\n\n` +
  `DO NOT report anything stylistic. Not word choice, not sentence length, not ` +
  `clarity, not tone, not repetition used for effect, not comma preferences, not ` +
  `sentence fragments, not starting a sentence with "And" or "But". This is ` +
  `deliberate writing by someone who knows the rules. If a suggestion does not ` +
  `fit one of the five categories, it is not a suggestion — leave it alone. ` +
  `Returning nothing is a normal and correct answer.\n\n` +
  `For each fix, "before" must be copied VERBATIM from the text and must be the ` +
  `SHORTEST span that appears exactly once in that field. Include a word or two ` +
  `of surrounding context only when the misspelling alone would be ambiguous, ` +
  `and never span a sentence boundary or a line break. "after" is that same span ` +
  `corrected, and nothing else.`;

const Proofread = z.object({
  fixes: z
    .array(
      z.object({
        where: z.enum(['title', 'body']).describe('Which field this fix was found in.'),
        before: z.string().describe('Verbatim from that field; the shortest span that is unique.'),
        after: z.string().describe('That span, corrected.'),
        // THE ENUM IS A GUARDRAIL, NOT A DISPLAY FIELD. It is never rendered.
        // Its job is structural: a suggestion that wants to improve the phrasing
        // has no box to put itself in, which is a harder "no" than a sentence in
        // the prompt asking nicely.
        kind: z.enum(['typo', 'missing-word', 'agreement', 'punctuation', 'repeated-word']),
      }),
    )
    .describe('Outright mistakes only. An empty array is the expected result for a finished piece.'),
});

/**
 * The answer did not complete. Its own class so the action can tell it apart
 * from a dead network — they are both "no fixes came back", and they need
 * completely different sentences: one means try again, the other means the
 * model never answered. Reporting either as the other is the mistake this whole
 * guard exists to prevent.
 */
export class IncompleteProofread extends Error {}

/** Non-overlapping occurrences of a literal. */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

/**
 * THE EXACT-ONCE GATE. Drop any fix whose `before` does not appear exactly once
 * in the field it claims to be from. Five lines doing two jobs: a hallucinated
 * quote dies here, and every surviving fix is unambiguous to locate — which is
 * what lets the client turn a string into a document position at all.
 *
 * The client runs this again against the LIVE document, because the ~2s round
 * trip overlaps a 1.2s autosave debounce and the text can have moved underneath.
 * Both halves are needed: this one kills fabrications, that one kills staleness.
 */
export function keepLocatable(fixes: Fix[], title: string, body: string): Fix[] {
  return fixes.filter((f) => {
    if (!f.before || f.before === f.after) return false; // a no-op is noise
    return occurrences(f.where === 'title' ? title : body, f.before) === 1;
  });
}

export async function proofread(title: string, body: string, apiKey: string): Promise<{ fixes: Fix[] }> {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    // Labelled rather than concatenated, so `where` has something to refer to.
    messages: [{ role: 'user', content: `TITLE:\n${title || '(untitled)'}\n\nBODY:\n${body}` }],
    output_config: { format: zodOutputFormat(Proofread) },
  });

  // ⚠ A TRUNCATED RESPONSE DOES NOT THROW — IT COMES BACK EMPTY, AND EMPTY IS
  // THE ONE ANSWER THIS FEATURE MUST NEVER FAKE. `parsed_output` is null when
  // the constrained decode does not complete, exactly as suggest-subjects.ts
  // assumes with its `?? { … }`. Copy that shape here and a piece long enough to
  // overrun MAX_TOKENS reports "Nothing caught" — a clean bill of health on the
  // essay most likely to be holding a typo. A proofreader is allowed to fail;
  // it is not allowed to claim it read something it did not finish.
  if (message.stop_reason === 'max_tokens' || !message.parsed_output) {
    throw new IncompleteProofread('The proofread came back incomplete, so nothing was checked. Try again.');
  }

  return { fixes: keepLocatable(message.parsed_output.fixes as Fix[], title, body) };
}
