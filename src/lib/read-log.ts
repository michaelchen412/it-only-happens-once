// The read path's one log line (plan 43 §4).
//
// Plan 41 gave the WRITE path its seam: `fail()` in actions/_shared.ts logs
// every 5xx-class refusal — 144 call sites covered by one function — because
// "a broken query looked from the server exactly like a quiet afternoon." The
// public READ path had the same disease and no seam at all: every query
// destructures `{ data }` and degrades to an empty state (`?? []`). That
// rendering is RIGHT — an outage shows a reader "The sky is being composed."
// rather than a 500 — but the silence around it was wrong: not one of those
// failures wrote a line anywhere, so a Supabase outage was invisible from
// Vercel's logs on exactly the routes strangers visit.
//
// ⚠ THE HELPER RETURNS THE RESPONSE UNCHANGED, and that is the design. Call
// sites keep their own `{ data }` / `{ data, count }` destructures, so adding
// coverage is one `.then(noted('…'))` per query and removing it is the same
// diff reversed. The alternative — a wrapper that unwraps to `data` — would
// have retyped every call site and dropped `count` on the two that paginate.
//
// `.maybeSingle()` with no row resolves `data: null, error: null` — a miss,
// not a failure — so a stranger's typo'd slug never logs. Only errors speak.

import type { PostgrestError } from '@supabase/supabase-js';

/** Tag a PostgREST response with a location, log its error if it carried one,
 *  and hand it back untouched: `await query.then(noted('blog: writing'))`. */
export function noted(where: string) {
  return <R extends { error: PostgrestError | null }>(res: R): R => {
    if (res.error) console.error(`[read] ${where} — ${res.error.code}: ${res.error.message}`);
    return res;
  };
}

/**
 * The same log line, for a read that has no honest way to degrade — it THROWS
 * rather than handing the failure back (2026-08-27).
 *
 * ⚠ IT EXISTS BECAUSE A LIST AND A SINGLE ITEM DEGRADE DIFFERENTLY, and the
 * note at the top of this file only ever reasoned about the first. A feed that
 * loses its query renders "nothing here yet", which is a poor answer offered
 * honestly. A PERMALINK that loses its query renders a **404** — and that is
 * not a degraded answer, it is a confident wrong one: it tells the reader, and
 * every crawler behind them, that a published essay does not exist. `/{slug}`
 * did something quieter and no better, redirecting to the sky as though the
 * constellation had been a typo.
 *
 * So these reads answer with a 5xx instead. `500.astro` is DB-free,
 * session-free, sends `no-store`, and says the true thing — *"it's usually a
 * passing thing — trying again in a moment tends to clear it."* A 500 a
 * crawler retries costs nothing; a 404 it believes costs the page.
 *
 * ⚠ THROWING, RATHER THAN RETURNING SOMETHING THE CALLER MUST CHECK, IS THE
 * POINT. A returned `failed` flag is a flag a future route can forget to read,
 * and forgetting it restores exactly this bug — silently, in a render that
 * looks fine. There is nothing to remember here.
 *
 * ⚠ ONLY FOR THE READ THE PAGE IS ABOUT. A quote's neighbourhood, an essay's
 * related strip, the counts beside an attribution — those are furniture, and
 * they keep `noted()`: losing them costs a section, not the page. Reach for
 * this only where the alternative is lying about what exists.
 *
 * A miss is still not a failure: `.maybeSingle()` with no row resolves
 * `data: null, error: null` and passes straight through, so a stranger's
 * typo'd slug reaches the 404 it deserves.
 */
export function required(where: string) {
  return <R extends { error: PostgrestError | null }>(res: R): R => {
    if (res.error) {
      console.error(`[read] ${where} — ${res.error.code}: ${res.error.message}`);
      throw new Error(`read failed (${where}): ${res.error.code} ${res.error.message}`);
    }
    return res;
  };
}
