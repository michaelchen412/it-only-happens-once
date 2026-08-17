/**
 * Reading the sets (plan 40 §3). The write path is `actions/sets.ts`; the
 * render is `components/MusicSets.astro`; the pure helpers are `music-sets.ts`.
 *
 * ⚠ A SET IS NOT A FRAGMENT, so none of `fragment-query.ts` applies here and
 * nothing in this file should grow toward it. A fragment is text with subjects,
 * placeable in a constellation, readable at a URL. A set is a curated listen
 * whose one job is to be SAVED into somebody else's Spotify library — which is
 * why it has no page of its own, no subjects and no feed entry.
 */
import type { DB } from '../actions/_shared';
import type { MusicSet } from './music-sets';

/** A set as the workshop sees it — drafts included. */
export interface SetRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  playlist_url: string;
  quote_fragment_id: string | null;
  /**
   * The cited quote's own words and line, for the sheet's summary — so the
   * epigraph field can show WHAT is cited rather than that something is
   * (plan 42 · §4.D.4).
   *
   * ⚠ UNFILTERED, UNLIKE `listSets`'s. That one drops a quote unless it is
   * itself published and undeleted, because a reader must never meet a draft.
   * This is the workshop: if a set cites a quote that has since been
   * unpublished or binned, the editor is exactly where that has to be VISIBLE
   * rather than silently blank. `checkQuote` refuses a binned one on the next
   * save, which is the moment to find out.
   */
  quote: { body: string | null; attribution: string | null } | null;
  status: string;
  sort: number;
}

/**
 * The shape the public page renders. Deliberately the same `MusicSet` the bench
 * feeds `MusicSets.astro`, so the component cannot tell a fixture from a row —
 * which is the only reason driving it on `/lab/sets` proved anything.
 */
export async function listSets(supabase: DB): Promise<MusicSet[]> {
  /*
    ⚠ `.eq('status', 'published')` IS EXPLICIT AND MUST STAY. RLS already hides
    drafts from anonymous readers — but not from Michael, who is the one person
    who reads this page while signed in, and so the only person who could be
    shown a draft on a public URL and not notice. The music room's query carried
    the same line for the same reason.
  */
  const { data } = await supabase
    .from('sets')
    // ⚠ ONE STRING LITERAL, NEVER A CONCATENATION. supabase-js infers the row
    // type from the select TEXT, so `'a, b' + 'c'` widens to `string` and every
    // column comes back as `GenericStringError` — which reads like a query bug
    // and is a types bug. Prettier will not split it; leave it long.
    // prettier-ignore
    .select(
      'id, slug, title, description, playlist_url, quote:fragments!sets_quote_fragment_id_fkey(body, status, deleted_at, attribution, work:works(title))',
    )
    .eq('status', 'published')
    .order('sort')
    .order('created_at');

  return (data ?? []).map((s) => {
    /*
      ⚠ THE QUOTE IS DROPPED UNLESS IT IS ITSELF PUBLISHED AND UNDELETED, and
      that check lives here rather than in the join because the join cannot do
      it: PostgREST filters on an embedded resource narrow the EMBED, and a set
      whose quote is a draft would come back with `quote: null` — which is the
      behaviour we want — but a set whose quote is a draft would ALSO be at risk
      of being filtered out entirely depending on how the embed is spelled. Doing
      it in TypeScript is unambiguous and cheap over seven rows.

      Anonymous readers never see a draft quote anyway; RLS refuses it. This
      exists for the signed-in reader, who is Michael, and for whom the failure
      would otherwise be invisible — the same argument as the `status` filter
      above.
    */
    /*
      ⚠ `attribution` RATHER THAN A JOIN TO `authors`, and that is the site's
      own answer rather than a shortcut. A quote's displayed source is the
      `attribution` string on the fragment; the `authors`/`works` rows are the
      Library's entities behind it, and which of the two an attribution should
      come from is `coalesce(work.author, fragment.author)` — logic that already
      lives elsewhere and has no business being written a second time here for
      a one-line epigraph.
    */
    const q = Array.isArray(s.quote) ? s.quote[0] : s.quote;
    const quote =
      q && q.status === 'published' && !q.deleted_at && q.body?.trim()
        ? {
            text: q.body.trim(),
            author: q.attribution?.trim() ?? '',
            work: (Array.isArray(q.work) ? q.work[0] : q.work)?.title ?? null,
          }
        : null;

    return {
      slug: s.slug,
      title: s.title,
      description: s.description ?? '',
      url: s.playlist_url,
      // A quote with no author is a quote we cannot attribute, and an
      // unattributed line in a slot that exists to say "someone else said this"
      // is worse than no line. Drop it rather than print a dangling em dash.
      quote: quote && quote.author ? quote : null,
    };
  });
}

/** Everything, drafts included, for the workshop list. */
export async function listSetsAdmin(supabase: DB): Promise<SetRow[]> {
  const { data } = await supabase
    .from('sets')
    // ⚠ ONE STRING LITERAL, NEVER A CONCATENATION — the reason is spelled out
    // over `listSets` above: supabase-js infers the row type from the select
    // TEXT, so a concatenation widens it to `string` and every column comes back
    // as `GenericStringError`. Prettier will not split it; leave it long.
    // prettier-ignore
    .select(
      'id, slug, title, description, playlist_url, quote_fragment_id, status, sort, quote:fragments!sets_quote_fragment_id_fkey(body, attribution)',
    )
    .order('sort')
    .order('created_at');
  // PostgREST answers a to-one embed as an object, but the generated types
  // allow an array — the same normalisation `listSets` does one function up.
  return (data ?? []).map((s) => ({
    ...s,
    quote: (Array.isArray(s.quote) ? s.quote[0] : s.quote) ?? null,
  })) as SetRow[];
}
