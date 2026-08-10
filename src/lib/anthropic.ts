// The one place the Anthropic SDK is configured (docs/plans/30 · §5).
//
// ⚠ IT EXISTS BECAUSE THE DEFAULT IS TEN MINUTES. `@anthropic-ai/sdk` ships a
// 10-minute request timeout and 2 automatic retries, which is a sensible default
// for a batch job and completely wrong for every call in this tree: all three
// tenants of ANTHROPIC_API_KEY — ✦ Suggest with AI, Proofread, and the ✚ box's
// parser — run inside an action, behind a control somebody just pressed. Left
// alone, one hung upstream held the action, the sheet and the person for up to
// half an hour, and there was nothing on screen to say why.
//
// ⚠ AND IT IS SHARED BECAUSE THE *REASON* IS SHARED, not the number. Three
// copies of this paragraph is precisely what plans/29 is about; three different
// budgets is not, because a proofread of a whole essay and a three-tag
// suggestion are not the same wait. So the policy lives here and the budget is
// each caller's argument.
//
// SERVER ONLY, like every other module that touches the key.
import Anthropic from '@anthropic-ai/sdk';

/**
 * ⚠ ONE RETRY, NOT THE SDK'S TWO, AND THE ARITHMETIC IS THE REASON. A timeout
 * is itself retried, so the wall clock a caller can actually wait is
 * `timeoutMs × (retries + 1)` — at the SDK's default that is a number nobody
 * would choose on purpose. One retry keeps `gcal.ts`'s bargain (a single blip
 * costs a second attempt rather than the whole answer) while leaving the worst
 * case something the caller can state out loud: twice its own budget.
 */
export function anthropic(apiKey: string, timeoutMs: number): Anthropic {
  return new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
}
