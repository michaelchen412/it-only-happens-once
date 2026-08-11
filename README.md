# It Only Happens Once

A personal site built on one claim: **you can show someone how you think by
giving them something to walk through, rather than telling them on an about
page.** The medium is the proof. Nobody should have to read "systems thinker" —
they should navigate a structure that is one.

The name is the thesis rather than a title. A jazz solo happens once and is
gone; a thing can matter *because* it happened at one particular once, and this
is built to honour that instead of converting it into a tidy lesson.

## The model

Everything shareable is a **fragment** — an essay, a quote, a song, each able to
stand alone. Fragments are gathered into **constellations**, and the whole
design turns on what a constellation is: **a way of seeing, not a topic.**

A topic is what a piece is *about*. A way of seeing travels across subjects. So
"leadership" is not a constellation — it is a **subject**, a quiet tag — and a
post about humility in management lives in the *humility* constellation, beside
fragments that have nothing to do with work. Membership is by resonance, a bar
high enough to be self-limiting: a healthy constellation holds five to fifteen
fragments, and the sky stays apprehensible on one screen.

Inside a constellation the order is **composed, like a jazz set or the stanzas
of a poem** — what sits next to what carries meaning. Not sorted by date; date
sorting is an abstention from authorship. Which is why the result is meant to be
walked rather than scrolled.

## Where it is

The site is at **itonlyhappensonce.blog** — or it will be. That domain still
resolves to the Squarespace blog this replaces, and moving DNS is the last step.
Until it happens every host answers `Disallow: /` deliberately, so that a second
copy cannot establish itself under a hostname nobody meant to publish;
[`src/lib/robots.ts`](src/lib/robots.ts) carries the full argument.

## What it is

One Astro application with three surfaces:

- **The public site** — the Sky (constellation overview and typeset suites), the
  blog (writing, quotes and music, with search and subject filters), and About.
- **The Workshop** — where the corpus is written and groomed: the fragment
  manager, the composer, draft versions, constellations, the Library.
- **HQ** — a private daily dashboard: the morning check-in, people, the agenda,
  notes. It is a second domain rather than a feature of the first; nothing in it
  ever becomes public content.

Single author, single admin. Astro (SSR on Vercel) · Supabase (Postgres + Auth +
Storage) · Tailwind and daisyUI · TypeScript throughout.

All three surfaces are built and live; what is open is rough edges rather than
new rooms. [`docs/README.md`](docs/README.md) owns that answer and keeps it
dated.

## Running it

```sh
npm install
npm run dev        # astro dev
npm run verify     # format:check + lint + astro check + test  (~22s)
```

⚠ **It will not come up from a clone, and it is not meant to.** This is one
person's site rather than a template: it wants a Supabase project with this
schema and its RLS applied, and credentials for Google OAuth, Anthropic, Resend,
Turnstile, Spotify and web push. [`.env.example`](.env.example) and
[`docs/auth.md`](docs/auth.md) §6 are the two places that describe them.

`verify` is the gate, and literally one: `npm run build` runs it first, and
Vercel's build command is `npm run build` — so a failing check fails the build
and the last good deployment keeps serving. A pre-commit hook formats and lints
staged files.

## How the repo is kept

Three habits do most of the work here, and each is visible in the tree rather
than aspirational.

- **`docs/` describes the app as it stands; an ADR holds the reasoning.** A
  superseded narrative left in a doc is worse than no narrative, because it
  reads as current. The rule was set after `architecture.md` spent a week
  describing a pre-HQ app that used an editor we had already replaced.
- **Decisions are numbered, and the index states when one is owed** — three
  questions, all three yes ([`docs/adr/`](docs/adr/)). An ADR is immutable once
  accepted, and immutability binds the *claim*, not the *pointers*: a stale link
  may be repaired in place, a premise may not.
- **Several invariants are held by tests rather than by memory** — that every
  action begins with `requireAdmin`, that no action call is ever awaited bare,
  that the e2e suite stays read-only against the live project. Each is a test
  with a named allowlist, because a rule enforced by discipline is a rule with a
  schedule for failing.

⚠ **Green checks are necessary and nowhere near sufficient** —
[`docs/architecture.md`](docs/architecture.md) §9a says why, at length.

## The documentation

**[`docs/`](docs/) is the real front door** — start at
[`docs/README.md`](docs/README.md), which says what to read in what order.

| | |
|---|---|
| How it is assembled and rendered | [`docs/architecture.md`](docs/architecture.md) |
| The schema, and how the domain maps to it | [`docs/data-model.md`](docs/data-model.md) |
| Auth, RLS, secrets | [`docs/auth.md`](docs/auth.md) |
| Every private surface | [`docs/admin.md`](docs/admin.md) |
| Search and match-highlighting | [`docs/search.md`](docs/search.md) |
| What protects the corpus | [`docs/backups.md`](docs/backups.md) |
| Why each major choice was made | [`docs/adr/`](docs/adr/) |

Nothing about the build is duplicated here, deliberately — a second copy is a
copy that goes stale, which is the fault this file was rewritten to stop
repeating.

Three documents referenced from `docs/` are **not in this repository**:
`vision.md` (the product thesis), `design.md` (the visual system) and
`about-michael.md` (who it is for). They are personal working files, git-ignored
on purpose, and those dead links are the intended state rather than rot. What it
costs a reader is the *why* behind the model — which is why the top of this file
carries it directly, and why
[ADR 0024](docs/adr/0024-the-sky-is-navigation.md) exists at all: to give an
argument that had been governing the Sky from inside `design.md` an address a
stranger can reach.

## Licence

Two, because this repository holds two different kinds of work:

- **The software** — `src/`, `scripts/`, `supabase/`, `tests/`, and the root
  config — is **MIT**. See [`LICENSE`](LICENSE).
- **The writing** — `docs/` (including every ADR), this file, and the site's
  written content — is **CC BY-NC-ND 4.0**. See [`LICENSE-docs`](LICENSE-docs).

GitHub shows one licence per repository and it reads `LICENSE`, so the sidebar
says *MIT* — true of the code, and silent about the prose, which is why the
split is said out loud here as well.

The essays and quotes themselves live in a database rather than in this
repository, and are not licensed by either file.
