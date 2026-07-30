// ============================================================================
// Shared internals for the action modules (docs/admin.md §4, ADR-0005).
//
// Not a namespace — nothing here is callable from the client. This file holds
// the pieces more than one domain needs: the Zod helpers that cope with Astro's
// form encoding, the error constructor, the admin guard, and slug uniqueness.
// Domain-specific helpers stay with their domain (see `persist` in fragments.ts).
// ============================================================================
import { ActionError } from 'astro:actions';
import { z } from 'astro/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';

export type DB = SupabaseClient<Database>;

// --- Zod helpers: empty form fields arrive as '' — treat them as absent ------
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
export const optText = z.preprocess(blankToUndef, z.string().optional());
export const optUrl = z.preprocess(blankToUndef, z.string().url('That doesn’t look like a URL').optional());
export const optInt = z.preprocess(blankToUndef, z.coerce.number().int().optional());
export const optUuid = z.preprocess(blankToUndef, z.string().uuid().optional());
/**
 * A comma-joined id list where EMPTY is a meaningful value, not absence
 * ("belongs to no constellation"). Astro's form→object step turns a blank
 * field into `null`, so a bare z.string() rejects the very case we mean.
 */
export const idList = z.preprocess((v) => (v == null ? '' : v), z.string());

/**
 * A fragment's tier: note → draft → published (docs/plans/09 Piece 2). `note`
 * is the private scratch level, and it is private *by construction* — the
 * public RLS policy is an allowlist on `status = 'published'`, so a new tier
 * can never leak by omission.
 */
export const fragmentStatus = z.enum(['note', 'draft', 'published']).default('draft');

/**
 * Constellations have no notes tier — and they need their own schema to say so.
 * `constellations.status` is a plain `text` column with a CHECK for
 * ('draft','published'), NOT the fragment_status enum, so a shared Zod const
 * would happily have let a constellation be filed as a note and only failed at
 * the database. Two lists, because they are two vocabularies.
 */
export const constellationStatus = z.enum(['draft', 'published']).default('draft');

export const fail = (
  message: string,
  code: ConstructorParameters<typeof ActionError>[0]['code'] = 'INTERNAL_SERVER_ERROR',
) => new ActionError({ code, message });

/**
 * Guard an action to the authenticated admin. Most actions are protected
 * implicitly by RLS (they run as the caller's session and is_admin() rejects
 * non-admins). Actions that DON'T touch RLS-protected tables — the AI subject
 * suggester and the Spotify lookup, which reach paid/third-party APIs — must
 * gate here, or they're callable by anyone. `role` lives in app_metadata, which
 * is server-controlled (a user can't grant it to themselves).
 */
export function requireAdmin(ctx: { locals: App.Locals }): void {
  if (ctx.locals.user?.app_metadata?.role !== 'admin') {
    throw fail('Not authorized.', 'FORBIDDEN');
  }
}

/** Ensure the slug is unique across ALL fragments (data-model.md §6). */
export async function uniqueSlug(sb: DB, base: string, excludeId?: string): Promise<string> {
  const root = base || 'untitled';
  for (let i = 0; i < 60; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    let q = sb.from('fragments').select('id').eq('slug', candidate).limit(1);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw fail(error.message);
    if (!data || data.length === 0) return candidate;
  }
  throw fail('Could not generate a unique slug');
}
