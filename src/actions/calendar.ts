// The Google mirror's one write path — and it only ever writes OUR side
// (docs/plans/13-agenda.md §2 and §8; ADR-0014).
//
// ⚠ THERE IS NO SCHEDULER IN THIS REPO, and this piece does not add one. The
// plan called for `events.watch` push channels renewed on a schedule; the
// nightly backup that was named as the precedent lives in a *different*
// repository, so there is no cron here to hang it on — and the live calendar
// gets about one real event a month. So the mirror refreshes **when a page that
// shows it is opened**, throttled by `RESYNC_AFTER_MINUTES`.
//
// That is not a compromise so much as a better fit: freshness lands exactly
// where it is needed, an incremental sync that finds nothing costs one HTTP
// call, and there is no unauthenticated endpoint and no shared secret for a
// cron to hold. The cost is honest and is stated in `staleness()`: the mirror
// is only ever as fresh as your last visit.
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { requireAdmin, type DB } from './_shared';
import { homeTimezone } from '../lib/hq/time';
import { SyncTokenExpired, accessToken, credentials, listEvents } from '../lib/hq/gcal';
import { RESYNC_AFTER_MINUTES, SYNC_WINDOW_DAYS, isCancelled, toRow, type MirrorRow } from '../lib/hq/mirror';

export interface SyncResult {
  /** False when the four Google secrets are not set — not an error. */
  configured: boolean;
  /** True when the mirror was fresh enough to leave alone. */
  skipped: boolean;
  /** How many rows changed. The client reloads only when this is non-zero. */
  changed: number;
  /** What went wrong, already recorded on `calendar_sync`. */
  error: string | null;
}

/** Pages until Google stops offering more, or the ceiling is hit. */
const MAX_PAGES = 20;

interface Harvest {
  rows: MirrorRow[];
  /** Cancellation stubs: an id and a status, with no times to insert. */
  cancelledIds: string[];
  syncToken: string | null;
}

async function harvest(
  creds: NonNullable<ReturnType<typeof credentials>>,
  token: string,
  tz: string,
  syncToken: string | null,
): Promise<Harvest> {
  const rows: MirrorRow[] = [];
  const cancelledIds: string[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  // Only a full sync may name a window — with a `syncToken`, `timeMin` is
  // refused outright (see `listEvents`).
  const timeMin = syncToken ? undefined : new Date(Date.now() - SYNC_WINDOW_DAYS * 86_400_000).toISOString();

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listEvents(creds, token, {
      syncToken: syncToken ?? undefined,
      pageToken,
      timeMin,
    });

    for (const item of res.items) {
      const row = toRow(item, tz);
      // A cancellation arrives carrying an id and a status and nothing else, so
      // there is nothing to insert. It is an UPDATE on a row that may not exist
      // — and if it does not, ignoring it is right: we never had it.
      if (!row) {
        if (isCancelled(item)) cancelledIds.push(item.id);
        continue;
      }
      rows.push(row);
    }

    // ⚠ A LARGE CHANGESET RETURNS A `pageToken` INSTEAD OF A `syncToken`, and
    // the token only appears on the LAST page. Stopping early would mean
    // storing no cursor and doing a full sync for ever after.
    if (!res.nextPageToken) {
      nextSyncToken = res.nextSyncToken ?? null;
      return { rows, cancelledIds, syncToken: nextSyncToken };
    }
    pageToken = res.nextPageToken;
  }

  // ⚠ RUNNING OUT OF PAGES IS LOUD, NOT QUIET. Falling out of the loop would
  // store a partial mirror and no cursor — a calendar that is wrong and a sync
  // that starts from scratch every time, neither of which announces itself.
  // 20 × 250 is five thousand events in one changeset; if that is ever real,
  // the assumptions in this file are wrong and somebody should hear about it.
  throw new Error('The calendar returned more pages than this sync will walk.');
}

