/// <reference types="astro/client" />

import type { JwtPayload, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './lib/database.types';
import type { Attention } from './lib/hq/attention';
import type { Ymd } from './lib/hq/time';

declare global {
  namespace App {
    interface Locals {
      /** Request-bound Supabase client (reads/writes the auth cookie session). */
      supabase: SupabaseClient<Database>;
      /**
       * The signed-in user's VERIFIED TOKEN CLAIMS, or null. Set by middleware.
       *
       * ⚠ THIS WAS `User` UNTIL 2026-08-07 AND THE NAME DID NOT CHANGE, so the
       * difference is worth being exact about (24 · Piece 8). It is no longer a
       * user record fetched from the Auth server; it is the payload of a JWT
       * whose signature middleware verified locally. Trustworthy for exactly
       * the same decisions — the signature is what authorization rests on, and
       * all four readers use only `email` and `app_metadata.role` — but it is a
       * snapshot taken when the token was issued, not a live record.
       *
       * ⚠ THERE IS NO `.id`. The subject is `sub`. That is the one place this
       * swap can bite, and it bites at runtime rather than here if somebody
       * reaches for `user.id` through an `any`.
       */
      user: JwtPayload | null;
      /**
       * Today in the configured home zone, resolved once per admin request.
       *
       * ⚠ SET UNDER `/admin` ONLY. Typed as always-present because every reader
       * is an admin page or the admin layout, and eight `!` assertions would be
       * eight places to wonder about; the cost is that a PUBLIC page reading it
       * gets `undefined` with no type error. It has no business doing so — the
       * public side has no configured day.
       */
      today: { tz: string; ymd: Ymd };
      /**
       * What the building is still waiting for (20 · §2) — always about today,
       * never about the date the page is looking at.
       *
       * `NOTHING` on any admin request that renders no chrome, so the layout
       * never has to ask whether it was computed.
       */
      attention: Attention;
      /**
       * Does the roster have anybody unarchived?
       *
       * ⚠ A FACT, NOT A LIST, and the distinction is the whole point (plan 45 ·
       * Piece 3). The ✚'s Log tab must be ABSENT rather than empty when nobody
       * is on the roster (10-hq §10b), so its presence has to be decided while
       * the layout renders — but the people themselves are only wanted by the
       * one person in a hundred page views who opens that tab, and fetching
       * them here would put a roster read on every admin page. `people.roster`
       * is where the list comes from, on demand.
       *
       * False on any request that renders no chrome.
       */
      hasRoster: boolean;
    }
  }
}

export {};
