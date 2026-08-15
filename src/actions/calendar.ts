// The Google mirror's one write path — and it only ever writes OUR side
// (docs/plans/archive/13-agenda.md §2 and §8; ADR-0014).
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

      const full = v?.full === true;

      // ⚠ THE THROTTLE AND THE LOCK ARE THE SAME STATEMENT, AND THEY HAVE TO
      // BE. This used to read the row, decide, and only write minutes later
      // when Google finally answered — so every page opened inside that window
      // passed the same gate and started its own sync. On 2026-08-06 two of
      // them ran 127ms apart: one succeeded, the other caught a `503` and
      // stamped `last_error` over the success, and Today then reported a
      // mirror that was in fact perfectly current. No amount of care in the
      // error path fixes that; the read and the decision have to be one
      // operation that only one caller can win.
      //
      // So: a conditional UPDATE ... RETURNING. Postgres serialises the two
      // writers on the row, the loser re-evaluates `updated_at` against the
      // winner's fresh value, matches nothing, and is told it was skipped.
      //
      // ⚠ `updated_at` IS THE CLAIM, and it works because `moddatetime` stamps
      // it on EVERY update to this row (see the table's migration) — the claim
      // itself, the success, the failure. The value sent below is therefore
      // ignored; the trigger's `now()` wins. Sending it is what makes the
      // statement legal, not what sets the time.
      //
      // ⚠ AND IT IS A LEASE, NOT A LOCK, which is the property that matters
      // when a serverless invocation dies mid-sync: nothing has to be released.
      // The claim simply ages out, and the next visit is free to try again.
      const cutoff = new Date(Date.now() - RESYNC_AFTER_MINUTES * 60_000).toISOString();
      const claim = sb.from('calendar_sync').update({ updated_at: new Date().toISOString() }).eq('id', true);
      // A forced full sync still takes the claim — it may jump the throttle,
      // never the queue.
      const { data: state, error: claimError } = await (full ? claim : claim.lt('updated_at', cutoff))
        .select('*')
        .maybeSingle();

      // ⚠ A CLAIM THAT ERRORS IS NOT A THROTTLE. Both answer with no row, and
      // reporting `skipped` for both would file a mirror that can NEVER sync —
      // the policy revoked, the singleton row deleted — under the same quiet
      // answer a healthy ten-minute throttle gives. There is nowhere to record
      // it, since the row is the thing that failed, so it is handed back.
      if (claimError) return { configured: true, skipped: false, changed: 0, error: claimError.message };
      if (!state) return { configured: true, skipped: true, changed: 0, error: null };

      const tz = await homeTimezone(sb);

      try {
        const token = await accessToken(creds);
        let usingToken = full ? null : state.sync_token;
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
          const { error } = await sb.from('external_events').upsert(
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

        // ⚠ THE ERROR ON THIS WRITE IS CHECKED, and it is not ceremony. This is
        // the statement that stores the cursor and clears `last_error`; if it
        // fails silently the mirror reports itself broken for ever while
        // syncing perfectly, and re-syncs from scratch every time doing it.
        // Throwing hands it to the catch below, which is the one place that
        // knows how to record a failure.
        const { error: stateError } = await sb
          .from('calendar_sync')
          .update({
            // Keep the old cursor rather than clearing it if Google withheld a
            // new one: a null here forces a full sync next time, which is
            // correct but wasteful, and only ever right when we know it.
            sync_token: result.syncToken ?? (wasFull ? null : state.sync_token),
            synced_at: new Date().toISOString(),
            last_error: null,
            last_error_at: null,
          })
          .eq('id', true);
        if (stateError) throw new Error(stateError.message);

        return { configured: true, skipped: false, changed, error: null };
      } catch (err) {
        // ⚠ RECORDED, NOT THROWN. The page has already rendered from the mirror
        // by the time this runs, and a thrown error would put a red banner on
        // Today over something the reader cannot act on. `staleness()` speaks
        // instead, on the next render, and speaks immediately for an error
        // rather than waiting out the staleness window.
        //
        // ⚠ AND IT MAY OVERWRITE FREELY, because of the claim above and only
        // because of it: this sync is the only one that has run since it took
        // the claim, so there is no success of anyone else's to trample. A
        // transient fault has already been retried inside `gcal.ts` by the time
        // it reaches here, so anything recorded is a real one — Google was down
        // for seconds, or the credential is genuinely dead, and the stored
        // message now says which.
        const message = err instanceof Error ? err.message : 'Google couldn’t be reached.';
        const { error: recordErr } = await sb
          .from('calendar_sync')
          .update({ last_error: message.slice(0, 500), last_error_at: new Date().toISOString() })
          .eq('id', true);
        // ⚠ THE WRITE THAT RECORDS A FAILURE CAN ITSELF FAIL, and then there is
        // nowhere left to put it: `staleness()` reads the very row that just
        // refused us, so the mirror would go on looking healthy while being
        // neither fresh nor able to say so. Throwing would replace the real
        // error with a bookkeeping one and lose the reason entirely, so the log
        // is the honest destination and the caller still gets `message`.
        if (recordErr) console.error('[calendar.sync] could not record the failure:', recordErr.message);
        return { configured: true, skipped: false, changed: 0, error: message };
      }
    },
  }),
};
