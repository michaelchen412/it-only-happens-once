// ============================================================================
// Constellations: the composing room (design.md §13).
//
// A "pile" is just a draft constellation; drafts are RLS-hidden from anon.
// Placement is composition: positions are authored order, rewritten 1..n.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { slugify } from '../lib/slug';
import { COLOR_SLOTS, leastUsedSlot } from '../lib/constellation-colors';
import type { Database } from '../lib/database.types';
import { constellationStatus, fail, idList, optText, optUuid, requireAdmin, uniqueSlug } from './_shared';

export const constellations = {
  save: defineAction({
    accept: 'form',
    input: z.object({
      id: optUuid,
      name: z.string().trim().min(1, 'A constellation needs a name'),
      slug: optText,
      // Plain optional (no blank→undefined): an ABSENT field means "leave
      // as-is" (the index's status toggle), an EMPTY one means "clear"
      // (the composer form always submits both).
      description: z.string().optional(),
      score_url: z.string().optional(),
      // The colour SLOT (app.css owns the value). Absent on create → we pick
      // the least-used one, so a new constellation is distinguishable from
      // its neighbours without anyone thinking about it.
      color: z.enum(COLOR_SLOTS).optional(),
      status: constellationStatus,
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      // A slug nobody else in `constellations` is using. This was a loop
      // inlined here — the fourth copy of the same probe in the actions tree —
      // until `uniqueSlug` learned to take its table. Worth noting what the
      // copy got wrong: it fell out of the loop after 59 attempts and used the
      // last candidate WITHOUT checking it, so a crowded name would have
      // written a duplicate and failed at the unique index. The shared one
      // refuses in a sentence instead.
      const slug = await uniqueSlug(
        sb,
        'constellations',
        slugify(input.slug || input.name) || 'constellation',
        input.id,
      );
      const scoreUrl = input.score_url?.trim();
      if (scoreUrl) {
        try {
          new URL(scoreUrl);
        } catch {
          throw fail('The score doesn’t look like a URL', 'BAD_REQUEST');
        }
      }
      const row: Database['public']['Tables']['constellations']['Update'] = {
        name: input.name.trim(),
        slug,
        status: input.status,
      };
      if (input.description !== undefined) row.description = input.description.trim() || null;
      if (input.score_url !== undefined) row.score_url = scoreUrl || null;
      if (input.color) row.color = input.color;
      if (input.id) {
        const { error } = await sb.from('constellations').update(row).eq('id', input.id);
        if (error) throw fail(error.message);
        return { id: input.id, slug };
      }
      const { data: last } = await sb
        .from('constellations')
        .select('sort')
        .order('sort', { ascending: false })
        .limit(1);
      // A new star should not arrive wearing a neighbour's colour: take the
      // least-used slot, earliest on the ramp breaking ties.
      if (!row.color) {
        const { data: taken } = await sb.from('constellations').select('color');
        row.color = leastUsedSlot((taken ?? []).map((t) => t.color));
      }
      const { data, error } = await sb
        .from('constellations')
        .insert({ ...row, name: input.name.trim(), slug, sort: (last?.[0]?.sort ?? 0) + 1 })
        .select('id')
        .single();
      if (error) throw fail(error.message);
      return { id: data.id, slug };
    },
  }),
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      // Placements cascade away; fragments are never touched.
      const { error } = await ctx.locals.supabase.from('constellations').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  /** Authored order of the sky itself: sort = index in the given id list. */
  reorder: defineAction({
    accept: 'form',
    input: z.object({ ids: z.string().min(1) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const ids = input.ids.split(',').filter(Boolean);
      for (let i = 0; i < ids.length; i++) {
        const { error } = await sb
          .from('constellations')
          .update({ sort: i + 1 })
          .eq('id', ids[i]);
        if (error) throw fail(error.message);
      }
      return { ok: true };
    },
  }),
  /** Append a fragment to a suite (idempotent — re-placing is a no-op). */
  place: defineAction({
    accept: 'form',
    input: z.object({ constellation_id: z.uuid(), fragment_id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const { data: last } = await sb
        .from('fragment_constellations')
        .select('position')
        .eq('constellation_id', input.constellation_id)
        .order('position', { ascending: false })
        .limit(1);
      const { error } = await sb.from('fragment_constellations').upsert(
        {
          constellation_id: input.constellation_id,
          fragment_id: input.fragment_id,
          position: (last?.[0]?.position ?? 0) + 1,
        },
        { onConflict: 'fragment_id,constellation_id', ignoreDuplicates: true },
      );
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  /** Remove from the suite — unplacing, never deleting the fragment. */
  unplace: defineAction({
    accept: 'form',
    input: z.object({ constellation_id: z.uuid(), fragment_id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase
        .from('fragment_constellations')
        .delete()
        .eq('constellation_id', input.constellation_id)
        .eq('fragment_id', input.fragment_id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  /**
   * The FRAGMENT's side of the relationship: reconcile which constellations
   * one fragment belongs to, in a single call. Additions append to each
   * suite's end (order is the constellation's business — recompose there);
   * removals unplace only. Used by the pickers in the editor sheets.
   */
  setMembership: defineAction({
    accept: 'form',
    input: z.object({
      fragment_id: z.uuid(),
      /** Comma-separated constellation ids; EMPTY means "belongs to none". */
      constellation_ids: idList,
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const want = new Set(
        input.constellation_ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      const { data: current, error: readErr } = await sb
        .from('fragment_constellations')
        .select('constellation_id')
        .eq('fragment_id', input.fragment_id);
      if (readErr) throw fail(readErr.message);
      const have = new Set((current ?? []).map((r) => r.constellation_id));

      const remove = [...have].filter((id) => !want.has(id));
      if (remove.length) {
        const { error } = await sb
          .from('fragment_constellations')
          .delete()
          .eq('fragment_id', input.fragment_id)
          .in('constellation_id', remove);
        if (error) throw fail(error.message);
      }
      for (const id of [...want].filter((c) => !have.has(c))) {
        const { data: last } = await sb
          .from('fragment_constellations')
          .select('position')
          .eq('constellation_id', id)
          .order('position', { ascending: false })
          .limit(1);
        const { error } = await sb
          .from('fragment_constellations')
          .upsert(
            { constellation_id: id, fragment_id: input.fragment_id, position: (last?.[0]?.position ?? 0) + 1 },
            { onConflict: 'fragment_id,constellation_id', ignoreDuplicates: true },
          );
        if (error) throw fail(error.message);
      }
      return { ok: true };
    },
  }),

  /**
   * Bulk elevate/remove from the Fragment Manager's selection bar. `op=add`
   * appends each fragment to the suite in the order given; `op=remove`
   * unplaces them. Both are idempotent.
   */
  bulkMembership: defineAction({
    accept: 'form',
    input: z.object({
      constellation_id: z.uuid(),
      fragment_ids: z.string().min(1),
      op: z.enum(['add', 'remove']),
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const ids = input.fragment_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length) return { ok: true, count: 0 };

      if (input.op === 'remove') {
        const { error } = await sb
          .from('fragment_constellations')
          .delete()
          .eq('constellation_id', input.constellation_id)
          .in('fragment_id', ids);
        if (error) throw fail(error.message);
        return { ok: true, count: ids.length };
      }

      const { data: last } = await sb
        .from('fragment_constellations')
        .select('position')
        .eq('constellation_id', input.constellation_id)
        .order('position', { ascending: false })
        .limit(1);
      let next = (last?.[0]?.position ?? 0) + 1;
      const rows = ids.map((fragment_id) => ({
        constellation_id: input.constellation_id,
        fragment_id,
        position: next++,
      }));
      const { error } = await sb
        .from('fragment_constellations')
        .upsert(rows, { onConflict: 'fragment_id,constellation_id', ignoreDuplicates: true });
      if (error) throw fail(error.message);
      return { ok: true, count: ids.length };
    },
  }),

  /** The composed order: positions rewritten 1..n from the given list. */
  reorderPlacements: defineAction({
    accept: 'form',
    input: z.object({ constellation_id: z.uuid(), fragment_ids: z.string().min(1) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const ids = input.fragment_ids.split(',').filter(Boolean);
      for (let i = 0; i < ids.length; i++) {
        const { error } = await sb
          .from('fragment_constellations')
          .update({ position: i + 1 })
          .eq('constellation_id', input.constellation_id)
          .eq('fragment_id', ids[i]);
        if (error) throw fail(error.message);
      }
      return { ok: true };
    },
  }),
};
