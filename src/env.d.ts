/// <reference types="astro/client" />

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from './lib/database.types';

declare global {
  namespace App {
    interface Locals {
      /** Request-bound Supabase client (reads/writes the auth cookie session). */
      supabase: SupabaseClient<Database>;
      /** The signed-in Supabase user, or null. Set by middleware. */
      user: User | null;
    }
  }
}

export {};
