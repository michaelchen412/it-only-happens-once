// ============================================================================
// Admin mutations — the single write path (docs/admin.md §4, ADR-0005).
//
// Every handler runs on the server and uses the request-bound session client
// (context.locals.supabase) — NEVER the service-role key. So every write is
// authorized by Michael's cookie session and re-checked by is_admin() in RLS.
// An action is a validation/convenience layer, not a trust boundary.
//
// If a write fails with a permission error, the usual cause is a session whose
// JWT predates the admin-role grant — sign out and back in (see docs/auth.md).
//
// This file is only the index: Astro reads `server` from here, and each
// namespace lives in its own module beside it. Shared internals are in
// _shared.ts. Add a namespace by adding a file, never by growing this one.
// ============================================================================
import { fragments, songs } from './fragments';
import { versions } from './versions';
import { subjects, authors, works } from './vocabulary';
import { constellations } from './constellations';
import { pages, contact } from './site';
import { checkin } from './checkin';
import { people } from './people';
import { interactions } from './interactions';

export const server = {
  fragments,
  versions,
  songs,
  subjects,
  authors,
  works,
  constellations,
  pages,
  contact,
  // HQ (ADR-0012). Private tables, same write path.
  checkin,
  people,
  interactions,
};
