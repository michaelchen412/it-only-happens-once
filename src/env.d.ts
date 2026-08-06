/// <reference types="astro/client" />

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from './lib/database.types';
import type { Attention } from './lib/hq/attention';
import type { Ymd } from './lib/hq/time';

declare global {
  namespace App {
    interface Locals {
      /** Request-bound Supabase client (reads/writes the auth cookie session). */
      supabase: SupabaseClient<Database>;
      /** The signed-in Supabase user, or null. Set by middleware. */
      user: User | null;
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
    }
  }
}

export {};
