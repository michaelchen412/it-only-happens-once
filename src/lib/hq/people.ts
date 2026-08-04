// The roster's vocabulary and its derivations (docs/plans/12-people.md).
//
// Everything a person surface needs that is NOT a query and NOT a date format —
// dates live in `./dates.ts`, and the two people pages share this so a rule can
// never be half-applied to one of them.
//
// WHAT IS DELIBERATELY ABSENT, so its absence reads as a decision rather than an
// oversight: there is no `since()` duration formatter and no drift predicate
// here. Both are functions of `last_contact_at`, which is derived from
// `interactions` — a table Piece 2 creates. Writing them now would mean shipping
// two rules nothing can exercise, against data that cannot exist, and the people
// lab's own lesson was that a hand-fed derivation is most convincing exactly
// where it is most wrong (10-hq.md §10h). They arrive with the table.
import type { Database } from '../database.types';
import { slugify } from '../slug';
import { nextOccurrence } from './dates';
import { daysBetween, ymdToUtc, type Ymd } from './time';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Person = Database['public']['Tables']['people']['Row'];
export type Circle = Database['public']['Enums']['person_circle'];

/**
 * The sections of the roster, in the order they appear.
 *
 * THREE, AND THERE IS NO `acquaintances` (§3). That is a statement about how
 * Michael relates to people rather than a UI simplification — "I would consider
 * everyone that I'm in regular or even irregular contact with a friend."
 * Irregularity of contact is not a demotion, and the honest way to handle
 * someone who has genuinely fallen out of his life is `archived_at`, not a
 * lesser tier that keeps them on screen.
 */
export const CIRCLES: { key: Circle; label: string }[] = [
  { key: 'family', label: 'Family' },
  { key: 'friends', label: 'Friends' },
  { key: 'professional', label: 'Professional' },
];

/** The month names the birthday picker offers, indexed 1–12 by value. */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Above this many people the roster grows a search box.
 *
 * A search field over four faces is furniture (§3) — it takes space, it implies
 * the list is too long to read, and it is slower than looking. The roster's
 * whole ceiling is 50, so search is a convenience and never the way in.
 */
export const SEARCH_APPEARS_ABOVE = 6;

/**
 * Cadence is stored in days and entered in MONTHS, because nobody thinks in
 * days (§10) — and these two functions are the whole conversion, shared by the
 * form that renders it and the action that writes it.
 *
 * THE FACTOR IS 30.4375, NOT 30, and that is not fussiness. The default cadence
 * is 365 days, and a 30-day month renders it as 12 and writes back 360 — so
 * opening the edit sheet and pressing Save with nothing touched would silently
 * move a value you never looked at, every time, for everyone. At 365.25/12 the
 * round trip is exact: 365 → 12 → 365.
 */
const DAYS_PER_MONTH = 365.25 / 12;
export const monthsToDays = (months: number): number => Math.round(months * DAYS_PER_MONTH);
export const daysToMonths = (days: number): number => Math.round(days / DAYS_PER_MONTH);

/**
 * How long a photo's signed URL stays good.
 *
 * Generous on purpose: these are admin pages rendered on demand and never
 * cached (`/admin` is `cache-control: private, no-store` by middleware), so the
 * only thing this bounds is how long a URL survives being copied out of the
 * page source. An hour is longer than any session spends on a profile and short
 * enough that a leaked URL is not a permanent one.
 *
 * ⚠ NEVER PERSIST WHAT `signPhotos` RETURNS. A signed URL in the database, or
 * baked into anything cached, is an image that goes broken at a time nobody
 * will connect to the cause.
 */
export const PHOTO_URL_TTL_SECONDS = 3600;

/** The private bucket. Not `site` — see 12-people.md §7 and 10-hq.md §7c. */
export const PHOTO_BUCKET = 'hq';

/**
 * Sign every photo path in one round trip, as `path → url`.
 *
 * Paths that fail to sign are simply absent from the map, and the callers fall
 * back to a monogram. That is the right failure: a missing face is a cosmetic
 * loss, and a page that 500s because one object was deleted out from under it
 * is not.
 */
export async function signPhotos(sb: SupabaseClient<Database>, paths: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  const urls = new Map<string, string>();
  if (wanted.length === 0) return urls;

  const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(wanted, PHOTO_URL_TTL_SECONDS);
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) urls.set(row.path, row.signedUrl);
  }
  return urls;
}

/**
 * The object path for a person's photo.
 *
 * Keyed on the person's ID, never the slug: renaming somebody must not orphan
 * their face, and a slug is the one identifier here that changes. The content
 * hash makes re-uploading the same file a no-op rather than a second object.
 */
export function photoPath(personId: string, hash: string, ext: string): string {
  return `people/${personId}/${hash}.${ext}`;
}

