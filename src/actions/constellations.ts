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
import {
  CONSTELLATION_STATUSES,
  constellationStatus,
  fail,
  idList,
  optText,
  optUuid,
  requireAdmin,
  uniqueSlug,
} from './_shared';

export const constellations = {
  save: defineAction({
    accept: 'form',
    input: z.object({
      id: optUuid,
      name: z.string().trim().min(1, 'A constellation needs a name'),
      slug: optText,
      /**
       * ⚠ THESE TWO ARE WRITTEN FROM WHAT ARRIVES, AND WHAT DOESN'T ARRIVE IS
       * WRITTEN AS NULL. There used to be a sentinel here — "an ABSENT field
       * means leave as-is, an EMPTY one means clear" — and the second half of
       * that sentence was UNREACHABLE. `accept: 'form'` runs the FormData
       * through Astro's own coercion, and its `handleFormDataGet` answers
       * `undefined` for any FALSY value on an optional field: a cleared input
       * arrives byte-identically to a field that was never sent. So emptying
       * the score and pressing Save wrote nothing, and reopening the composer
       * put the playlist back — the same for the description (reported
       * 2026-08-11).
       *
       * The rule that replaces it is the one every caller already follows for
       * `name`, `slug` and `status`: TO CALL `save` IS TO EDIT THE WHOLE CARD.
       * Changing one field of a row you are not editing goes through
       * `setStatus`/`setColor` below — which is what the index does, and the
       * reason it can stop resending a name it read out of a `data-` attribute.
       */
      description: z.string().optional(),
      score_url: z.string().optional(),
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
        description: input.description?.trim() || null,
        score_url: scoreUrl || null,
      };
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
      // least-used slot, earliest on the ramp breaking ties. Nothing SENDS a
      // colour to this action — the sky is where that judgement is made, one
      // star against the rest of them (`setColor`) — so the pick is
      // unconditional rather than a fallback.
      const { data: taken } = await sb.from('constellations').select('color');
      const { data, error } = await sb
        .from('constellations')
        .insert({
          ...row,
          name: input.name.trim(),
          slug,
          color: leastUsedSlot((taken ?? []).map((t) => t.color)),
          sort: (last?.[0]?.sort ?? 0) + 1,
        })
        .select('id')
        .single();
      if (error) throw fail(error.message);
      return { id: data.id, slug };
    },
  }),
  /**
   * ⚠ THE ONE-CLICK WRITES FROM THE SKY'S INDEX, AND THEY ARE THEIR OWN ACTIONS
   * BECAUSE `save` IS A WHOLE-CARD WRITE. On `/admin/constellations` the click
   * IS the commit: there is no form and no Save button, and what you changed is
   * the one field you touched.
   *
   * Both of these used to go through `save`, which meant every list row had to
   * carry its `name`, `slug` and `status` in `data-` attributes and resend all
   * three — a whole row rebuilt from the DOM to flip one boolean, and a rename
   * made in another tab quietly overwritten by whatever the list was rendered
   * with. `description` and `score_url` were the fields that could NOT be
   * resent that way (Markdown in a `data-` attribute, and one of them long),
   * and covering for that is where the unreachable "empty means clear" sentinel
   * in `save` came from. Two four-line actions retire the whole arrangement.
   *
   * `status` takes no Zod default here, unlike `save`'s: an absent field on a
   * form post is what a real unchecked switch looks like, and defaulting it
   * would turn a dropped field into a silent unpublish.
   */
  setStatus: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), status: z.enum(CONSTELLATION_STATUSES) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase
        .from('constellations')
        .update({ status: input.status })
        .eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  /** The star's colour SLOT (app.css owns the value it resolves to). */
  setColor: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), color: z.enum(COLOR_SLOTS) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase
        .from('constellations')
        .update({ color: input.color })
        .eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
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
  /**
   * Authored order of the sky itself: sort = index in the given id list.
   *
   * ⚠ PARALLEL, NOT SEQUENTIAL, AND NOT A SINGLE UPSERT — the middle option is
   * the one that looks right and isn't (plans/30 · §3). One `upsert` of
   * `(id, sort)` rows would be atomic and would be one statement, and it cannot
   * be written here: PostgREST's upsert is `INSERT … ON CONFLICT DO UPDATE`,
   * Postgres checks NOT NULL while it BUILDS the tuple — before it ever gets to
   * the conflict — and `name`, `slug`, `color` and `status` are all NOT NULL on
   * this table. Supplying them means reading them and writing them back, which
   * silently clobbers a rename made in another tab. That is not ugly, it is
   * wrong, so the honest floor applies instead.
   *
   * What the change buys is latency: N round trips become one wall-clock round
   * trip. What it does NOT buy is atomicity, and here is the posture, the same
   * one `checkin.ts` states for its own version of this — a mid-flight failure
   * leaves the sky half-reordered. Accepted, because the whole of what is lost
   * is an ORDER: nothing is deleted, no constellation moves anywhere it wasn't
   * dragged, the next drag rewrites every position from scratch, and the action
   * throws so the page reloads and shows you the state as it actually is.
   */
  reorder: defineAction({
    accept: 'form',
    input: z.object({ ids: z.string().min(1) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const ids = input.ids.split(',').filter(Boolean);
      const results = await Promise.all(
        ids.map((id, i) =>
          sb
            .from('constellations')
            .update({ sort: i + 1 })
            .eq('id', id),
        ),
      );
      for (const { error } of results) if (error) throw fail(error.message);
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
      // ⚠ ONE READ AND ONE WRITE, WHATEVER THE COUNT (plans/30 · §3). This was
      // two sequential queries per constellation added — a tail position, then
      // an upsert — so placing a piece in four suites was eight round trips in
      // a row, and a failure at the fifth left it in two of them with nothing
      // said. Here the upsert genuinely IS available, because
      // `fragment_constellations` is `(constellation_id, fragment_id, position)`
      // and nothing else: every NOT NULL column is one we are supplying, so a
      // single statement can carry every new row and either all of them land or
      // none do.
      const add = [...want].filter((c) => !have.has(c));
      if (add.length) {
        // Every target's tail in one question. Ordered ascending so the LAST
        // row seen per constellation is its highest — the same answer the old
        // per-constellation `order desc limit 1` gave, asked once.
        const { data: tails, error: tailErr } = await sb
          .from('fragment_constellations')
          .select('constellation_id, position')
          .in('constellation_id', add)
          .order('position', { ascending: true });
        if (tailErr) throw fail(tailErr.message);

        const highest = new Map<string, number>();
        for (const row of tails ?? []) highest.set(row.constellation_id, row.position);

        const { error } = await sb.from('fragment_constellations').upsert(
          add.map((id) => ({
            constellation_id: id,
            fragment_id: input.fragment_id,
            position: (highest.get(id) ?? 0) + 1,
          })),
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

  /**
   * The composed order: positions rewritten 1..n from the given list.
   *
   * ⚠ ONE STATEMENT, SO THE SUITE IS NEVER HALF-REORDERED (plans/30 · §3).
   * This was one query per fragment, sequentially, which meant a twenty-piece
   * constellation was twenty round trips and a failure at the eleventh left the
   * composition in an order nobody authored — the first ten as dragged, the
   * rest as they were, and no note anywhere. An upsert works here (unlike
   * `reorder` above) because this table's every NOT NULL column is one we are
   * supplying, so the rewrite is atomic.
   *
   * ⚠ AND IT IS GUARDED, WHICH IS THE PART A BARE UPSERT GETS WRONG. `upsert`
   * is `INSERT … ON CONFLICT`, so an id that is NOT currently placed here would
   * be INSERTED — a *reorder* silently becoming a *place*. That is not
   * hypothetical: unplace a piece in one tab, drag in another, and the stale
   * tab's list would put it back. The old `.eq()` update no-opped on such a row
   * and that behaviour is worth keeping, so the current placements are read
   * first and the rewrite is the intersection. One extra read to keep the
   * action doing only what its name says.
   */
  reorderPlacements: defineAction({
    accept: 'form',
    input: z.object({ constellation_id: z.uuid(), fragment_ids: z.string().min(1) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const ids = input.fragment_ids.split(',').filter(Boolean);

      const { data: placed, error: readErr } = await sb
        .from('fragment_constellations')
        .select('fragment_id')
        .eq('constellation_id', input.constellation_id);
      if (readErr) throw fail(readErr.message);
      const here = new Set((placed ?? []).map((r) => r.fragment_id));

      // Positions stay 1..n over what is ACTUALLY placed: numbering from the
      // client's index would leave a gap wherever a stale id was dropped, and
      // "authored order, rewritten 1..n" is this module's opening promise.
      const rows = ids
        .filter((fragment_id) => here.has(fragment_id))
        .map((fragment_id, i) => ({
          constellation_id: input.constellation_id,
          fragment_id,
          position: i + 1,
        }));
      if (!rows.length) return { ok: true };

      const { error } = await sb
        .from('fragment_constellations')
        .upsert(rows, { onConflict: 'fragment_id,constellation_id' });
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
};
