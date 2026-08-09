# Authentication & security

*How the admin is secured and how the database is protected. Rationale in [ADR 0002](adr/0002-authentication-provider.md).*

---

## 1. Provider: Supabase Auth

Authentication is **Supabase Auth** — the same platform as the database. This is a **single-admin** site (only Michael ever signs in), so there are no roles, orgs, or multi-user concerns.

Chosen over a third-party provider (Clerk was briefly wired up, then reverted before shipping — see [ADR 0002](adr/0002-authentication-provider.md)) because it is **native**: authenticated requests carry a Supabase JWT, so RLS authorizes directly on `auth.uid()` / `auth.jwt()` with **no token bridging and no second dashboard**. It's free, and it covers what we want:

- **Google OAuth** — and it is the *only* sign-in method. [`/sign-in`](../src/pages/sign-in.astro) renders one button, *Continue with Google*, and nothing else.

> ⚠ **Passkeys are not built, and this file said otherwise for three weeks.**
> [ADR 0002](adr/0002-authentication-provider.md) took Supabase's beta WebAuthn
> support as an opt-in second method on 2026-07-18; **no WebAuthn code has ever
> existed in this repo** — no `registerPasskey`, no `navigator.credentials`, no
> opt-in flag. §3 below used to carry the API shapes with a disclaimer saying
> they were "the design intent", which is the tell: design intent belongs in an
> ADR or a plan, and a doc that describes it in the present tense is a doc a
> reader has to test before trusting. The ADR stays exactly as written — it
> records what was decided that day, and ADRs are immutable — and **this file
> records what runs.** If passkeys are ever built, they arrive with their own
> ADR, not by quietly restoring this paragraph.

## 2. Single-admin model

- The admin is identified by an **`app_metadata.role = "admin"`** claim, set once on Michael's user via the service role (app_metadata is not user-editable — only settable server-side — which is what makes it safe to trust in RLS).
- **Sign-ups are restricted.** Email sign-up is disabled (Google only), and a `before-user-created` auth hook / allowlist means only Michael's Google address can create an account. Belt-and-suspenders: even if another user somehow authenticated, `is_admin()` is false for them, so they get **zero** write access and no admin route.

## 3. The sign-in flow

**Google OAuth** (PKCE), and there is no second one:

- The button in [`sign-in.astro`](../src/pages/sign-in.astro) calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<origin>/auth/callback?next=/admin' } })` from a client `<script>`.
- Google client ID/secret are configured in the **Supabase dashboard** (Auth → Providers → Google), *not* in our env. The Google authorized redirect URI is Supabase's callback: `https://<ref>.supabase.co/auth/v1/callback`.
- [`/auth/callback`](../src/pages/auth/callback.ts) exchanges the code for a session (`exchangeCodeForSession`) and sets the auth cookies. **`?next=` is filtered before it is followed** — root-relative only, never `//evil.com` or `/\evil.com` — so the return leg can't be turned into an open redirect. Anything else lands on `/sign-in?error=auth`.

## 4. Sessions & SSR

Session handling uses **`@supabase/ssr`** (cookie-based), so the admin can be server-rendered and auth-gated:

- `createServerClient(...)` — server-side, reads the auth cookies off the request and writes refreshed ones onto the response; used in middleware, SSR pages and API routes. It is wrapped as `createSupabaseServerClient` in [`src/lib/supabase.ts`](../src/lib/supabase.ts), which is the **only** place it is constructed.
- `createBrowserClient(...)` — client-side, and it is **not** in `supabase.ts`. It is imported inside the `<script>` that needs it, at three sites: [`sign-in.astro`](../src/pages/sign-in.astro) (the OAuth redirect), [`AdminLayout.astro`](../src/layouts/AdminLayout.astro) (sign-out, behind a dynamic `import()` — the client is 218 KB raw for one button pressed once a session), and [`scripts/upload.ts`](../src/scripts/upload.ts) (storage uploads carrying the signed-in session, so an upload is authorized by storage RLS rather than by a service key).
- **Middleware** ([`src/middleware.ts`](../src/middleware.ts)) validates and refreshes the session on each request and puts the request-bound client on `locals`. It calls **`getClaims`**, which verifies the JWT signature locally against the cached JWKS — not `getUser`, which round-trips to the Auth server on every request (44ms → 1ms), and deliberately not `getSession`, whose user object Supabase says not to authorize on. The `role !== 'admin'` gate below it *is* an authorization decision.

⚠ **So "both client factories live in `supabase.ts`" is false, and was never true of the browser half.** Keeping it out of that module is what stops server code being pulled into the browser bundle.

## 5. RLS integration (native)

Authenticated users automatically get the Postgres `authenticated` role and a real `auth.uid()`. Admin-ness is the `app_metadata.role` claim, checked through one helper:

```sql
create or replace function public.is_admin()
returns boolean language sql stable
set search_path = ''
as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) $$;
```

The RLS **policies are unchanged** — they already call `public.is_admin()`. Only the helper's body changes (from the earlier Clerk `user_role` claim to Supabase's `app_metadata.role`), applied via a follow-up migration. Recap:

