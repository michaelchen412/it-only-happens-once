# Backups

The corpus — every fragment in every status, the constellations that arrange
them, the vocabulary that describes them — lives in one hosted Supabase
Postgres. This page records how it's protected.

## The nightly dump

**[`michaelchen412/it-only-happens-once-backups`](https://github.com/michaelchen412/it-only-happens-once-backups)**
(private) runs a GitHub Actions workflow daily at 09:23 UTC that dumps the
database three ways — roles, schema, data — using the officially documented
`supabase db dump` trio, and commits the results under stable filenames.
**Git history is the archive**: any past day is `git show <commit>:data.sql`.

Design notes, so this isn't re-derived later:

- **It lives in a separate private repo** because this repo is public and the
  dump contains drafts and (eventually) private notes. Nothing about the
  backup — workflow, secret, or data — touches this repo.
- **GitHub Actions, not Vercel Cron**: Supabase's own documented CI-backup
  path, and none of the serverless limits (Hobby cron is daily ±59 min,
  300 s, 4.5 MB responses).
- **The connection secret is the Session pooler URI** (port 5432). GitHub
  runners are IPv4-only; Supabase direct connections are IPv6-only.
- **An implausibly small `data.sql` fails the run** instead of committing —
  a failed run emails; a silently-empty backup doesn't.
- Restore instructions live in that repo's README (the `psql
  --single-transaction` recipe, with triggers disabled during the data load).

## The storage archive

The same workflow then archives the **`site` bucket** — the About portrait and
every image in an essay — under `storage/site/**`, with a `storage/manifest.json`
recording each object's path, size and md5. Built 2026-07-31, the same day
[plan 03](plans/03-images-in-essays.md) made essays able to hold pictures.

It exists because of something this page previously got wrong: **`supabase db
dump` covers `auth.*` and `public.*` and nothing else.** There is no `storage.`
anything in `data.sql` — not the bytes, and not the metadata rows either. So the
bucket had no off-site copy *and* no record it had ever held a file.

- **An archive, not a mirror.** Files are only ever added, never removed. A
  backup that faithfully reproduces a deletion is not a backup — the day you
  most want it is the day something was deleted by mistake. The manifest holds
  current truth, so an orphan on disk stays identifiable.
- **Git stays healthy holding binaries** because essay images are
  content-addressed (`essays/{fragmentId}/{hash}.{ext}`): a changed picture is a
  new path, not a new version of an old one, so history is additive rather than
  a pile of binary diffs. `about/portrait.jpg` is the one fixed path.
- **Bytes come from the bucket's public URL** — the same one a reader uses — so
  a download failure is real news: it means published essays' pictures aren't
  being served.
- **It runs after the SQL is already committed and pushed**, so a rotated key or
  a bucket turned private can never cost a night of the database backup. It
  still fails the job, so the email still arrives.
- **One extra secret**, `SUPABASE_SERVICE_ROLE_KEY`, used only to *list* the
  bucket. Not a widening of trust: `SUPABASE_DB_URL` was already there and is a
  full Postgres connection that can do strictly more.

**Verified end to end on 2026-07-31**, in CI rather than locally: the workflow
ran green, downloaded the object on a GitHub runner, and the bytes fetched back
out of the repo are md5-identical to the bucket's etag.

## What the dump does not cover

**Nothing, currently** — and both entries that used to sit here were wrong.
Corrected 2026-07-31 by reading the committed `data.sql` rather than reasoning
about it:

- ~~Storage objects~~ — now archived, above.
- ~~Auth users are excluded by the CLI~~ — **they are not.** `auth.users`,
  `auth.identities` and the rest of the auth schema are all in `data.sql`, one
  row each. Re-creating the admin by hand is documented in [auth.md](auth.md)
  and remains the simpler restore path, but the rows are there.

## The rest of the safety story

- The **JSON fidelity export** (human-triggered, re-importable, includes
  positions and pages) is [plan 05 Piece 2](plans/05-export-backup.md) — not
  built yet.
- The **`content/` markdown mirror** — a two-way copy of the corpus as files,
  with a `push` script to write them back — was **cancelled on 2026-07-31 and
  should not be re-proposed.** Two of its four justifications had shipped as
  separate work by then (backup here, revision history as plan 07's
  `fragment_versions`), a third contradicted the admin's whole purpose, and
  `push` would have been a second write path into the corpus alongside the
  actions. It also created a sync problem — two representations that can both
  change — which is the same shape as the offline problem
  [ADR 0010](adr/0010-online-first-writing.md) had just removed, and this repo
  being public made a mirror of drafts and notes an outright hazard.

  **What it would have closed, and the cheap way to close it:** `data.sql` holds
  the prose as SQL `INSERT` statements — recoverable, since it's a text file,
  but not readable as prose. If that ever matters, write a **one-way** export:
  published pieces to `.md`, no `push`, no entry ramp, no second write path. An
  afternoon, and no architecture.
