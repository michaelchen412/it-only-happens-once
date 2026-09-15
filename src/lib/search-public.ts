/**
 * The public search fan-out — one term, seven kinds a reader may actually reach.
 *
 * Sibling of `search-all.ts`, and ⚠ DELIBERATELY NOT A MODE OF IT. That module's
 * central justification is that *"the answer is ALL columns, and it is the first
 * time that answer has been right… because every caller is behind `is_admin()`"*.
 * A reader is not. `docs/search.md` §6's closing ⚠ makes the column list a
 * question each consumer answers for itself, and folding two opposite answers
 * into one function with a boolean is how the wrong one eventually ships.
 *
 * ── THE COLUMN RULE: ONLY WHAT A READER CAN SEE ─────────────────────────────
 *
 * §1 states it for the blog — no `excerpt`, because *"a card blurb is a
 * rendering, and a hit in one the reader never sees reads as a false positive"*.
 * Every kind below keeps that rule, and the bench measured what it is worth:
 *
 *   · published fragments carrying an `excerpt`   **0**   (2026-09-15)
 *   · authors carrying a `note`                   **0**
 *   · subjects carrying a `definition`            **21**
 *
 * ⚠ SO THE LIVE CASE IS `subjects.definition`, NOT `excerpt`. Those 21 rows are
 * readable by `anon` and rendered in the ADMIN ONLY — the Library, the subject
 * filter, the fragment sheet. Searching them looked harmless and was not:
 * `dehumanization` returned **0 results with the rule and 1 without**, and that
 * one sent the reader to `/blog?subject=technology` to find the word nowhere on
 * the page. A search may only match what the destination will show.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * ⚠ `works` ARE EXCLUDED, and it is an addressing gap rather than a judgement.
 * `?work=` exists in the ADMIN's filter vocabulary and was never implemented on
 * the public feed — only `subject`, and `author` on the quotes view. A works row
 * would have nowhere to send anybody, and a result that cannot be followed is
 * the one thing this list must not contain. Add the public facet and this gains
 * a kind for free.
 *
 * ⚠ Nothing private appears because nothing private is queried — notes, tasks,
 * goals, people and the check-ins are absent by construction here AND refused by
 * RLS underneath. Two locks, deliberately: this file is the readable one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { noted } from './read-log';
import { toPlain } from './search-highlight';

type DB = SupabaseClient<Database>;

export type PublicKind = 'writing' | 'quote' | 'constellation' | 'set' | 'song' | 'subject' | 'author';

export interface PublicHit {
  kind: PublicKind;
  /** The naming line. A quote has no title, so it is named by its own words. */
  name: string;
  /** What gets excerpted — and only ever text the destination will render. */
  body: string;
  /** A small trailing fact: an attribution, an artist. */
  meta: string;
  /** Always a route that exists. See the `works` note above for why. */
  href: string;
  /**
   * Constellations only — what a row needs to draw its own ✦.
   *
   * ⚠ THE COLOUR SLOT IS A CLASS ON THE ROW, NOT A PROP ON THE STAR.
   * `.sky-star` reads `var(--cn)`, which `cn-<slot>` sets on an ancestor, so
   * the whole row warms to one ink from one declaration — see
   * `ConstellationStar.astro`. The slug is here because the breathing phase is
   * derived from it, which is what keeps a constellation the SAME star in the
   * sky and in a search result rather than two things wearing one name.
   */
  star?: { slot: string; slug: string };
}

export const PUBLIC_KINDS: Record<PublicKind, { label: string }> = {
  writing: { label: 'Writing' },
  quote: { label: 'Quotes' },
  constellation: { label: 'Constellations' },
  set: { label: 'Sets' },
  song: { label: 'Songs' },
  subject: { label: 'Subjects' },
  author: { label: 'Voices' },
};

/** Grouping order: the writing first, then the listening, then the ways in. */
export const PUBLIC_ORDER: PublicKind[] = ['writing', 'quote', 'constellation', 'set', 'song', 'subject', 'author'];

/** A quote's opening words, since it has no title. */
function opening(body: string, max = 72): string {
  const flat = toPlain(body).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat || '…';
}

/**
 * ⚠ COMMA AND PAREN ARE PostgREST's `or` SYNTAX, NOT TEXT — `fragment-query.ts`
 * and `notes.astro` both do exactly this. A term containing one would otherwise
 * be read as a filter separator, and the failure is not always an error.
 */
const escape = (q: string) => q.replace(/[(),]/g, ' ');

/** A backstop, not paging. The public corpus is ~340 rows. */
const CEILING = 100;

