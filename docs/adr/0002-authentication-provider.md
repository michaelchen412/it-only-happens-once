# 0002 — Authentication provider

Status: Accepted (supersedes an initial, same-day decision to use Clerk)
Date: 2026-07-18

## Context

The site needs exactly one privileged user (Michael) who edits content through `/admin`; everything else is public, read-only content. So this is a **single-admin** problem — no roles, orgs, or multi-tenant isolation. The backbone is already Supabase.

We first adopted **Clerk** (for passkeys/MFA/device-management), wired it up, and verified it worked on Astro 7. On review two things changed the calculus: (1) Clerk's Astro SDK doesn't yet support Astro 7, forcing a `legacy-peer-deps` install; (2) more importantly, Supabase's own Auth now offers **Google OAuth and (beta) passkeys** natively — removing the only real reason to add a second vendor. Because no admin had been built yet, switching was nearly free.

## Decision

Use **Supabase Auth** — **Google OAuth** as the primary sign-in and **passkeys (beta)** as an opt-in passwordless method. RLS authorizes natively on the Supabase JWT via `public.is_admin()` (checking `app_metadata.role = 'admin'`). Sessions via `@supabase/ssr`. Details in [`auth.md`](../auth.md).

## Consequences

- **One vendor, one dashboard, native RLS** — no third-party token bridging; `auth.uid()` works directly. Simpler mental model and less config.
- **No auth-provider keys in our env** — Google credentials live in the Supabase dashboard.
- We drop `@clerk/astro` and the `legacy-peer-deps` workaround; the dependency tree is clean on Astro 7 again.
- **Passkeys are beta** ("may change without notice") — accepted because Google OAuth is a first-class fallback, so a passkey API change can't lock the admin out. This is the main downside we're taking on.
- We own a bit more of the sign-in UI (Supabase Auth is headless) vs. Clerk's drop-in components — fine for a single, simple admin login, and it lets the sign-in match our design system.

## Alternatives

- **Clerk** (initially chosen). Excellent components and passkeys are actually free — but it's a second vendor with a token-bridging step, and its Astro 7 support lags. Reverted in favor of the native option.
- **WorkOS AuthKit.** Free passkeys to 1M MAU, native Supabase third-party integration — the best *third-party* alternative. Kept in mind as the escape hatch if Supabase Auth's beta passkeys prove unstable.
- **Better Auth (self-hosted).** Free, full data ownership, passkey plugin — but we'd own the auth security surface and hand-wire RLS bridging. More responsibility than a single-admin site warrants.
