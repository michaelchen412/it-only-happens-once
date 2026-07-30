# 0010 — The workshop is online-first; offline capture lives in iCloud Notes

Status: Accepted
Date: 2026-07-30

## Context

The goal that drives this whole application, in Michael's words: *"I don't want
to juggle between five different apps. I don't want to switch my mental model
every single time I have to use a different app."* One place for the full
breadth of what he has written — public and private, essays and quotes and
songs and loose notes.

A fear rode along with that goal: **losing hours of offline writing.** Every
route is `output: 'server'` with no `prerender` anywhere, so a failed save
leaves prose only in the editor's memory. A flight without Wi-Fi looked like it
could cost an afternoon. [Plan 09](../plans/09-offline-and-notes.md) was written
to remove that risk, and its first piece shipped on 2026-07-29: a
document-keyed IndexedDB outbox, optimistic-concurrency tokens, a drain loop
under a Web Lock, and 13 unit tests.

Then it met a human, and three things became clear.

**1. Testing found real defects immediately, twice.** The first adversarial
review found that `astro:actions` *throws* on a dead network rather than
returning an error — which made the entire offline branch unreachable. The
first ten minutes of human testing then found a close path that offered to
delete the very words the outbox had just saved. Both were invisible to
typecheck, build, and unit tests, because the feature's value lives in
interaction under changing network conditions and none of those tools sit in
the chair.

**2. iOS cannot drain a queue in the background — at all.** The Background Sync
API exists precisely to push queued work after the tab closes. Safari does not
support it, iOS 26 did not add it, and it is rated *unlikely soon*. So on the
iPad and phone — first-class targets — queued edits reach the server **only
when the app is next opened**, and no amount of engineering changes that. Native
apps like Obsidian get limited OS-scheduled background windows a web app can
never have, and even they largely reconcile on foreground.

**3. Nobody solves conflict resolution anyway.** iCloud Drive and Dropbox keep
"conflicted copy" files. Obsidian Sync keeps version history and asks. None of
them merge prose; even git punts to conflict markers. The state of the art for
consumer sync is *detect, keep both, let the human choose.*

Against that, the honest frequency estimate: **roughly one day in three hundred**
without connectivity. And on such a day, not writing — or writing somewhere
else — is a small cost.

## Decision

**The workshop is online-first. We are not building an offline-capable app.**

- The IndexedDB outbox and its drain machinery are **removed**, not deferred.
  Half-built offline support is worse than none: it invites trust it cannot
  honour, and it actively misled its author during testing.
- **Offline capture happens in iCloud Notes**, as a deliberate dumping ground,
  reconciled into the workshop when connectivity returns. Two mental models —
  *dump* and *sort later* — accepted knowingly, because they are cheaper than
  the sync engine that would remove them.
- **Optimistic concurrency stays.** `base_updated_at` compare-and-set is not
  offline machinery: it guards a hazard that exists fully online, when a stale
  tab on one device saves over an edit made on another. One person with two
  devices is exactly the profile that hits it.
- **Crash safety for published pieces moves server-side.** Published pieces
  save on explicit intent only, so a crash mid-edit loses that work — the local
  snapshot had been the only thing catching it. Its replacement is
  [plan 07](../plans/07-revision-history.md): editing a published piece
  autosaves into a **draft revision** on the server, and promotion to canonical
  is a deliberate, online act. No local store, no queue, no drain.

## Consequences

- **The app needs a network to load and to save.** There is no partial credit:
  no offline editing, no offline reading, no queue. This is the point — the
  behaviour is now honest and predictable rather than conditionally magical.
- **A tab left open on a plane still holds your words in the editor**, but
  nothing persists them. If that matters, copy them into Notes. Said plainly
  rather than implied.
- **The daily reconcile is manual, and that is a real chore** — a few times a
  year. Accepted.
- **We keep the smaller wins the experiment produced**: compare-and-set, the
  confirm-dialog queue, the TipTap `emitUpdate` fix, plain-English network
  errors, and the vitest harness.
- **The web manifest and app icons stay** ([09 Piece 4](../plans/09-offline-and-notes.md)),
  but their justification changes. They were built to earn the iOS
  home-screen storage exemption; with no local queue to protect, they are now
  simply a pleasant way to open the workshop. The favicon fix they carried —
  replacing Astro's default logo, which had shipped since the project was
  scaffolded — stands on its own.
- **A future session must not re-propose this from scratch.** That is what this
  record is for. If it is ever revisited, the trigger is not enthusiasm; it is
  a *repeated, logged* pattern of lost offline work.

## Alternatives

- **Full offline-first (service-worker shell + two-way corpus mirror).** The
  version that actually delivers "open any device, see everything, edit
  anywhere." Rejected on cost and risk: it is the product Obsidian charges a
  subscription for, maintained by one person, in a codebase whose verification
  loop had not yet caught two rounds of single-device offline bugs. Four
  bounded sessions was the honest estimate — for a capability worth roughly one
  day in three hundred.
- **Offline read-only mirror.** Genuinely cheaper (reads don't conflict) and it
  would have delivered "see the corpus anywhere." Rejected with the rest, since
  the goal it serves is the same one that turned out not to be worth its
  plumbing. This is the alternative to revive first if the decision is ever
  reopened.
- **Markdown files synced by a real product** (iCloud/Dropbox/Obsidian Sync
  moving a `content/` mirror). Attractive because it borrows someone else's
  solved sync rather than building one. Rejected for now because it reintroduces
  a second source of truth alongside the database, and because the file mirror
  is worth having for its own reasons — see
  [plan 09 Piece 3](../plans/09-offline-and-notes.md).
- **Leave the outbox in place, unfinished.** Rejected: dead complexity is a tax
  forever, and this particular dead complexity had already caused a false
  belief ("it doesn't seem to be persisting anything locally") in the one
  person it was built for.
