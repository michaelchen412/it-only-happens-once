// The sender (docs/plans/21-push.md · Phases 2–3, ADR-0019).
//
// ⚠ THE ONLY CODE IN THIS PROJECT THAT CAN MAKE A PHONE RING, and it lives
// outside `src/` on purpose. The trust boundary stays where RLS already is,
// subscription rows never leave Supabase, and the SITE's own domain gains no
// endpoint. Name the loser: a Vercel cron hitting `/api/push` with a shared
// secret — simpler, and it costs an unauthenticated route on the live site,
// which is the exact thing `src/actions/calendar.ts` is glad not to have.
//
// ⚠ ITS OWN URL IS PUBLIC, and `verify_jwt` is NOT the answer. Any valid JWT
// satisfies that check, including the anon key, which is printed in the client
// bundle — so `verify_jwt: true` alone would let anyone with the public key
// make Michael's phone ring. Deployed with `verify_jwt: false`, checking a
// DEDICATED secret instead. The weaker-looking setting is the stronger one.
//
// ⚠ AND THE SECRET IS ITS OWN, NOT THE SERVICE ROLE KEY. Least privilege — and
// the practical half, found 2026-08-06: `SUPABASE_SERVICE_ROLE_KEY` as injected
// here is the modern `sb_secret_…` form (41 chars), while `.env.local` holds the
// legacy 219-char JWT. Both are valid and they are DIFFERENT STRINGS, so a
// comparison against it fails for a reason no error message explains.
//
// ── ⚠ THE DUPLICATION THIS FILE OWES YOU AN EXPLANATION FOR ─────────────────
//
// `checkinSettled()` and `dueToday()` live in `src/lib/hq/attention.ts` and are
// re-implemented below, because Deno cannot import from the Astro app. ADR-0019
// accepted that and asked for one thing: keep it SMALL AND OBVIOUS. It is in
// `attention()` and nowhere else, it is commented against its original, and
// `mode: "check"` exists so the answer can be read without sending anything.
//
// ⚠ IF YOU CHANGE THE RULE IN `src/lib/hq/attention.ts`, CHANGE IT HERE. The
// failure is not a crash: it is the sidebar and the notification disagreeing
// about what today is waiting for, which nobody notices until the phone rings
// on a morning it should have stayed quiet.
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

/** Wall clock in a named zone: `{ ymd, hhmm }`.
 *
 *  ⚠ THE ZONE IS RESOLVED HERE, IN CODE, NEVER IN THE SCHEDULE. `pg_cron` fires
 *  on UTC; HQ's day boundary is `settings.home_timezone`. A cron written as
 *  "10am" arrives at 6am in New York — and 5am for half the year, because the
 *  offset is not a constant. So the schedule is a plain hourly tick and both
 *  "what day is it" and "what time is it, where Michael is" are answered here. */
function localNow(tz: string, at = new Date()): { ymd: string; hhmm: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  // `hour12: false` can render midnight as "24" in some ICU versions.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${hour}:${get('minute')}` };
}

type DB = ReturnType<typeof createClient>;

/**
 * What today is still waiting for — the Deno half of `src/lib/hq/attention.ts`.
 *
 * ⚠ PAST DUE IS NOT COUNTED, AND THAT IS THE LOAD-BEARING HALF.
 * [ADR-0013](../../../docs/adr/0013-absence-never-accumulates.md) forbids a
 * number that GROWS WHILE YOU ARE AWAY; `due_on = today` is what keeps the
 * count bounded by the number of task RULES. `<=` would be one character, would
 * look like a bug fix, and would turn this into the guilt engine the ADR exists
 * to prevent — on the loudest surface in the system.
 */
