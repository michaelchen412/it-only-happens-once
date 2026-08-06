# 0019 — Push: HQ may reach you when nothing is open, and only when you asked it to

Status: **Proposed** *(the decision is taken — settled in conversation
2026-08-06 and proven on the real phone the same day. It becomes **Accepted**
when the scheduled sender actually speaks, per this repo's pattern that an ADR
is written when the decision is made and published when it is load-bearing.)*
Date: 2026-08-06

## Context

**Every surface in HQ so far answers a question Michael came and asked.** Today,
the check-in, the agenda, the drift list — all of them wait to be opened. The
building has never spoken first, and that is not an accident of what got built:
[ADR-0013](0013-absence-never-accumulates.md) is an entire decision about not
letting a system accumulate grievances and present them, and it ends by
requiring that any feature wanting to count things-not-done be checked against
it first.

Plan 20 ran that check and moved the line from *never count* to:

> A room may signal what is **addressed to you, bounded, resolvable today, and
> self-resetting**. It may never signal **accumulation**.

That admitted a numeral in a sidebar. **A notification is not a numeral.** It
arrives on a locked phone, it makes a sound, and it cannot be declined by simply
not looking — which is exactly how a sidebar pill is declined. So the line plan
20 drew is necessary here and nowhere near sufficient.

### What was actually asked for, twice

The request that opened this was small: 2026-08-04, *"some apps have a little
number on the top right corner of the icon. For example, Basecamp does this…"*

The request that survived contact with a real phone was not that. On 2026-08-06,
having seen a real push arrive, Michael separated the ask into two halves
himself, and **the halves point in opposite directions**:

- **He does not want to be reminded of his routine.** *"I don't need a reminder
  necessarily to do my sleep check-in… This is because eventually this app is
  going to be something that I really becomes a daily habit for me. The
  notification telling me 'Hey, do your sleep check-in' is noise because I need
  to already have that ingrained within me."* A daily nudge toward the routine
  is redundant when the habit holds and useless when it does not.
- **He does want to be hounded about things he flagged.** *"Currently it's hard
  to find a to-do app that actually persistently reminds me… it needs to warn me
  one hour before, two hours before, maybe a day before, and a week before… it
  should keep bugging me. Currently the to-do apps or reminder apps are not
  persistent enough, meaning they get too easily buried under everything else."*

And of the icon numeral that started it all, after seeing it: *"admittedly I
dont really care about that icon having a count. Not a big deal."*

### Three things this repo deliberately lacks

Each is a decision somebody already made on purpose, and push needs all three
reopened or routed around:

1. **A scheduler.** [`src/actions/calendar.ts`](../../src/actions/calendar.ts)
   opens by explaining that the nightly backup lives in another repository,
   *"so there is no cron here to hang it on… there is no unauthenticated
   endpoint and no shared secret for a cron to hold."* The calendar dodged this
   with sync-on-view. **Push cannot** — the entire point is to arrive when no
   page is open.
2. **A service worker.** [ADR-0010](0010-online-first-writing.md) removed an
   offline outbox within two days of shipping it and named its reopen trigger:
   *"the trigger is not enthusiasm; it is a repeated, logged pattern of lost
   offline work."*
3. **A public unauthenticated endpoint on the site.**

## Decision

**HQ may originate a message. It does so under two different contracts, and
confusing them is the failure mode this ADR exists to prevent.**

### Contract 1 — the ambient signal (what plan 20 already governs)

Bounded, self-resetting, addressed to you, resolvable today. The daily push is
this contract's only voice, and it is **conditional, not scheduled**: it fires
at a chosen hour **only if the check-in is still unanswered**, so a day that
goes normally produces silence.

⚠ **The conditionality is load-bearing, not a nicety.** `attention.total` counts
the check-in as 1 until it is answered, so an unconditional morning push would
fire **365 days a year** — which is precisely the daily ping a person learns to
swipe away, and therefore the destruction of the signal. *Never notify on a
schedule; notify on a condition.*

### Contract 2 — the escalation contract (new, and the one with the value)

**Michael, at task creation, explicitly signs one task up for escalation.** The
system never volunteers it. It then warns on a ladder as the deadline
approaches and, once overdue, **repeats until the task is done, skipped, or
explicitly acknowledged.**

This is not the system judging him; it is delegated vigilance, the way an alarm
clock is. Nobody experiences their own alarm clock as a scold. It passes plan
20's line clause by clause: *addressed to you* because you addressed it to
yourself; *bounded* to one named task and a finite ladder; *resolvable* by doing
or acknowledging; *self-resetting* when the task resolves. And it does not
breach *never enumerates arrears*: the ambient count still excludes past due
permanently, and a ladder push names **one task you flagged**, never a count of
what has piled up.

⚠ **Scarcity is the load-bearing wall, and it is enforced in the schema.** Only
a small number of tasks may hold a contract at once, refused at both doors —
the same shape as the five-goal cap. What buries reminders in every other app is
habituation: a nag that is not rare becomes the baseline. **If every task can be
critical, within a month none of them are.**

### The machinery

