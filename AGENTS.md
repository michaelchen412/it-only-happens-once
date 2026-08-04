## Git — work on `main`

**Commit straight to `main`. Do not open a branch or a PR unless asked for one.**
This is a one-person repo built in small increments, and the branch/PR round trip
costs more than it protects. *(Set 2026-08-04, after a groundwork PR left local
`main` and `origin/main` divergent and VS Code's Sync refused to run.)*

- ⚠ **Pushing `main` is a production deploy** to Vercel. Assume anything you
  commit publishes.
- `pull.rebase` is set to `true` locally, so Sync in VS Code replays local
  commits on top of the remote instead of failing with "divergent branches".
- **Stage explicitly** (`git add <path>`), never `git add -A` — Michael edits
  concurrently, and unrelated work should not ride along in a commit.
- **Never mix a reformat with a behaviour change.** If a commit is formatting
  only, say so and add its hash to `.git-blame-ignore-revs`.

## Before you commit

```
npm run verify     # format:check + lint + astro check + test
```

A pre-commit hook (husky + lint-staged) formats and lints **staged files only**
— fast on purpose, so it never gets bypassed. Prettier owns all formatting;
ESLint carries no style rule. ⚠ **Green checks are necessary and nowhere near
sufficient** — see `docs/architecture.md` §9a.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
