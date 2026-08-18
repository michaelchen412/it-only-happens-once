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