- **No service worker.** Declarative Web Push (iOS 18.4+/Safari 18.4+) delivers
  a fixed JSON payload that WebKit renders itself — display, tap-navigation,
  badge — with no JavaScript woken on the device. Subscription is via
  `window.pushManager`. **Proven on the real phone 2026-08-06** before any of
  this was built.
- **The scheduler is `pg_cron` + `pg_net` → a Supabase Edge Function.** The
  trust boundary stays where RLS already is, subscription rows never leave
  Supabase, and **the site's own domain gains no endpoint** — the property
  `calendar.ts` names.
- **The tick is a plain UTC cadence and the day boundary is resolved in code**
  from `settings.home_timezone`. `pg_cron` fires on UTC; a schedule written as
  "7am" is 3am in New York, and 2am for half the year.
- **The insert is the claim.** A send is preceded by claiming a row for that
  local day; a claim that cannot insert means somebody already sent it. This is
  the calendar sync's fix (`f5bb568`) applied to a louder surface, and it is
  what makes retries, manual runs and **the DST repeat hour** harmless.
- **Prune on 404/410.** Those two codes mean the subscription is dead; the row
  is deleted or the sender accumulates endpoints that fail forever.
- **One subscription row per device**, re-asserted by the app on load — the
  no-service-worker answer to subscription rot.

### What is NOT built

- **No icon badge from push.** `app_badge` was sent, accepted, delivered and
  ignored by the device on 2026-08-06, and Michael declined the chase. The
  numeral is set only by the running app
  ([`scripts/attention.ts`](../../src/scripts/attention.ts)). ⚠ **Its absence is
  a decision on evidence, not an unsolved bug** — reopening it needs a new
  reason, not the observation that `app_badge` exists in the spec.
- **No `fetch` handler, no `Cache` API, no offline anything.** ADR-0010 is
  untouched and remains the live decision. Should a service worker ever arrive
  for offline writing, it needs *that* ADR's trigger — logged lost work — and
  this decision neither supplies it nor stands in its way.

## Consequences

- **HQ can now interrupt.** That is a genuinely new power for this project, and
  every future feature that wants to use it is subject to the two contracts
  above. A third contract is a new ADR, not an extension of this one.
- **The sender is Deno and lives outside `src/`.** One more place to look, and
  it cannot import from `src/lib/hq/` — so any rule it shares with the app (what
  counts as "today", what `attention.total` means) is **duplicated**, which is
  the standing risk this creates. Keep the duplication small and obvious.
- **The Edge Function's URL is public** and must authenticate its caller. What
  stays true is the narrower claim: the *site* gains no new surface. The earlier
  framing of "no new public endpoint at all" was too generous and is corrected
  here.
- **Push cannot break through Do Not Disturb, Focus modes, or the silent
  switch.** Apple reserves time-sensitive and critical-alert interruption levels
  for native apps. **The ladder's persistence is repetition across time, not
  interruption force** — which is what was asked for, but a phone face-down on
  silent stays a phone face-down on silent.
- **Delivery is minutes-precise, not seconds-precise** — cron tick plus push
  latency. A "one hour before" rung means "within a few minutes of an hour
  before".
- **On iOS this requires a Home Screen install**, and the installed app has
  isolated storage — so it asks for one sign-in of its own. Installing from
  Chrome's share sheet works; Safari is not required.
- **Notifications are visible by contract.** WebKit permits no silent push. So
  every message this system sends is one a person hears, which is the reason the
  conditions above are conditions and not preferences.
- **A new silent failure mode: the schedule stops and nothing says so.** The
  same shape ADR-0014 named for the calendar mirror. `push_day_claims` is the
  record that makes it answerable — a day with no row is a day nothing was sent,
  and whether that was correct is then a question with evidence behind it.

## Alternatives

**Vercel Cron hitting an `/api/push` route with a shared secret.** Simplest to
build, and it concedes exactly what `calendar.ts` congratulates itself on not
having: an unauthenticated route on the live site and a secret in web env.
Rejected for that, not for difficulty.

**GitHub Actions in the backups repository.** It already has a schedule. Wrong
home — that repository backs things up, and giving it a second unrelated
responsibility is how a backup job quietly becomes a general-purpose cron with
production credentials.

**A classic service worker with a `push` handler.** Necessary before iOS 18.4
and unnecessary now. It would resurrect the ADR-0010 conversation for no gain,
and the file would sit there inviting a future `fetch` handler — the exact
mechanism that turned into an offline outbox last time.

**Silent, badge-only pushes.** The feature as originally imagined: a numeral
appears, nothing makes a sound. **Not available** — WebKit requires every push
to display a notification, and this is platform law rather than a reliability
caveat. Discovering it late would have made the whole feature a surprise; it is
why the loudness question was asked and answered before anything was built.

**An unconditional daily push at a fixed time.** What plan 21 originally
specified. Rejected on the arithmetic above: it fires every single day, and a
daily notification that is usually unremarkable is one you stop reading and then
stop seeing.

**No push at all — keep the tab title and the sidebar pill.** The status quo,
and genuinely sufficient for the *ambient* half. It is rejected because it makes
the escalation contract unbuildable, and that half is the one thing the tools
Michael already uses do not do.

**A native app.** Would buy critical alerts and time-sensitive interruption
levels — the only way past a Focus mode. Enormous, for one user, to make a
notification louder rather than better-timed.