- Public (`anon`) may `select` only `status = 'published'` fragments; constellation/subject labels are readable.
- All writes (`insert`/`update`/`delete`) require `is_admin()`.
- Checks are wrapped in `(select …)` for per-statement caching; every policy targets an explicit role.

## 6. Secrets & environment

**The whole table, and it is ten rows rather than three.** It listed only the Supabase keys until 2026-08-09 while [`architecture.md`](architecture.md) §10 pointed here for "the full table" — so five integrations' worth of configuration existed only in the code that read it, and a fresh deploy's missing key was discoverable by watching a feature quietly not work.

| Variable | Exposure | Read by | Purpose |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | public | everything | Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | public | everything | anon key — safe in the browser; RLS restricts it; also what Supabase Auth uses client-side |
| `PUBLIC_TURNSTILE_SITE_KEY` | public | [`ContactForm.astro`](../src/components/ContactForm.astro) | the Cloudflare Turnstile widget on /about. Unset ⇒ the widget simply doesn't render |
| `PUBLIC_VAPID_PUBLIC_KEY` | public | [`scripts/push.ts`](../src/scripts/push.ts) | the `applicationServerKey` the installed app subscribes with. Public **by construction** — it travels in every subscription request. Unset ⇒ the notifications dialog says *unconfigured* and names this variable, which it did not always do (§9 of [admin.md](admin.md)) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | scripts, the e2e session mint | seeds + one-off admin tasks (e.g. setting `app_metadata.role`). **Never in request-handling code and never in client code** — RLS is the boundary ([architecture.md](architecture.md) §6) |
| `ANTHROPIC_API_KEY` | **server only** | [`actions/fragments.ts`](../src/actions/fragments.ts), [`actions/tasks.ts`](../src/actions/tasks.ts) | **three tenants**: ✦ Suggest with AI ([ADR 0007](adr/0007-ai-subject-tagging.md)), the capture parser ([admin.md](admin.md) §5d) and Proofread ([admin.md](admin.md) §5e) |
| `SPOTIFY_CLIENT_ID` | **server only** | [`lib/media.ts`](../src/lib/media.ts) | Spotify Web API, client-credentials — song title/artist/album/year |
| `SPOTIFY_CLIENT_SECRET` | **server only** | [`lib/media.ts`](../src/lib/media.ts) | the other half. Both unset ⇒ lookups fall back to keyless oEmbed, which is a tier and not a failure ([admin.md](admin.md) §6) |
| `RESEND_API_KEY` | **server only** | [`actions/site.ts`](../src/actions/site.ts) | sends the /about contact form |
| `TURNSTILE_SECRET_KEY` | **server only** | [`actions/site.ts`](../src/actions/site.ts) | verifies the Turnstile token server-side — the half that actually gates the send |

**How they are read is itself a security property.** The `PUBLIC_*` four are `import.meta.env` and are **inlined into the client bundle at build time** — that is what "public" means here, and it is why nothing else may ever take that prefix. The six server-only ones go through `getSecret()` from `astro:env/server`, which reads the runtime environment, so an unset key is a sentence in the UI rather than a build failure or a 500.

**Three more secrets exist and are deliberately *not* in this app's env** — they belong to Supabase, because that is where the code holding them runs ([admin.md](admin.md) §9):

| Variable | Where it lives | Purpose |
|---|---|---|
| `VAPID_PRIVATE_KEY` | Edge Function secret | signs the push; the private half of `PUBLIC_VAPID_PUBLIC_KEY`, and it never leaves the function |
| `VAPID_SUBJECT` | Edge Function secret | the `mailto:` a push service contacts about a misbehaving sender |
| `PUSH_CRON_SECRET` | Edge Function secret **and** a Postgres Vault entry | the sender's own authorization. It is stored twice because Postgres reads one and Deno reads the other, and it is **not** the service-role key: `verify_jwt` would be satisfied by the anon key, which is printed in the client bundle. The function **fails closed** — absent secret is 401 |

There are **no auth-provider keys** in our env — the Google OAuth client ID/secret live in the Supabase dashboard. This is a concrete simplification over the third-party approach.

## 7. Threat model (scope-appropriate)

One privileged user; otherwise public, intentionally-shared content.

- Only Michael can create/edit/delete → **RLS `is_admin()` + restricted sign-ups + Google login**.
- Drafts stay private → **RLS `status='published'` read gate**.
- No write-capable secret reaches the browser → **key hygiene above**; admin writes go through the authenticated user's session + RLS, never the service-role key.
- **One sign-in method is one dependency** → a Google outage is a lockout, and that is the trade taken. The recovery path is Supabase's own dashboard, which is a separate credential on a separate vendor — which is exactly why the passkey ambition in [ADR 0002](adr/0002-authentication-provider.md) was worth having and is worth an honest "not built" (§1) rather than a paragraph implying a fallback exists.

Out of scope: multi-tenant isolation, per-record ACLs, rate-limiting beyond the platform default.