async function attention(db: DB, ymd: string): Promise<{ checkin: 0 | 1; tasks: number }> {
  // `checkinSettled()`: a SKIP is an answer, not a hole (ADR-0013 §4), and a
  // partial check-in counts as answered — "an unfinished check-in is a
  // check-in". Counting until every field was full would be a completeness
  // meter, which CheckinZone rejects by name.
  const { data: c } = await db
    .from('daily_checkins')
    .select(
      'skipped, bed_at, woke_at, got_up_at, asleep_at, sleep_latency, awakenings, sleep_quality, restedness, valence, arousal, dreamless, dream_body, sleep_aids, note',
    )
    .eq('log_date', ymd)
    .maybeSingle();

  const answers = c
    ? [
        c.bed_at,
        c.woke_at,
        c.got_up_at,
        c.asleep_at,
        c.sleep_latency,
        c.awakenings,
        c.sleep_quality,
        c.restedness,
        c.valence,
        c.arousal,
        c.dreamless,
        c.dream_body,
        c.sleep_aids,
        c.note,
      ].some((v) => v !== null && v !== '')
    : false;
  const settled = c?.skipped === true || answers;

  // `dueToday()`: due TODAY and not yet disposed of. Answering advances a
  // recurring task's date immediately and archives a one-off, so both filters
  // already exclude answered rows — the event check is belt and braces for the
  // window in between.
  const [{ data: due }, { data: events }] = await Promise.all([
    db.from('tasks').select('id').is('archived_at', null).eq('due_on', ymd),
    db.from('task_events').select('task_id').eq('occurred_on', ymd),
  ]);
  const answeredIds = new Set((events ?? []).map((e) => e.task_id));
  const tasks = (due ?? []).filter((t) => !answeredIds.has(t.id)).length;

  return { checkin: settled ? 0 : 1, tasks };
}

/**
 * The sentence, and nothing else.
 *
 * ⚠ IT NAMES WHAT IS WAITING, IT NEVER INSTRUCTS. *"Today: the check-in and 2
 * tasks"* — not *"You haven't checked in."* Same register as the rest of HQ,
 * and the difference between an instrument and a scold.
 */
