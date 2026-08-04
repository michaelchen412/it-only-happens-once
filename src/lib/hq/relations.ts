// The one place an embedded Supabase relation is unwrapped (plan 00 · Piece 8).
//
// ⚠ THE PROBLEM, STATED ONCE SO IT IS NOT RE-DIAGNOSED IN ELEVEN PLACES.
// PostgREST returns an embedded relation as an OBJECT when the foreign key
// makes it to-one, and as an ARRAY when it is to-many — and `database.types.ts`
// cannot always tell which, because the generator infers it from the schema
// while the shape is decided by the query. So a two-level embed like
//
//     .select('person_id, people(*), events!inner(id, title, starts_at)')
//
// type-checks as one thing and arrives as another. Every reader of one of those
// queries was therefore hand-writing `as unknown as X | null`, eleven times
// across four files, each one silently opting out of the generated types with
// no note about why.
//
// ⚠ WHAT THIS DOES NOT DO IS REMOVE THE CAST. It moves it. `T` stays explicit
// at every call site, so the caller still states what it expects and still gets
// checked against that expectation everywhere downstream. A helper returning
// `any` would have been strictly worse than the status quo, which at least
// named a shape.
//
// The honest summary: this is a typed assertion with one comment behind it,
// rather than eleven untyped ones with none.
//
// NO SUPABASE IMPORT, not even a type. It takes `unknown` and gives back `T` —
// it never needs to know whose client produced the row.

/**
 * A to-one embed, which may arrive as an object, as a one-element array, or as
 * null when the join found nothing.
 *
 * The array case is not theoretical: the same relation comes back wrapped when
 * PostgREST reads the constraint as to-many, and a reader that assumed an
 * object would silently see `undefined` for every field rather than throwing.
 */
export function one<T>(rel: unknown): T | null {
  if (rel == null) return null;
  if (Array.isArray(rel)) return (rel[0] as T) ?? null;
  return rel as T;
}

/**
 * A to-many embed. A missing relation is an EMPTY LIST, never null — the
 * caller wants to iterate, and `?? []` at eleven call sites is the same
 * omission waiting to happen eleven times.
 */
export function many<T>(rel: unknown): T[] {
  if (rel == null) return [];
  return Array.isArray(rel) ? (rel as T[]) : [rel as T];
}
