/**
 * The vocabulary of feelings — the words a song is filed under (plan 33 §1).
 *
 * Pure helpers only, so the two rules that are easy to get subtly wrong can be
 * tested without a database: where a newly-added word lands in the spectrum,
 * and what a refusal says when a name or a slug is already taken.
 *
 * ⚠ A FEELING IS NOT A SUBJECT. A subject is what a piece is *about*; a feeling
 * is what a song *does to you*. Same register, opposite direction — which is why
 * these live in their own table, and why nothing in this file is shared with
 * `subjects`. The argument is in full at
 * `supabase/migrations/20260811154707_feelings_are_not_subjects.sql`.
 */

/**
 * The gap between two adjacent words in the spectrum.
 *
 * Not 1, so a word discovered while a track is playing can land BETWEEN two
 * existing ones without renumbering the rest — plan 33 §6a is explicit that the
 * moment adding a word requires housekeeping is the moment it stops happening
 * mid-listen, and it would stop happening on exactly the songs that matter most.
 */
export const SORT_STEP = 10;

/**
 * Where a newly-added word goes: the end.
 *
 * ⚠ THE END IS THE WRONG PLACE, AND THAT IS THE POINT. The field is ordered
 * dark → light, so appending puts every new word at the bright end regardless of
 * what it means — `desolate` would land past `ecstatic`. There is no way to
 * infer the right position (a word's place on that spectrum is a judgement, and
 * plan 33's ruling 1 forbids guessing at feelings on Michael's behalf), so the
 * honest behaviour is to put it somewhere visibly provisional and let the
 * Library place it.
 *
 * The alternative that lost was alphabetical insertion, which looks tidier and
 * is worse: it hides the new word in the middle of the spectrum, where a wrong
 * position reads as a considered one.
 */
export function nextSort(existing: number[]): number {
  if (!existing.length) return SORT_STEP;
  return Math.max(...existing) + SORT_STEP;
}

/** Two words that differ only in case are the same word (ruling 6). */
export function duplicateNameMessage(name: string): string {
  return `There is already a feeling called ${name.trim()}.`;
}

/**
 * ⚠ THE COLLISION NAME-UNIQUENESS CANNOT CATCH, and it is a real one.
 *
 * A feeling's name is renameable and its slug is frozen (ruling 6), so a
 * renamed feeling still OWNS its old slug. Rename `regretful` → `remorseful`,
 * and nothing is *named* `regretful` any more — so a brand-new `regretful`
 * passes the name check and then collides on a slug that is not visible
 * anywhere in the interface.
 *
 * ⚠ DO NOT "FIX" THIS BY SUFFIXING TO `regretful-2`, which is what
 * `uniqueSlug` would do and what every other vocabulary here does. Those slugs
 * are addresses for rows; this one is a word in a shared spectrum, and a silent
 * twin would be a second invisible shelf with the same name on the front — the
 * exact drift §1 says kills a taxonomy, arriving through the door built to
 * prevent it. The refusal names both halves — the invisible link and the row
 * still holding it — because "that name is taken" would be a lie about a name
 * nothing is using.
 */
export function slugTakenMessage(owner: string, slug: string): string {
  return `That word wants the link “${slug}”, which ${owner} still owns from before it was renamed. Merge into it, or choose another word.`;
}
