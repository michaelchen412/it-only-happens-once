// Reading a jot that the ✚ sent to another room — plan 45 · Piece 2.
//
// The capture dialog's tab row declares a destination and then navigates,
// carrying `?from=<jot id>` and nothing else. Three rooms answer that arrival —
// the corpus room for a quote, the tasks room and the calendar for the agenda —
// and every one of them needs the same two lines with the same guard on them.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

type DB = SupabaseClient<Database>;

export interface JotSeed {
  id: string;
  body: string;
}

/**
 * The jot named by `?from=`, or null.
 *
 * ⚠ THE BODY IS FETCHED HERE RATHER THAN CARRIED IN THE URL. A jot is Markdown
 * of any length with newlines in it: through a query string that means length
 * limits, escaping, and the words showing up in browser history and in any log
 * that records a path. Only the id travels.
 *
 * ⚠ `status = 'note'` IS A GUARD, NOT A FILTER, and it is the reason this is one
 * function rather than three copies. Without it a hand-typed `from=` would seed
 * a sheet from a published essay — and then consume it on save. The rooms that
 * answer this arrival all destroy what they read; the rule about what they may
 * read has to have one owner (29).
 *
 * An empty body returns null too: there is nothing to open a sheet on, and a
 * sheet that arrives blank is indistinguishable from a broken link.
 */
export async function jotSeed(sb: DB, url: URL): Promise<JotSeed | null> {
  const id = url.searchParams.get('from');
  if (!id) return null;
  const { data } = await sb.from('fragments').select('id, body').eq('id', id).eq('status', 'note').maybeSingle();
  return data?.body ? { id: data.id, body: data.body } : null;
}