function title(tasks: number): string {
  if (tasks <= 0) return 'Today: the check-in';
  return `Today: the check-in and ${tasks} ${tasks === 1 ? 'task' : 'tasks'}`;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

  // ⚠ FAILS CLOSED IF THE SECRET IS UNSET. An absent PUSH_CRON_SECRET must never
  // mean "let everybody in" — on this function that is an open door to somebody
  // else's phone. A misconfiguration should make the feature silent, never loud.
  const auth = req.headers.get('Authorization') ?? '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return json({ error: 'unauthorized', configured: Boolean(CRON_SECRET) }, 401);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const mode: string = body.mode ?? 'send';

  const { data: settings } = await db.from('settings').select('home_timezone, push_time').limit(1).single();
  const tz = (settings?.home_timezone as string) ?? 'America/New_York';
  const pushTime = ((settings?.push_time as string) ?? '10:00').slice(0, 5);
  const { ymd, hhmm } = localNow(tz);
  const keys = vapid();

  if (mode === 'diagnose') {
    const { count } = await db.from('push_subscriptions').select('*', { count: 'exact', head: true });
    return json({
      mode,
      timezone: tz,
      today: ymd,
      localTime: hhmm,
      pushTime,
      utcNow: new Date().toISOString(),
      vapidPublicKey: keys?.publicKey ?? null,
      vapidPrivateKeyPresent: Boolean(keys?.privateKey),
      vapidSubject: keys?.subject ?? null,
      subscriptions: count ?? 0,
      ready: Boolean(keys),
    });
  }

  // ── the condition ────────────────────────────────────────────────────────
  //
  // ⚠ THIS IS THE WHOLE DIFFERENCE BETWEEN A TRIPWIRE AND AN ALARM CLOCK, and
  // it is the reason this feature is allowed to exist at all.
  //
  // `attention.total` counts the check-in as 1 UNTIL IT IS ANSWERED. So a push
  // that fired merely because the hour arrived would fire 365 days a year —
  // including every day the habit held — which is the ping you learn to swipe
  // away, and therefore the destruction of the signal. Michael, 2026-08-06:
  // *"I don't need a reminder … I need to already have that ingrained within
  // me."*
  //
  // So the trigger is a CONDITION, not a schedule: speak only on a day the
  // check-in is still open when the hour comes. Most days: silence.
  const { checkin, tasks } = await attention(db, ymd);
  const pastTime = hhmm >= pushTime;
  const wouldSend = pastTime && checkin === 1;
  const reason = !pastTime ? `before ${pushTime}` : checkin === 0 ? 'check-in already answered' : 'check-in still open';

  if (mode === 'check') {
    const { count } = await db.from('push_subscriptions').select('*', { count: 'exact', head: true });
    const { data: claim } = await db.from('push_day_claims').select('ymd').eq('ymd', ymd).maybeSingle();
    return json({
      mode,
      timezone: tz,
      today: ymd,
      localTime: hhmm,
      pushTime,
      pastTime,
      checkinOpen: checkin === 1,
      tasksDue: tasks,
      alreadyClaimed: Boolean(claim),
      subscriptions: count ?? 0,
      wouldSend: wouldSend && !claim,
      reason,
      title: title(tasks),
    });
  }

  if (!keys) return json({ error: 'VAPID secrets are not configured' }, 500);

  // ⚠ THE CONDITION IS CHECKED BEFORE THE CLAIM, and the order matters. Claiming
  // first would burn the day's single slot on an hour when there was nothing to
  // say — so a check-in skipped at 9am would be met with silence, because the
  // 8am tick had already spent the claim on "nothing to do here".
  if (!body.force && !wouldSend) {
    return json({ mode, today: ymd, localTime: hhmm, sent: false, reason, tasksDue: tasks });
  }

  // ⚠ DEVICES ARE LOADED BEFORE THE DAY IS CLAIMED, and the order is deliberate.
  // The claim is the day's single slot; spending it when there is nobody to
  // reach would mean a subscription made at 11am gets silence, because the 10am
  // tick already burned the claim on an empty table. It also keeps
  // `push_day_claims` honest as the record of days this thing actually SPOKE,
  // which is the evidence for whether the hour is set right.
  const { data: subs, error } = await db.from('push_subscriptions').select('endpoint, p256dh, auth');
  if (error) return json({ error: error.message }, 500);
  if (!subs?.length) return json({ mode, today: ymd, sent: false, delivered: 0, reason: 'no devices subscribed' });

  // ⚠ THE INSERT *IS* THE CLAIM. The tick is hourly, so the guard against a
  // second push cannot be the schedule — it has to be the database. No row
  // returned means somebody already sent today, and that "somebody" includes a
  // retry, a manual run, and the November hour that happens twice.
  if (!body.skipClaim) {
    const { data: claimed, error: claimErr } = await db
      .from('push_day_claims')
      .insert({ ymd })
      .select('ymd')
      .maybeSingle();
    if (claimErr && claimErr.code !== '23505') return json({ error: claimErr.message }, 500);
    if (!claimed) return json({ mode, today: ymd, sent: false, reason: 'already claimed', delivered: 0 });
  }

  const payload = declarative(body.title ?? title(tasks), body.navigate ?? 'https://itonlyhappensonce.blog/admin');
  const results: { endpoint: string; status: number | string }[] = [];
  let delivered = 0;
  const dead: string[] = [];

  for (const sub of subs) {
    if (mode === 'dry') {
      results.push({ endpoint: sub.endpoint.slice(0, 48), status: 'dry-run' });
      continue;
    }
    try {
      const status = await sendPush(sub as never, payload, keys);
      results.push({ endpoint: sub.endpoint.slice(0, 48), status });
      if (status >= 200 && status < 300) delivered++;
      // ⚠ 404/410 MEAN GONE — the browser cleared it, the app was uninstalled,
      // or the service dropped it. The row must go, or the sender accumulates
      // endpoints that fail forever.
      //
      // ⚠ AND 400 DOES NOT, WHICH IS NOT AN OVERSIGHT. A 400 can mean OUR OWN
      // encryption is wrong — so pruning on it would delete every subscription
      // in the building on the day a crypto bug shipped. Proven on 2026-08-06:
      // a malformed endpoint answers 400, and this correctly left it alone.
      if (status === 404 || status === 410) dead.push(sub.endpoint as string);
    } catch (err) {
      results.push({ endpoint: sub.endpoint.slice(0, 48), status: String(err) });
    }
  }

  if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);
  if (mode !== 'dry') await db.from('push_day_claims').update({ delivered }).eq('ymd', ymd);

  return json({
    mode,
    today: ymd,
    timezone: tz,
    sent: true,
    title: title(tasks),
    delivered,
    pruned: dead.length,
    results,
  });
});
