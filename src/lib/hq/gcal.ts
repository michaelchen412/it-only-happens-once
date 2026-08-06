// The Google Calendar client — read-only, and structurally so
// (docs/plans/13-agenda.md §2; ADR-0014).
//
// ⚠ SERVER ONLY. `astro:env/server` is imported below, exactly as `media.ts`
// does for Spotify. Nothing in `src/scripts/` may import this file.
//
// ⚠ AND IT CAN ONLY READ. The token is minted from a refresh token whose scope
// is `calendar.events.readonly` — narrower than `calendar.readonly` — so the
// one-way rule is not a convention this code observes, it is the only thing the
// credential permits. That is the cheapest possible enforcement of ADR-0014,
// and it survives somebody deciding a small write "wouldn't hurt".
//
// AUTH IS ALREADY DONE and is not this piece's problem: Michael published the
// OAuth app on 2026-08-01 and consented once. A published app's refresh token
// does not expire (the seven-day rule is a *Testing*-status rule), so there is
// no re-consent story and nothing to renew.
import { getSecret } from 'astro:env/server';
import type { GoogleEvent } from './mirror';

export interface Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

/**
 * The four secrets, or null if the integration is not set up.
 *
 * Null rather than a throw, and it is the difference between "no calendar" and
 * "broken calendar": a deployment without these keys should render a page with
 * no mirror on it, not an error. 10-hq.md §10b — a domain that does not exist
 * renders nothing.
 */
export function credentials(): Credentials | null {
  const clientId = getSecret('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = getSecret('GOOGLE_OAUTH_CLIENT_SECRET');
  const refreshToken = getSecret('GOOGLE_OAUTH_REFRESH_TOKEN');
  const calendarId = getSecret('GOOGLE_CALENDAR_ID');
  if (!clientId || !clientSecret || !refreshToken || !calendarId) return null;
  return { clientId, clientSecret, refreshToken, calendarId };
}

/**
 * A failure from Google's side, carrying the one thing the caller cannot work
 * out for itself: whether trying again could possibly help.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE POINT, AND COLLAPSING IT COSTS AN AFTERNOON.
 * A `503` from the token endpoint and an `invalid_grant` arrive the same shape
 * and are nothing alike: the first is Google having a bad minute, the second is
 * a credential that will not work again until a human re-consents. This file
 * used to report both as *"Google refused the refresh token (503)"* — which
 * reads as a dead credential, so the reader goes and re-authenticates the one
 * thing that was never wrong. Written down on 2026-08-06, after exactly that.
 */
export class GoogleError extends Error {
  constructor(
    message: string,
    /** True when the fault was Google's and a later attempt may well succeed. */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'GoogleError';
  }
}

/**
 * The statuses that mean "Google, not us" — the only ones worth repeating.
 *
 * ⚠ `410` IS DELIBERATELY ABSENT and must stay absent: it is an instruction to
 * re-sync from scratch (see `SyncTokenExpired`), and retrying it would just
 * collect the same answer three times before acting on it.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Three attempts, so a single blip costs a few hundred ms instead of a day. */
export const MAX_ATTEMPTS = 3;

/**
 * The wait before attempts 2 and 3.
 *
 * ⚠ NO JITTER, ON PURPOSE. Jitter disperses a thundering herd, and there is no
 * herd here: the claim in `actions/calendar.ts` guarantees one sync in flight
 * at a time, for one person. Randomness would buy nothing and cost
 * reproducibility, which is the worse trade for something this hard to observe.
 */
const BACKOFF_MS = [250, 1_000];

/** The longest a `Retry-After` may hold an admin's page render. */
const MAX_BACKOFF_MS = 5_000;

/**
 * ⚠ A FETCH WITH NO TIMEOUT IS NOT A FETCH, IT IS A HANG. Sync runs inside a
 * request, so a connection Google never answers would hold a serverless
 * invocation open until the platform kills it — and the mirror would record
 * nothing at all, which is the one outcome worse than recording a failure.
 */
const TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Google's own advice on when to come back, in ms, if it offered any. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  // The header is either a count of seconds or an HTTP date. Both appear.
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, MAX_BACKOFF_MS);
}

/**
 * One request to Google, repeated while — and only while — repeating it could
 * help. Returns the response for anything the caller must interpret itself
 * (`200`, `400`, `401`, `410`); throws a transient `GoogleError` when the
 * attempts run out.
 *
 * A dead socket and a `503` are the same event as far as this is concerned, and
 * both are transient: the distinction that matters is *Google's fault or ours*,
 * not *network or HTTP*.
 */
