// ============================================================================
// Quote provenance — three facts in, two strings out.
//
// THE SPECIFICATION IS docs/plans/17a-quote-matrix.md. Fourteen cases are
// enumerated there and every one of them is a test in src/tests/provenance.test.ts.
// If you are about to add a branch to this file, add the row to the matrix first;
// the last time this logic grew a special case it was a regex that guessed
// whether "Matthew 5:43-48" was a person's name, and it guessed wrong.
//
// The three facts:
//
//   Who    whose words these are — a person, or MICHAEL HIMSELF, or nobody known
//   From   what work they are from
//   Where  where in it: "Book 2:2", "John 3:16", "Letter 24:19–20", "p. 41"
//
// The two outputs are BOTH DERIVED. Neither is a fourth fact and neither is
// something anyone types. That is the whole point of the model: `attribution`
// used to hold the *who* on some rows and the *where* on others, depending on
// whether a who existed — so every single quote made you decide which, and
// Michael made that decision by hand seventy-six times.
//
//   line     always visible, under the quote
//   reveal   on demand, behind a subtle control — empty when there is nothing
//            behind it, because a control that opens onto nothing is worse than
//            no control
// ============================================================================

/**
 * What the reveal says for Michael's own words.
 *
 * ⚠ Deliberately NOT an `authors` row. It is the tempting simplification — it
 * would make the Who field uniform — and it is wrong: an author row gives the
 * derivation a name to lead with, and every self-authored quote would render
 * `— Michael Chen` on a site that is already his. Self-authorship is a boolean
 * on the fragment (`is_self`); `author_id` stays null.
 */
export const SELF_NAME = 'Michael Chen';

export interface Provenance {
  /** Who = Me. Silences the line; the reveal answers instead. */
  isSelf?: boolean | null;
  /** Who — the author's name. */
  who?: string | null;
  /** From — the work's title. */
  from?: string | null;
  /** Where — the locator, free text, exactly as you'd say it out loud. */
  where?: string | null;
}

export interface ProvenanceDisplay {
  /** The line under the quote. `''` means genuine silence — render nothing. */
  line: string;
  /** What the reveal opens onto. `''` means don't render the control at all. */
  reveal: string;
}

const clean = (s: string | null | undefined) => (s ?? '').trim();

/**
 * The display rule. First match wins in each block.
 *
 * ```
 * THE LINE
 *   1. Who = Me                     →  (nothing at all)
 *   2. Who = a person               →  the name
 *   3. no Who, but a Where          →  the locator
 *   4. no Who, no Where, but a From →  the work
 *   5. none of the three            →  (nothing at all)
 *
 * THE REVEAL
 *   A. Who = Me                     →  SELF_NAME
 *   B. otherwise                    →  everything the line didn't already say
 * ```
 *
 * ⚠ **The Where joins the line only when it has to** — when there is no Who to
 * lead with. That single sentence is why there is no per-quote and no
 * per-category "show the citation" toggle: the answer Michael wanted for each
 * case he named already falls out of the data. Scripture has no author, so
 * `— John 3:16` is not an exception, it is the only thing clause 3 could
 * produce. Seneca has one, so `— Seneca` leads and `Letters to Lucilius,
 * Letter 24:19–20` waits behind the reveal. A toggle would be a second source
 * of truth for a question the first one already answers, and getting the two
 * out of step is a bug you can only find by reading.
 *
 * ⚠ **No em-dash here.** The renderers own the `—`, as they do today, so the
 * string this returns stays directly comparable with the `attribution` column
 * — which is what makes the migration auditable: 74 of 76 stored values equal
 * their derived line character for character.
 */
export function deriveProvenance(p: Provenance): ProvenanceDisplay {
  const who = clean(p.who);
  const from = clean(p.from);
  const where = clean(p.where);

  if (p.isSelf) return { line: '', reveal: SELF_NAME };

  // Which fact becomes the line decides what is left for the reveal. Tracked by
  // FIELD rather than by value: a work whose title happens to equal its locator
  // must not silently delete both.
  let line = '';
  let spentFrom = false;
  let spentWhere = false;
  if (who) {
    line = who;
  } else if (where) {
    line = where;
    spentWhere = true;
  } else if (from) {
    line = from;
    spentFrom = true;
  }

  const rest = [spentFrom ? '' : from, spentWhere ? '' : where].filter(Boolean);
  return { line, reveal: rest.join(', ') };
}

/** Just the line — the common case, and what gets stored in `attribution`. */
export const provenanceLine = (p: Provenance): string => deriveProvenance(p).line;

/**
 * Fold a page number into the Where. `p. 41` is a locator like any other, and
 * the two coexist rather than competing: Michael's Seneca row carries both a
 * letter reference and a page, and choosing between them loses real information
 * (docs/plans/17a, decision 6).
 *
 * Exists for the migration and for reading legacy rows the form has not
 * rewritten yet. The form itself asks for one field and stores one field.
 */
export function mergePage(where: string | null | undefined, page: number | string | null | undefined): string {
  const w = clean(where);
  const p = clean(typeof page === 'number' ? String(page) : page);
  if (!p) return w;
  const cited = `p. ${p}`;
  return w ? `${w}, ${cited}` : cited;
}
