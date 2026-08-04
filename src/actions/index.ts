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
import { links } from './links';
import { drift } from './drift';
import { tasks } from './tasks';
import { goals } from './goals';
import { events } from './events';
import { calendar } from './calendar';

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
  // The one namespace that writes rows referencing the PUBLIC half (§5). It
  // reads `works`/`fragments` and never updates them — linking is not editing.
  links,
  // The two drift dismissals, together because they are one control (§8).
  drift,
  // The agenda (13 · Pieces 1 and 2). `tasks.dispose` is where ADR-0013 lives:
  // one row and one date per answer, so a queue of arrears cannot come into
  // existence. `goals` holds the five-active cap, which the schema cannot.
  tasks,
  goals,
  // The calendar's writable half (13 · Piece 4). `tag` is the ONE write HQ has
  // against a mirrored row, and it is additive by construction, so it can never
  // create a conflict with Google (ADR-0014).
  events,
  // The Google mirror (13 · Piece 3). ⚠ NOTE WHAT IS NOT HERE: nothing that
  // writes to Google. `sync` pulls, and the credential it uses carries only
  // `calendar.events.readonly` — so the one-way rule is enforced by the token,
  // not by this list.
  calendar,
};