/**
 * The eight-hue constellation ramp, reused as monogram washes so HQ adds no
 * second palette and is theme-aware in dusk and paper for free (10-hq.md §10a).
 */
const HUES = ['cn-violet', 'cn-ice', 'cn-azure', 'cn-gold', 'cn-amber', 'cn-sand', 'cn-ember', 'cn-rose'];

/**
 * A stable hue for a person, derived from their id.
 *
 * Derived rather than stored or random, and derived from the ID rather than
 * their position in the list: an index-based hue would repaint half the roster
 * every time somebody is added, and a random one would differ between the card
 * and the profile of the same person on the same page.
 */
export function hueFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

/**
 * The letter on the monogram wash when there is no photo.
 *
 * `Intl.Segmenter` rather than `name[0]`, because a name can begin with a
 * character JavaScript stores as two — an emoji, or a letter carrying a
 * combining mark. `name[0]` splits those in half and renders a replacement box.
 */
export function monogram(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  const [first] = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(trimmed);
  return (first?.segment ?? trimmed[0]).toUpperCase();
}

/**
 * A URL identity for a new person. Uniqueness is enforced at save time by
 * `uniquePersonSlug` — this only shapes the candidate.
 *
 * The fallback matters more here than for fragments: a roster is exactly where
 * a name like "Mum" or a name written in a non-Latin script turns up, and
 * `slugify` correctly returns '' for the latter rather than inventing
 * transliteration. An unaddressable person would be worse than an opaque URL.
 */
export function personSlug(displayName: string): string {
  return slugify(displayName) || 'person';
}

export interface UpcomingBirthday {
  /** The next occurrence, resolved to a real date so it has a weekday. */
  ymd: Ymd;
  /** Whole days away. `0` is today. */
  days: number;
}

/**
 * The person's next birthday, but only while it is inside their own lead window
 * — otherwise `null`, and nothing renders.
 *
 * THE LEAD IS PER-PERSON AND DEFAULTS TO 30 DAYS, not 7 (§8). "Happy birthday
 * on time" for the people who matter means knowing weeks ahead: a week is
 * enough to send a message and nowhere near enough to choose a gift and have it
 * arrive. Outside the window a cake icon is noise for 340 days a year, which is
 * why this returns null rather than a distance for the caller to test.
 */
export function upcomingBirthday(person: Person, today: Ymd): UpcomingBirthday | null {
  if (person.birth_month == null || person.birth_day == null) return null;
  const ymd = nextOccurrence(person.birth_month, person.birth_day, today);
  const days = daysBetween(today, ymd);
  return days <= person.birthday_lead_days ? { ymd, days } : null;
}

/**
 * `2013 · 13 years` — how long he has known someone.
 *
 * Left off the card deliberately (§3): it is a lovely fact that never changes
 * and drives no decision, so it costs a line the card needs for something else.
 * In the profile header, where facts are the point, it reads beautifully.
 */
export function knownFor(year: number | null, today: Ymd): string | null {
  if (year == null) return null;
  const years = ymdToUtc(today).getUTCFullYear() - year;
  if (years < 0) return String(year);
  if (years === 0) return `${year} · this year`;
  return `${year} · ${years} year${years === 1 ? '' : 's'}`;
}

/**
 * Roster order within a circle section.
 *
 * ⚠ TEMPORARY, AND THE COMMENT IS THE POINT. §3 settles this as "last
 * interaction, descending" — people he is actually in touch with float up and
 * drift sinks naturally, which is information without accusation. That ordering
 * needs `interactions`, so until Piece 2 lands the only honest fallback is
 * alphabetical: it is stable, it is predictable, and it asserts nothing the
 * database cannot back up. Ordering by `created_at` was the alternative and is
 * worse — the roster would reshuffle itself every time somebody was added, for
 * a reason nobody could see.
 */
export function rosterOrder(a: Person, b: Person): number {
  const key = (p: Person) => (p.sort_name || p.display_name).toLocaleLowerCase();
  return key(a).localeCompare(key(b));
}

/**
 * What the search box matches against, rendered onto the card as an attribute
 * so filtering is a DOM pass rather than a round trip.
 *
 * Client-side on purpose: the roster's ceiling is 50 rows, they are all already
 * on the page, and asking the server per keystroke would be slower and no more
 * correct. (The corpus manager searches server-side because it pages over
 * hundreds of fragments — a different problem, correctly solved differently.)
 *
 * Name, epithet and location — the things you would actually search by. NOT
 * `bio`: a hit buried in a paragraph the roster does not display reads as a
 * bug, because the card that survives the filter shows no reason why.
 *
 * `full_name` IS included even though no Piece 1 surface can set it: if a row
 * ever carries one, searching for it should work, and that is cheaper to allow
 * now than to remember later.
 */
export function searchText(person: Person): string {
  return [person.display_name, person.full_name, person.epithet, person.location]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}
