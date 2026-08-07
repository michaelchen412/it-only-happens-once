// ============================================================================
// Draft versions and promotion (docs/plans/07, docs/admin.md §5).
//
// The rule this module exists to enforce: **editing a published piece never
// mutates the canonical row.** Edits land in that fragment's working version;
// the live essay changes only when a human promotes one, and promotion
// preserves what it replaces.
//
// A version carries words only — title, excerpt, body. Slug, dates, status,
// subjects and constellation membership belong to the fragment, so promoting
// rewrites the piece without moving its URL or its place in the sky.
//
// This is NOT offline support and must not grow into it (ADR-0010). Every
// write here is an ordinary online insert.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import type { Database } from '../lib/database.types';
import { type DB, fail, optText, requireAdmin } from './_shared';

type VersionRow = Database['public']['Tables']['fragment_versions']['Row'];

/** What a version holds. Anything outside this belongs to the fragment. */
const WORDS = 'id, kind, label, title, excerpt, body, created_at, updated_at';

/** First words of the body, for a version list that shows what changed. */
function preview(body: string | null, n = 120): string {
  const flat = (body ?? '')
    .replace(/[#*_>`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > n ? flat.slice(0, n).trimEnd() + '…' : flat;
}

/**
 * Snapshot a fragment's CURRENT canonical words before anything overwrites
 * them. Called on promote, which is the only moment a published piece's text is
 * replaced — so history is a consequence of promoting, not a feature to
 * remember to use.
 */
async function snapshotCanonical(sb: DB, fragmentId: string, label: string): Promise<void> {
  const { data: frag, error } = await sb
    .from('fragments')
    .select('title, excerpt, body')
    .eq('id', fragmentId)
    .maybeSingle();
  if (error) throw fail(error.message);
  if (!frag) throw fail('That piece no longer exists', 'NOT_FOUND');
  const { error: insErr } = await sb.from('fragment_versions').insert({
    fragment_id: fragmentId,
    kind: 'snapshot',
    label,
    title: frag.title,
    excerpt: frag.excerpt,
    body: frag.body,
  });
  if (insErr) throw fail(insErr.message);
}

export const versions = {
  /**
   * Autosave target for a published piece: overwrite its single working
   * version, creating it on first keystroke. This is the crash-safety job —
   * the words are on the server within a debounce of being typed, while the
   * live essay stays exactly as readers last saw it.
   *
   * Update-then-insert rather than upsert: the "one working version" rule is a
   * PARTIAL unique index (`where kind = 'working'`), which PostgREST's
   * on-conflict cannot target.
   */
  saveWorking: defineAction({
    accept: 'form',
    input: z.object({
      fragment_id: z.uuid(),
      title: optText,
      excerpt: optText,
      body: optText,
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const words = {
        title: input.title ?? null,
        excerpt: input.excerpt ?? null,
        body: input.body ?? null,
      };

      const { data: updated, error: upErr } = await sb
        .from('fragment_versions')
        .update(words)
        .eq('fragment_id', input.fragment_id)
        .eq('kind', 'working')
        .select('id, updated_at')
        .maybeSingle();
      if (upErr) throw fail(upErr.message);
      if (updated) return { id: updated.id, updatedAt: updated.updated_at };

      const { data: inserted, error: insErr } = await sb
        .from('fragment_versions')
        .insert({ fragment_id: input.fragment_id, kind: 'working', ...words })
        .select('id, updated_at')
        .single();
      if (insErr) throw fail(insErr.message);
      return { id: inserted.id, updatedAt: inserted.updated_at };
    },
  }),

  /**
   * Every version of one piece, with the canonical row alongside so the sheet
   * can say which of them differ from what's live.
   *
   * The working version sorts FIRST — it's the pending rewrite, the reason you
   * opened this tab — then snapshots newest-first. That means `kind` descending,
   * since 'working' > 'snapshot' alphabetically; ascending would bury the live
   * edit under the whole archive.
   */
  list: defineAction({
    input: z.object({ fragment_id: z.uuid() }),
    handler: async ({ fragment_id }, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const [{ data: rows, error }, { data: frag, error: fErr }] = await Promise.all([
        sb
          .from('fragment_versions')
          .select(WORDS)
          .eq('fragment_id', fragment_id)
          .order('kind', { ascending: false }) // 'working' before 'snapshot'
          .order('created_at', { ascending: false }),
        sb.from('fragments').select('title, excerpt, body, updated_at').eq('id', fragment_id).maybeSingle(),
      ]);
      if (error) throw fail(error.message);
      if (fErr) throw fail(fErr.message);
      if (!frag) throw fail('That piece no longer exists', 'NOT_FOUND');

      const same = (v: VersionRow) =>
        (v.title ?? '') === (frag.title ?? '') &&
        (v.excerpt ?? '') === (frag.excerpt ?? '') &&
        (v.body ?? '') === (frag.body ?? '');

      return {
        canonical: { title: frag.title ?? '', preview: preview(frag.body), updatedAt: frag.updated_at },
        versions: ((rows ?? []) as VersionRow[]).map((v) => ({
          id: v.id,
          kind: v.kind,
          label: v.label ?? '',
          title: v.title ?? '',
          preview: preview(v.body),
          createdAt: v.created_at,
          updatedAt: v.updated_at,
          /** Nothing to promote if it already matches what's live. */
          matchesCanonical: same(v),
        })),
      };
    },
  }),

  /** One version's full words — the preview pane, and the restore path. */
  get: defineAction({
    input: z.object({ id: z.uuid() }),
    handler: async ({ id }, ctx) => {
      requireAdmin(ctx);
      const { data, error } = await ctx.locals.supabase
        .from('fragment_versions')
        .select(`${WORDS}, fragment_id`)
        .eq('id', id)
        .maybeSingle();
      if (error) throw fail(error.message);
      if (!data) throw fail('That version no longer exists', 'NOT_FOUND');
      return {
        id: data.id,
        fragmentId: data.fragment_id,
        kind: data.kind,
        label: data.label ?? '',
        title: data.title ?? '',
        excerpt: data.excerpt ?? '',
        body: data.body ?? '',
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },
  }),

  /**
   * Make a version canonical — the deliberate, online moment the public site
   * changes. The outgoing text is snapshotted FIRST, so the opening you decide
   * you preferred is still there afterwards.
   *
   * A promoted working version is then deleted: it has become the piece, and
   * leaving it would show a permanent "unsaved rewrite" that matches what's
   * already live. A promoted snapshot stays — it's history, and history keeps.
   */
  promote: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;

      const { data: version, error: vErr } = await sb
        .from('fragment_versions')
        .select('id, fragment_id, kind, title, excerpt, body')
        .eq('id', input.id)
        .maybeSingle();
      if (vErr) throw fail(vErr.message);
      if (!version) throw fail('That version no longer exists', 'NOT_FOUND');

      // A published piece must never end up with an empty body.
      const { data: frag, error: fErr } = await sb
        .from('fragments')
        .select('status')
        .eq('id', version.fragment_id)
        .maybeSingle();
      if (fErr) throw fail(fErr.message);
      if (!frag) throw fail('That piece no longer exists', 'NOT_FOUND');
      if (frag.status === 'published') {
        if (!version.title?.trim())
          throw fail('This version has no title — a published piece needs one', 'BAD_REQUEST');
        if (!version.body?.trim()) throw fail('This version is empty — there’d be nothing to read', 'BAD_REQUEST');
      }

      await snapshotCanonical(sb, version.fragment_id, `Replaced ${new Date().toISOString().slice(0, 10)}`);

      const { data: saved, error: updErr } = await sb
        .from('fragments')
        .update({ title: version.title, excerpt: version.excerpt, body: version.body })
        .eq('id', version.fragment_id)
        .select('id, slug, updated_at')
        .maybeSingle();
      if (updErr) throw fail(updErr.message);
      if (!saved) throw fail('That piece no longer exists', 'NOT_FOUND');

      if (version.kind === 'working') {
        const { error: delErr } = await sb.from('fragment_versions').delete().eq('id', version.id);
        if (delErr) throw fail(delErr.message);
      }
      return { id: saved.id, slug: saved.slug, updatedAt: saved.updated_at };
    },
  }),

  /**
   * Keep the current working version as a named variant, and start a fresh
   * working copy from wherever editing goes next. Michael's recipe-version
   * manager: any number of drafts, one of them promoted.
   */
  keep: defineAction({
    accept: 'form',
    input: z.object({ fragment_id: z.uuid(), label: optText }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const { data, error } = await sb
        .from('fragment_versions')
        .update({ kind: 'snapshot', label: input.label?.trim() || `Kept ${new Date().toISOString().slice(0, 10)}` })
        .eq('fragment_id', input.fragment_id)
        .eq('kind', 'working')
        .select('id')
        .maybeSingle();
      if (error) throw fail(error.message);
      if (!data) throw fail('There are no unsaved changes to keep', 'BAD_REQUEST');
      return { id: data.id };
    },
  }),

  /**
   * Drop a fragment's working version, by fragment rather than by version id.
   * Two callers, one meaning — "there is no pending rewrite any more":
   * a successful "Save changes" (the edits are now the piece) and an explicit
   * Discard. Idempotent, so neither has to know whether one existed.
   */
  discardWorking: defineAction({
    accept: 'form',
    input: z.object({ fragment_id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase
        .from('fragment_versions')
        .delete()
        .eq('fragment_id', input.fragment_id)
        .eq('kind', 'working');
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),

  /** Throw a version away. Hard delete — a version is already the safety net. */
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase.from('fragment_versions').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
};
