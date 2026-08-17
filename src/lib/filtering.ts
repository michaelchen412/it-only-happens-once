/**
 * When a list grows a filter field.
 *
 * ⚠ THIS NUMBER HAD FOUR OWNERS (plan 42 · §4.B.1). `ConstellationPicker`,
 * `SharedByField`, `EventSheet` and `TagSheet` each declared
 * `const FILTER_THRESHOLD = 8`, and two of them had copied the same one-line
 * comment along with it. Plan 29's rule is one owner per fact; a threshold is a
 * fact.
 *
 * ⚠ AND IT LIVES IN `lib/` RATHER THAN `lib/hq/`, deliberately. Three of the
 * four consumers are HQ sheets and the fourth — `ConstellationPicker` — is
 * corpus-side. The corpus must not import from HQ's folder to learn a UI
 * threshold: `docs/admin.md` §1 keeps those two halves as one building with a
 * shared vocabulary, and a one-way dependency between them would be the first.
 */

/**
 * Above this many rows, a picker inside a sheet grows a filter field.
 *
 * Below it a filter is just another control: eight names is a glance, and a box
 * that says "this list is too long to read" over six of them is furniture that
 * makes the sheet look busier than the decision is.
 *
 * ⚠ THE ROSTER USES A DIFFERENT NUMBER AND THAT IS A DECISION, NOT DRIFT —
 * `SEARCH_APPEARS_ABOVE` in `lib/hq/people.ts` is **6**, with its own reasoning:
 * *"A search field over four faces is furniture… the roster's whole ceiling is
 * 50, so search is a convenience and never the way in."* The two guard genuinely
 * different things. This one guards a **name list inside a sheet**, scanned
 * while you are mid-decision on something else. That one guards a **page of
 * cards with faces**, which is scanned by looking rather than by reading, so it
 * tolerates fewer rows before a box helps.
 *
 * ⚠ If you are about to unify them: the numbers being close is not the argument.
 * Say which of the two containers changed first.
 */
export const FILTER_THRESHOLD = 8;