export const calendar = {
  /**
   * Pull whatever changed, and say how much.
   *
   * Admin only — there is no unauthenticated path to this, which is the whole
   * reason sync-on-view was chosen over a cron endpoint with a shared secret.
   */
  sync: defineAction({
    accept: 'json',
    input: z.object({ full: z.boolean().optional() }).optional(),
    handler: async (v, ctx): Promise<SyncResult> => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const creds = credentials();
      if (!creds) return { configured: false, skipped: true, changed: 0, error: null };

      const { data: state } = await sb.from('calendar_sync').select('*').maybeSingle();
      const full = v?.full === true;

      // ⚠ THE THROTTLE IS ON THE SERVER, not only in the script that calls it.
      // It also covers `last_error_at`, which is what stops a failing sync from
      // being retried on every navigation — and, with the client's rule that a
      // failure never triggers a reload, is why this cannot loop.
      const lastTouch = Math.max(
        state?.synced_at ? Date.parse(state.synced_at) : 0,
        state?.last_error_at ? Date.parse(state.last_error_at) : 0,
      );
      if (!full && Date.now() - lastTouch < RESYNC_AFTER_MINUTES * 60_000) {
        return { configured: true, skipped: true, changed: 0, error: null };
      }

      const tz = await homeTimezone(sb);

      try {
        const token = await accessToken(creds);
        let usingToken = full ? null : (state?.sync_token ?? null);
        let result: Harvest;
        let wasFull = usingToken === null;

        try {
          result = await harvest(creds, token, tz, usingToken);
        } catch (err) {
          // ⚠ `410 GONE` IS AN INSTRUCTION, NOT AN ERROR. It means "drop your
          // state and do a full sync", and the plan's wrinkle 3 is explicit
          // that logging it and carrying on with a stale mirror is the failure
          // mode to avoid. So it retries once, from nothing.
          if (!(err instanceof SyncTokenExpired)) throw err;
          usingToken = null;
          wasFull = true;
          result = await harvest(creds, token, tz, null);
        }

        let changed = 0;
        // One stamp for the whole sync, and it is load-bearing — see the
        // reconciliation below, which uses it as its key.
        const stamp = new Date().toISOString();

        if (result.rows.length) {
          // ⚠ UPSERT, NEVER TRUNCATE-AND-RELOAD (ADR-0014). Annotations key off
          // `external_id`, and even though `event_people.external_id` is not a
          // foreign key — so nothing would cascade — a reload leaves a window
          // in which the mirror is empty and Today is wrong.
          const { error } = await sb
            .from('external_events')
            .upsert(
              result.rows.map((r) => ({ ...r, synced_at: stamp })),
              { onConflict: 'external_id' },
            );
          if (error) throw new Error(error.message);
          changed += result.rows.length;
        }

        if (result.cancelledIds.length) {
          const { error } = await sb
            .from('external_events')
            .update({ cancelled: true, synced_at: stamp })
            .in('external_id', result.cancelledIds);
          if (error) throw new Error(error.message);
          changed += result.cancelledIds.length;
        }

        // ⚠ FULL-STATE RECONCILIATION, AND STILL NOT A DELETE. On a full sync
        // anything inside the window that Google did not return is gone from
        // Google — but it is marked, not removed, so an annotation you wrote on
        // it stays legible instead of vanishing. Deletions on an *incremental*
        // sync arrive as stubs above and never reach here.
        //
        // ⚠ KEYED ON THE STAMP THIS SYNC JUST WROTE, not on a list of ids. The
        // first version sent `not.in.(…every id seen…)`, which is correct and
        // is a URL that grows with the calendar — it works at seventeen rows
        // and fails at a size nobody will ever test. "Older than this sync"
        // says the same thing in constant space.
        if (wasFull && result.rows.length) {
          const windowStart = new Date(Date.now() - SYNC_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
          const { error } = await sb
            .from('external_events')
            .update({ cancelled: true })
            .gte('starts_on', windowStart)
            .eq('cancelled', false)
            .lt('synced_at', stamp);
          if (error) throw new Error(error.message);
        }

        await sb
          .from('calendar_sync')
          .update({
            // Keep the old cursor rather than clearing it if Google withheld a
            // new one: a null here forces a full sync next time, which is
            // correct but wasteful, and only ever right when we know it.
            sync_token: result.syncToken ?? (wasFull ? null : (state?.sync_token ?? null)),
            synced_at: new Date().toISOString(),
            last_error: null,
            last_error_at: null,
          })
          .eq('id', true);

        return { configured: true, skipped: false, changed, error: null };
      } catch (err) {
        // ⚠ RECORDED, NOT THROWN. The page has already rendered from the mirror
        // by the time this runs, and a thrown error would put a red banner on
        // Today over something the reader cannot act on. `staleness()` speaks
        // instead, on the next render, and speaks immediately for an error
        // rather than waiting out the staleness window.
        const message = err instanceof Error ? err.message : 'Google couldn’t be reached.';
        await sb
          .from('calendar_sync')
          .update({ last_error: message.slice(0, 500), last_error_at: new Date().toISOString() })
          .eq('id', true);
        return { configured: true, skipped: false, changed: 0, error: message };
      }
    },
  }),
};
