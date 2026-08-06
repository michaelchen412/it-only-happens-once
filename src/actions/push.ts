// ============================================================================
// Web push subscriptions (docs/plans/21-push.md · Phase 2, ADR-0019).
//
// ⚠ THE WRITE PATH FOR THE ONLY FEATURE THAT CAN INTERRUPT MICHAEL. Everything
// else in this folder edits things he came and asked to see; a row written here
// is standing permission for the building to make his phone ring. That is the
// reason `subscribe` is reachable ONLY from a real user gesture in the browser
// (iOS refuses a permission prompt on load, permanently) and the reason `forget`
// exists beside it as a first-class action rather than a support procedure.
//
// ── NO SERVICE WORKER IS INVOLVED IN ANY OF THIS ────────────────────────────
//
// Declarative Web Push: the browser subscribes from the page via
// `window.pushManager`, and WebKit renders the payload itself. So there is no
// worker to register, no `pushsubscriptionchange` handler running in the
// background — and therefore no place for a subscription to repair itself while
// the app is closed. `touch` below is what replaces that, and it is why the
// installed app re-asserts on every load.
//
// ⚠ THE SENDER DOES NOT COME THROUGH HERE. It is a Supabase Edge Function using
// the service role, which bypasses RLS by design — that is what lets a schedule
// run with nobody signed in. These three actions are the BROWSER's half, and
// they carry Michael's cookie session like every other action in this folder.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';

/**
 * What `PushSubscription.toJSON()` gives, narrowed to what we store.
 *
 * ⚠ `endpoint` IS THE IDENTITY — see the migration. It is not a URL we ever
 * fetch from the browser, so it is validated as a URL only to refuse obvious
 * junk, never to decide who may receive a push.
 */
const subscription = z.object({
  endpoint: z.string().url('That is not a push endpoint'),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

export const push = {
  /**
   * Store (or refresh) this device's subscription.
   *
   * An upsert on the endpoint, because the honest answer to "have I subscribed
   * before?" is one the browser cannot reliably give: a subscription survives
   * reinstalls sometimes and not others, and asking first would be a round trip
   * whose answer we would then ignore. Re-subscribing with the same endpoint is
   * not an error and must not read as one.
   */
  subscribe: defineAction({
    accept: 'json',
    input: subscription.extend({ userAgent: z.string().max(500).optional() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const { error } = await sb.from('push_subscriptions').upsert(
        {
          endpoint: v.endpoint,
          p256dh: v.p256dh,
          auth: v.auth,
          user_agent: v.userAgent ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      );
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),

  /**
   * "This device is still here."
   *
   * ⚠ THIS IS THE NO-SERVICE-WORKER ANSWER TO SUBSCRIPTION ROT, and it is the
   * reason the installed app calls it on every load. With a worker,
   * `pushsubscriptionchange` would fire in the background and repair the row
   * without anybody present. Without one, the only moment we can learn that a
   * subscription is alive is a moment the app is open — so we take every one.
   *
   * Deliberately NOT an upsert: a `touch` for an endpoint we have never seen is
   * not a subscription, it is a stale client, and inventing a row for it would
   * make the table's own count of devices a lie. It returns `known: false` and
   * the caller subscribes properly.
   */
  touch: defineAction({
    accept: 'json',
    input: z.object({ endpoint: z.string().url() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const { data, error } = await sb
        .from('push_subscriptions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('endpoint', v.endpoint)
        .select('endpoint');
      if (error) throw fail(error.message);
      return { known: (data?.length ?? 0) > 0 };
    },
  }),

  /**
   * Stop pushing to this device.
   *
   * ⚠ SILENCEABLE FROM INSIDE THE APP IS A REQUIREMENT, NOT A COURTESY. A
   * feature you can only turn off by deleting the app is one you delete the app
   * to turn off — and on iOS the alternative is Settings archaeology two menus
   * deep. Deleting the row is the strongest possible form of off: the sender
   * cannot reach a device it has no endpoint for, so this cannot fail open.
   *
   * `forget`, not `unsubscribe`, because the browser-side call is also named
   * `unsubscribe()` and the two do different halves of one job — the browser
   * retires the endpoint, this retires the row. Both should happen; only this
   * one is load-bearing.
   */
  forget: defineAction({
    accept: 'json',
    input: z.object({ endpoint: z.string().url() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', v.endpoint);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
};
