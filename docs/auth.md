# Authentication & security

*How the admin is secured and how the database is protected. Rationale in [ADR 0002](adr/0002-authentication-provider.md).*

---

## 1. Provider: Supabase Auth

Authentication is **Supabase Auth** — the same platform as the database. This is a **single-admin** site (only Michael ever signs in), so there are no roles, orgs, or multi-user concerns.

Chosen over a third-party provider (Clerk was briefly wired up, then reverted before shipping — see [ADR 0002](adr/0002-authentication-provider.md)) because it is **native**: authenticated requests carry a Supabase JWT, so RLS authorizes directly on `auth.uid()` / `auth.jwt()` with **no token bridging and no second dashboard**. It's free, and it covers what we want:

- **Google OAuth** — the primary, frictionless sign-in.
- **Passkeys (experimental/beta)** — passwordless WebAuthn, opt-in.

> Passkeys in Supabase Auth are **beta** ("may change without notice"). We accept that for a single-admin login; Google OAuth is the always-works fallback if the passkey API shifts.

## 2. Single-admin model

- The admin is identified by an **`app_metadata.role = "admin"`** claim, set once on Michael's user via the service role (app_metadata is not user-editable — only settable server-side — which is what makes it safe to trust in RLS).
- **Sign-ups are restricted.** Email sign-up is disabled (Google only), and we add a `before-user-created` auth hook / allowlist so only Michael's Google address can create an account. Belt-and-suspenders: even if another user somehow authenticated, `is_admin()` is false for them, so they get **zero** write access and no admin route.

## 3. Sign-in flows

**Google OAuth** (PKCE):
- `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<site>/auth/callback' } })`.
- Google client ID/secret are configured in the **Supabase dashboard** (Auth → Providers → Google), *not* in our env. The Google authorized redirect URI is Supabase's callback: `https://<ref>.supabase.co/auth/v1/callback`.
- A route at `/auth/callback` exchanges the code for a session (`exchangeCodeForSession`) and sets the auth cookies.

**Passkeys** (beta):
- Requires `@supabase/supabase-js` v2.105+ and the experimental opt-in flag on the client.
- After signing in once (via Google), Michael can **enroll a passkey** (`registerPasskey`) — a WebAuthn ceremony via `navigator.credentials.create()`. Subsequent logins can use the passkey directly.

> Exact API surface is verified against current Supabase docs at implementation time; shapes above are the design intent.

## 4. Sessions & SSR

Session handling uses **`@supabase/ssr`** (cookie-based), so the admin can be server-rendered and auth-gated:

- `createBrowserClient(...)` — client-side (OAuth redirect, passkey ceremonies).
- `createServerClient(...)` — server-side, reads/writes the auth cookies; used in SSR pages and API routes to get the current user.
- **Middleware** (`src/middleware.ts`) refreshes the session on each request and exposes the user to server routes.

Both live in `src/lib/supabase.ts`.

## 5. RLS integration (native)

Authenticated users automatically get the Postgres `authenticated` role and a real `auth.uid()`. Admin-ness is the `app_metadata.role` claim, checked through one helper:

```sql
create or replace function public.is_admin()
returns boolean language sql stable
set search_path = ''
as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) $$;
```

The RLS **policies are unchanged** — they already call `public.is_admin()`. Only the helper's body changes (from the earlier Clerk `user_role` claim to Supabase's `app_metadata.role`), applied via a follow-up migration. Recap:

- Public (`anon`) may `select` only `status = 'published'` fragments; lens/subject labels are readable.
- All writes (`insert`/`update`/`delete`) require `is_admin()`.
- Checks are wrapped in `(select …)` for per-statement caching; every policy targets an explicit role.

## 6. Secrets & environment

| Variable | Exposure | Purpose |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | public | anon key — safe in the browser; RLS restricts it; also what Supabase Auth uses client-side |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | seeds + one-off admin tasks (e.g. setting `app_metadata.role`); never in client code |

There are **no auth-provider keys** in our env — the Google OAuth client ID/secret live in the Supabase dashboard. This is a concrete simplification over the third-party approach.

## 7. Threat model (scope-appropriate)

One privileged user; otherwise public, intentionally-shared content.

- Only Michael can create/edit/delete → **RLS `is_admin()` + restricted sign-ups + Google/passkey login**.
- Drafts stay private → **RLS `status='published'` read gate**.
- No write-capable secret reaches the browser → **key hygiene above**; admin writes go through the authenticated user's session + RLS, never the service-role key.
- **Passkey beta risk** → Google OAuth remains a first-class fallback, so a passkey API change can never lock Michael out.

Out of scope: multi-tenant isolation, per-record ACLs, rate-limiting beyond the platform default.
