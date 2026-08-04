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
 * A short-lived access token, cached for as long as it is good for.
 *
 * The cache is module scope, which on a serverless host means "for as long as
 * this instance happens to live" — a real saving when it survives and harmless
 * when it does not. Sixty seconds are shaved off the expiry so a token cannot
 * expire in flight.
 */
let cached: { token: string; until: number } | null = null;

export async function accessToken(creds: Credentials): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  } | null;
  if (!res.ok || !body?.access_token) {
    throw new Error(body?.error_description ?? `Google refused the refresh token (${res.status}).`);
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 410) throw new SyncTokenExpired();
  const body = (await res.json().catch(() => null)) as (EventsPage & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `Google Calendar answered ${res.status}.`);

  return { items: body?.items ?? [], nextPageToken: body?.nextPageToken, nextSyncToken: body?.nextSyncToken };
}
