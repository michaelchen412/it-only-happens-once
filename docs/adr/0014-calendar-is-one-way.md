# 0014 — The calendar is one-way: Google reads in, HQ owns the personal

Status: **Accepted** *(2026-08-03, with the mirror it governs — `external_events`,
the incremental sync, and the read-only credential that enforces it. Until that
existed this was a plan; it is now a shape.)*
Date: 2026-07-31 · **Context corrected 2026-08-03 against the live calendar —
see "What the calendar actually contains".**

## Context

HQ's central surface is Today: *what is happening now, and what is coming*. Its
value collapses if it is not the whole picture.

But Michael's calendar is not fully his own. Things arrive in a **Google
account** that he did not type there. Two facts follow:

- **A calendar that cannot receive what arrives dies.** Without import, every
  externally-created entry needs re-entry by hand, the agenda is wrong within a
  week, and Today stops being trustworthy — at which point he opens Google
  anyway and HQ has failed at the one job it was built for.
- **Nothing in HQ can accept an invitation.** Responding to an invite is a
  Google-account action with its own semantics (RSVP, guest lists, notifications
  to other people). Reimplementing that is a project, not a feature.

The obvious answer — full two-way sync — is a trap this codebase has already
paid to learn about. [ADR 0010](0010-online-first-writing.md) removed an offline
outbox within two days of shipping it, and the reasoning generalises exactly:

> Two representations that can both change means reconciliation and divergence.

That ADR names the shape, and the plans repeat it when explaining why the
`content/` markdown mirror was cancelled: *"Files-vs-database is that problem
wearing a different hat."* **HQ-vs-Google is the same problem in a third hat** —
with the added difficulty that the remote side is owned by other people, so
conflicts are not even Michael's to resolve.

Confirmed with Michael 2026-07-31: *"read only one way view from google for
calendar events, e.g. conference calls, other events people invited me to etc.
and everything personal gets sourced from our db."*

### ⚠ What the calendar actually contains — corrected 2026-08-03

**The draft of this ADR justified the mirror by invitations, and the live
calendar does not support that.** Read end to end before the mirror was built —
one year back and unbounded forward, 48 events:

| | | |
|---|---|---|
| **31** | `birthday` | one person, expanded annually to 2057 |
| **9** | `fromGmail` | flights, hotel stays, restaurant and cinema bookings |
| **8** | `default` | test events from one afternoon |

**One event of the forty-eight was created by somebody else**, and at the time of
writing there were **no future events at all** that were not Google's generated
birthdays.

The decision below is unchanged — it is if anything easier to defend, since
there is even less reason to write back — but **what the mirror is FOR is
different from what the draft said.** It carries **things Michael did not type
and would never type into HQ**: a flight number, a hotel, a table booked by
email. Roughly one a month, and each one is exactly what you want on the day.

This is written down rather than quietly fixed because the difference changes
what "the mirror stopped being worth it" would look like later. If invitations
never materialise, that is not evidence against this decision; if Gmail stops
extracting bookings, that is.

## Decision

**The calendar integration is one-way and read-only. HQ never writes to Google.**

The line between the two:

| | Owner | Writable in HQ |
|---|---|---|
| Events other people created, and anything Gmail extracts | Google | **no** |
| Personal events, blocks, plans he schedules himself | HQ | yes |
| Tasks and recurring chores | HQ | yes |
| Birthdays | HQ (`people`) — derived, not rows | n/a |

- **Google events are mirrored** into `external_events`, keyed by
  `external_id`, and rendered as visibly read-only: **fill means writable**, and
  a mirrored row has none.
- **HQ layers annotations on top** — person tags — keyed on the **series**. This
  is **additive**: it adds information Google does not have and never modifies
  anything Google owns, so it cannot produce a conflict.
- **The mirror upserts and marks, never truncates and reloads.** Annotations
  reference the series id; a truncate-and-reload leaves a window in which the
  mirror is empty and Today is wrong. Events deleted upstream are flagged
  `cancelled`, not deleted.
- **The credential is `calendar.events.readonly`.** The one-way rule is not a
  convention this code observes — it is the only thing the token permits, which
  is the cheapest enforcement available and survives somebody later deciding a
  small write "wouldn't hurt".
