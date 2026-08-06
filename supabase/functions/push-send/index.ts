// The sender (docs/plans/21-push.md · Phase 2, ADR-0019).
//
// ⚠ THE ONLY CODE IN THIS PROJECT THAT CAN MAKE A PHONE RING, and it lives
// outside `src/` on purpose. ADR-0019:
//
//   The scheduler is `pg_cron` + `pg_net` → a Supabase Edge Function. The trust
//   boundary stays where RLS already is, subscription rows never leave
//   Supabase, and the SITE's own domain gains no endpoint.
//
// Name the loser, because it is simpler and was rejected on purpose: a Vercel
// cron hitting `/api/push` with a shared secret. That costs an unauthenticated
// route on the live site and a secret in web env — the exact thing
// `src/actions/calendar.ts` congratulates itself on not having.
//
// ⚠ ITS OWN URL IS PUBLIC, and `verify_jwt` is NOT the answer. Any valid JWT
// satisfies that check, including the anon key, which is printed in the client
// bundle — so `verify_jwt: true` alone would let anyone with the public key
// make Michael's phone ring. This function is deployed with `verify_jwt: false`
// and does its own check against a DEDICATED secret. The weaker-looking setting
// is the stronger one; do not "fix" it.
//
// ⚠ AND THE SECRET IS ITS OWN, NOT THE SERVICE ROLE KEY. Two reasons, the
// second discovered the hard way on 2026-08-06:
//
//   1. Least privilege. The scheduler needs permission to ASK for a push, not
//      the master key to the whole database. `pg_cron` holds this string in
//      Vault; if it leaked, the blast radius is "somebody can make the phone
//      ring", not "somebody owns every row".
//   2. ⚠ `SUPABASE_SERVICE_ROLE_KEY` AS INJECTED HERE IS NOT THE KEY IN
//      `.env.local`. The platform injects the modern `sb_secret_…` form (41
//      chars); the repo's env file holds the legacy 219-char JWT. Both are
//      valid credentials for the API and they are DIFFERENT STRINGS, so a
//      string comparison against it fails for a reason nothing in the error
//      message would ever tell you. It cost a probe function to find.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { declarative, sendPush, type Vapid } from './webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('PUSH_CRON_SECRET');

function vapid(): Vapid | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Today's date in a named zone, as `YYYY-MM-DD`.
 *
 *  ⚠ THE ZONE IS RESOLVED HERE, IN CODE, NEVER IN THE SCHEDULE. `pg_cron` fires
 *  on UTC; HQ's day boundary is `settings.home_timezone`. A cron written as
 *  "7am" arrives at 3am in New York — and 2am for half the year, because the
 *  offset is not a constant. So the schedule is a plain hourly tick and the
 *  question "what day is it, where Michael is" is answered right here. */
function ymdIn(tz: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

  // ── authorization ────────────────────────────────────────────────────────
  // The caller is `pg_net`, invoked by `pg_cron`, reading the secret from Vault.
  //
  // ⚠ FAILS CLOSED IF THE SECRET IS UNSET. An absent `PUSH_CRON_SECRET` must
  // never mean "let everybody in" — on this function that would be an open door
  // to somebody else's phone. A misconfiguration should make the feature silent,
  // never loud.
  const auth = req.headers.get('Authorization') ?? '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return json({ error: 'unauthorized', configured: Boolean(CRON_SECRET) }, 401);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const mode: string = body.mode ?? 'send';

  // The one source of "today" (data-model.md §6b).
  const { data: settings } = await db.from('settings').select('home_timezone').limit(1).single();
  const tz = settings?.home_timezone ?? 'America/New_York';
  const ymd = ymdIn(tz);

  const keys = vapid();

  // ── diagnose ─────────────────────────────────────────────────────────────
  // ⚠ REPORTS THE PUBLIC KEY AND ONLY EVER THE PUBLIC KEY. The private half is
  // reported as present/absent and by length, never by value — the whole point
  // of this mode is to prove the pair MATCHES what the browser subscribes with,
  // which the public half alone settles.
  if (mode === 'diagnose') {
    const { count } = await db.from('push_subscriptions').select('*', { count: 'exact', head: true });
    return json({
      mode,
      timezone: tz,
      today: ymd,
      utcNow: new Date().toISOString(),
      vapidPublicKey: keys?.publicKey ?? null,
      vapidPrivateKeyPresent: Boolean(keys?.privateKey),
      vapidPrivateKeyLength: keys?.privateKey?.length ?? 0,
      vapidSubject: keys?.subject ?? null,
      subscriptions: count ?? 0,
      ready: Boolean(keys),
    });
  }

  if (!keys) return json({ error: 'VAPID secrets are not configured' }, 500);

  const title: string = body.title ?? 'Today: the check-in and 2 tasks';
  const navigate: string = body.navigate ?? 'https://itonlyhappensonce.blog/admin';

  // ── the claim ────────────────────────────────────────────────────────────
  // ⚠ THE INSERT *IS* THE CLAIM, and it happens BEFORE any sending. The tick is
  // hourly, so the guard against a second push cannot be the schedule — it has
  // to be the database. No row returned means somebody already sent today, and
  // that "somebody" includes a retry, a manual run, and the November hour that
  // happens twice when the clocks go back.
  //
  // `skipClaim` exists for testing and is deliberately not the default: a mode
  // that quietly bypassed the claim would make the one guarantee this function
  // offers untestable and untrue at the same time.
  if (!body.skipClaim) {
    const { data: claimed, error: claimErr } = await db
      .from('push_day_claims')
      .insert({ ymd })
      .select('ymd')
      .maybeSingle();
    if (claimErr && claimErr.code !== '23505') return json({ error: claimErr.message }, 500);
    if (!claimed) return json({ mode, today: ymd, skipped: 'already claimed', delivered: 0 });
  }

  const { data: subs, error } = await db.from('push_subscriptions').select('endpoint, p256dh, auth');
  if (error) return json({ error: error.message }, 500);
  if (!subs?.length) return json({ mode, today: ymd, delivered: 0, note: 'no devices subscribed' });

  const payload = declarative(title, navigate);
  const results: { endpoint: string; status: number | string }[] = [];
  let delivered = 0;
  const dead: string[] = [];

  for (const sub of subs) {
    if (mode === 'dry') {
      results.push({ endpoint: sub.endpoint.slice(0, 48), status: 'dry-run' });
      continue;
    }
    try {
      const status = await sendPush(sub, payload, keys);
      results.push({ endpoint: sub.endpoint.slice(0, 48), status });
      if (status >= 200 && status < 300) delivered++;
      // ⚠ 404/410 MEAN THE SUBSCRIPTION IS DEAD — the browser cleared it, the
      // app was uninstalled, or the service dropped it. The row must go, or the
      // sender accumulates endpoints that fail forever and every future run
      // spends time and log space on devices that no longer exist. This is the
      // one piece of error handling that is not optional.
      if (status === 404 || status === 410) dead.push(sub.endpoint);
    } catch (err) {
      results.push({ endpoint: sub.endpoint.slice(0, 48), status: String(err) });
    }
  }

  if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);
  if (mode !== 'dry') await db.from('push_day_claims').update({ delivered }).eq('ymd', ymd);

  return json({ mode, today: ymd, timezone: tz, delivered, pruned: dead.length, results });
});