export async function searchPublic(supabase: DB, q: string): Promise<PublicHit[]> {
  const safe = escape(q);
  const like = (cols: string[]) => cols.map((c) => `${c}.ilike.%${safe}%`).join(',');

  async function writing(): Promise<PublicHit[]> {
    const { data } = await supabase
      .from('fragments')
      .select('slug, title, body')
      .eq('type', 'writing')
      .eq('status', 'published')
      .is('deleted_at', null)
      .or(like(['title', 'body']))
      .limit(CEILING)
      .then(noted('public search: writing'));
    return (data ?? []).map((r) => ({
      kind: 'writing' as const,
      name: r.title || '(untitled)',
      body: r.body ?? '',
      meta: '',
      href: `/blog/${r.slug}`,
    }));
  }

  async function quotes(): Promise<PublicHit[]> {
    const { data } = await supabase
      .from('fragments')
      .select('slug, body, attribution')
      .eq('type', 'quote')
      .eq('status', 'published')
      .is('deleted_at', null)
      .or(like(['body', 'attribution']))
      .limit(CEILING)
      .then(noted('public search: quotes'));
    return (data ?? []).map((r) => ({
      kind: 'quote' as const,
      name: opening(r.body ?? ''),
      body: r.body ?? '',
      meta: r.attribution ?? '',
      // ⚠ The SAME route as an essay — `blog/[slug].astro` serves both, which is
      // what ADR-0003's single table implies.
      href: `/blog/${r.slug}`,
    }));
  }

  async function constellations(): Promise<PublicHit[]> {
    const { data } = await supabase
      .from('constellations')
      .select('slug, name, description, color')
      .eq('status', 'published')
      .or(like(['name', 'description']))
      .limit(CEILING)
      .then(noted('public search: constellations'));
    return (data ?? []).map((r) => ({
      kind: 'constellation' as const,
      name: r.name,
      body: r.description ?? '',
      meta: '',
      // Root-level slugs by design — sharing is a core use, and
      // `/conditions-not-character` is the prettiest URL for it.
      href: `/${r.slug}`,
      star: { slot: r.color ?? 'amber', slug: r.slug },
    }));
  }

  async function sets(): Promise<PublicHit[]> {
    const { data } = await supabase
      .from('sets')
      .select('slug, title, description')
      .eq('status', 'published')
      .or(like(['title', 'description']))
      .limit(CEILING)
      .then(noted('public search: sets'));
    return (data ?? []).map((r) => ({
      kind: 'set' as const,
      name: r.title,
      body: r.description ?? '',
      meta: '',
      // ⚠ A set is addressable: `?set=<slug>` opens exactly one.
      href: `/listening?set=${r.slug}`,
    }));
  }

  async function songs(): Promise<PublicHit[]> {
    const { data } = await supabase
      .from('songs')
      .select('title, artist')
      .or(like(['title', 'artist']))
      .limit(CEILING)
      .then(noted('public search: songs'));
    return (data ?? []).map((r) => ({
      kind: 'song' as const,
      name: r.title,
      body: '',
      meta: r.artist ?? '',
      // ⚠ No per-song address — a song lives inside a set's list, so this lands
      // in the room and lets the reader look. The weakest destination here, and
      // the only one without a better option today.
      href: '/listening',
    }));
  }

  async function subjects(): Promise<PublicHit[]> {
    // ⚠ `name` ONLY. `definition` is the live invisible column — see the header.
    const { data } = await supabase
      .from('subjects')
      .select('slug, name')
      .or(like(['name']))
      .limit(CEILING)
      .then(noted('public search: subjects'));
    return (data ?? []).map((r) => ({
      kind: 'subject' as const,
      name: r.name,
      body: '',
      meta: '',
      href: `/blog?subject=${r.slug}`,
    }));
  }

  async function authors(): Promise<PublicHit[]> {
    // ⚠ `name` ONLY. `authors.note` is Michael's own line about the author and
    // is rendered nowhere public, so a hit there would be unfindable.
    const { data } = await supabase
      .from('authors')
      .select('slug, name')
      .or(like(['name']))
      .limit(CEILING)
      .then(noted('public search: authors'));
    return (data ?? []).map((r) => ({
      kind: 'author' as const,
      name: r.name,
      body: '',
      meta: '',
      // ⚠ QUOTES VIEW ONLY — `blog/index.astro` reads `author` only when
      // `view === 'quotes'`, so the link must name the view or it silently
      // widens to the whole feed.
      href: `/blog?view=quotes&author=${r.slug}`,
    }));
  }

  const results = await Promise.all([writing(), quotes(), constellations(), sets(), songs(), subjects(), authors()]);
  return results.flat();
}