- **Ingest is the Google Calendar API with incremental `syncToken`.** *(This
  reverses the draft, which said to start with the secret ICS feed. Settled
  2026-08-01: the ICS feed is refreshed on a delay of hours, which is the one
  thing that hurts a page whose job is "what is my day", and a published OAuth
  app turned out to need no verification review.)*
- **Google's auto-generated birthdays are dropped at ingest.** HQ derives
  birthdays from `people.birth_month/day` and renders them as a mark rather than
  a row, so importing Google's would put two differently-drawn entries on one
  day. HQ's derivation is strictly better: it knows who the person is and
  carries their lead time.
- **The mirror refreshes when a page that shows it is opened**, throttled, rather
  than on a schedule. There is no scheduler in this repository, the calendar
  changes about monthly, and sync-on-view needs no unauthenticated endpoint and
  no shared secret. The cost is stated plainly: the mirror is only ever as fresh
  as the last time somebody looked.

## Consequences

- Today can be trusted as the complete picture without HQ owning the hard part.
- **RSVPs, invitations and edits to shared events still happen in Google.** This
  is a real, permanent context-switch that HQ does not remove, and it is the
  central cost of this decision. It is bounded: responding is a small, occasional
  act, unlike the daily act of *seeing what is on*.
- No conflict-resolution machinery, ever. No merge UI, no "which version wins",
  no divergence to debug.
- **A new silent failure mode: staleness.** If the sync stops, Today is
  confidently wrong. So the mirror's health is visible — but **only when it is
  bad**: nothing at all while it is working, one quiet line on Today and in the
  Agenda room once it has been a day, and an immediate one on an error.
- **A person-tag attaches to the SERIES, not the occurrence.** With
  `singleEvents=true` the mirror receives instances whose ids are not stable
  across a reschedule, so an annotation keyed on one orphans silently. A
  recurring personal event is a standing arrangement — the same people are in it
  every time. If occurrence-level tagging ever earns itself, the safe key is
  `(recurringEventId, originalStartTime)`, never the instance id.
- **The mirror stores local dates and times, not instants.** Google gives
  all-day events no instant at all, and the grid counts days in the home zone —
  so the conversion happens once, at ingest. The consequence, accepted: change
  `settings.home_timezone` and the mirror is wrong until it is resynced.
- **A `410 GONE` is an instruction, not an error.** It means the sync token is
  dead; the code drops its cursor and does a full sync rather than logging and
  carrying on with a stale mirror.
- Deleting an upstream event orphans its annotations. Marking rather than
  deleting keeps them legible instead of vanishing.
- **The secret is an OAuth refresh token**, not a feed URL — it belongs in env,
  never in the database or the repo. It does not expire, because the app is
  published rather than in Testing.

## Alternatives

**Two-way sync.** The apparent ideal: one place to do everything. Rejected on
the reasoning of [ADR 0010](0010-online-first-writing.md) — it manufactures a
reconciliation problem this project has already decided is not worth solving,
and the remote side is co-owned by other people, so divergence is not even fully
Michael's to resolve. It also requires write scopes on his primary calendar,
which is a large blast radius for a single-user tool.

**HQ owns everything; abandon Google entirely.** Clean, and it fails the moment
a flight confirmation lands in Gmail. Double-entry follows, and double-entry
means the agenda is wrong.

**Google owns everything; HQ just reads.** Removes the split, and gives up the
thesis: tasks, chores, birthdays and cadence are not calendar events, and
cramming them into Google is exactly the shape that made the existing tools fit
his mental model badly.

**Embed the Google Calendar iframe in Today.** Free, live, correct — and it
cannot merge HQ tasks, birthdays or people into the same view, which is the only
reason Today exists.

**A service account plus calendar sharing.** Would have removed the consent
question entirely: no OAuth flow, no refresh token, nothing to expire. **Tried
on 2026-08-01 and it does not work on a consumer account** — the service account
authenticates fine, but `events.list` returns 404 after sharing, because sharing
outside a domain sends an invitation email that the recipient must accept and a
service account has no inbox. The pattern is widely reported as working because
the reports come from Google Workspace accounts.

**A scheduled sync (`events.watch` push channels, renewed weekly).** What the
plan originally specified. Rejected once the calendar was read: it requires a
scheduler this repository does not have, a public webhook endpoint, and channel
renewal as its own recurring job — all to keep a calendar current that changes
about once a month.