async function fetchGoogle(url: string, init: RequestInit, what: string): Promise<Response> {
  let failure = `${what} could not be reached.`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // A timeout or a dead network. `fetch` rejects rather than answering.
      failure = `${what} did not answer within ${TIMEOUT_MS / 1_000}s.`;
    }

    // Anything the caller is expected to read — including a `4xx` — is its
    // business, not ours. Only Google's own faults are repeated.
    if (res && !RETRYABLE.has(res.status)) return res;
    if (res) failure = `${what} is unavailable (${res.status}).`;

    if (attempt === MAX_ATTEMPTS - 1) break;
    await sleep((res && retryAfterMs(res)) ?? BACKOFF_MS[attempt]);
  }

  throw new GoogleError(failure, true);
}

/**
 * A short-lived access token, cached for as long as it is good for.
 *
 * The cache is module scope, which on a serverless host means "for as long as
 * this instance happens to live" — a real saving when it survives and harmless
 * when it does not. Sixty seconds are shaved off the expiry so a token cannot
 * expire in flight.
 */
let cached: { token: string; until: number } | null = null;

/**
 * ⚠ CALLED WHEN GOOGLE SAYS THE TOKEN IS NO GOOD DESPITE THE CLOCK SAYING IT
 * IS. Without this a single spurious `401` would be cached as a good token for
 * up to an hour, and every sync in that hour would fail the same way for a
 * reason that had already gone away.
 */
function forgetToken() {
  cached = null;
}

export async function accessToken(creds: Credentials): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;

  const res = await fetchGoogle(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    },
    'Google’s token service',
  );

  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!res.ok || !body?.access_token) {
    // Google's own faults were already retried and rethrown above, so anything
    // still failing here is the credential itself — terminal, and the one case
    // where re-consenting is genuinely the fix.
    const detail = body?.error_description ?? body?.error ?? `HTTP ${res.status}`;
    throw new GoogleError(`Google refused the refresh token (${detail}).`, false);
  }

  cached = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
  return cached.token;
}

export interface EventsPage {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** Thrown for `410 GONE` alone, so the caller can tell it apart from a failure. */
export class SyncTokenExpired extends Error {
  constructor() {
    super('Sync token is no longer valid, a full sync is required.');
    this.name = 'SyncTokenExpired';
  }
}

/**
 * One page of `events.list`.
 *
 * ⚠ THE PARAMETERS ARE NOT FREE (checked against Google's reference,
 * 2026-08-03). With a `syncToken`, `timeMin`, `timeMax`, `q`, `orderBy` and
 * `updatedMin` are all REFUSED, and every other parameter must match the
 * request that produced the token. That is why `singleEvents` and `maxResults`
 * are constants here rather than arguments: the moment one of them varies
 * between the full sync and an incremental one, the token stops working — and
 * it fails as a `400`, not as anything that reads like the cause.
 *
 * It also means the window of the FIRST full sync is fixed for the life of the
 * token. Forward it is unbounded, which is what you want; backward it is
 * whatever `timeMin` said on the day you first synced.
 */
const PAGE = 250;

export async function listEvents(
  creds: Credentials,
  token: string,
  cursor: { syncToken?: string; pageToken?: string; timeMin?: string },
): Promise<EventsPage> {
  const params = new URLSearchParams({ singleEvents: 'true', maxResults: String(PAGE) });
  if (cursor.syncToken) params.set('syncToken', cursor.syncToken);
  // Only on a full sync — see above.
  else if (cursor.timeMin) params.set('timeMin', cursor.timeMin);
  if (cursor.pageToken) params.set('pageToken', cursor.pageToken);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(creds.calendarId)}/events?${params}`;
  const res = await fetchGoogle(url, { headers: { Authorization: `Bearer ${token}` } }, 'Google Calendar');

  if (res.status === 410) throw new SyncTokenExpired();

  // A token the clock says is live but Google does not. Drop it so the next
  // sync mints a fresh one, and call it transient — because it is: nothing
  // about the credential is wrong, only our copy of a derived token.
  if (res.status === 401) {
    forgetToken();
    throw new GoogleError('Google rejected the access token; the next sync will mint a new one.', true);
  }

  const body = (await res.json().catch(() => null)) as (EventsPage & { error?: { message?: string } }) | null;
  if (!res.ok) throw new GoogleError(body?.error?.message ?? `Google Calendar answered ${res.status}.`, false);

  return { items: body?.items ?? [], nextPageToken: body?.nextPageToken, nextSyncToken: body?.nextSyncToken };
}
