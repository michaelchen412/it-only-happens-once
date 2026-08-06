// What the Google client does when Google misbehaves (13 · Piece 3).
//
// ⚠ THIS FILE EXISTS BECAUSE OF ONE AFTERNOON. On 2026-08-06 Today carried the
// line *"Google couldn't be reached"* for a mirror that was completely current,
// and the stored reason read *"Google refused the refresh token (503)"* — so
// the obvious move was to go and re-authenticate a credential that was fine.
// Two separate faults produced that: a transient `503` was treated as terminal,
// and every non-200 was described as a refusal. Both are behaviour, neither is
// visible in a type, and the only way either stays fixed is a test that fails
// when it regresses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTEMPTS } from '../lib/hq/gcal';

const CREDS = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', calendarId: 'cal@example.com' };

const TOKEN_URL = /oauth2\.googleapis\.com/;
const EVENTS_URL = /googleapis\.com\/calendar/;

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | 'no answer';

/**
 * A scripted sequence of answers. The last one repeats, so "Google is down"
 * is one entry rather than three — but every test still asserts the call count,
 * because a retry that silently became four attempts is the kind of thing that
 * only shows up on somebody's bill.
 */
function stubFetch(replies: Reply[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (reply === 'no answer') throw new TypeError('fetch failed');
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json', ...reply.headers },
      });
    }),
  );
  return calls;
}

const TOKEN_OK = { body: { access_token: 'live-token', expires_in: 3600 } };

/**
 * Run a pending call to completion without sitting through its backoff.
 *
 * The waits are real `setTimeout`s and deliberately so — see `BACKOFF_MS` — so
 * the clock is faked and jumped instead. Each pass lets whatever is in flight
 * settle, then advances past any wait this file can schedule; enough passes to
 * cover every attempt, since each one is only scheduled once the previous has
 * failed.
 */
async function withoutTheWait<T>(pending: Promise<T>): Promise<T> {
  // ⚠ THE OUTCOME IS CAUGHT BEFORE THE CLOCK MOVES, and it has to be. `pending`
  // usually rejects part-way through the loop below, and a rejection with no
  // handler yet attached is an unhandled rejection — reported by Vitest, fatal
  // under Node's default in some runners, and nothing to do with the code under
  // test. Folding it into a thunk defers the throw to the caller's `await`
  // without ever leaving the promise unattended.
  const outcome = pending.then(
    (value) => () => value,
    (error: unknown) => () => {
      throw error;
    },
  );

  for (let pass = 0; pass <= MAX_ATTEMPTS; pass++) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
  }

  return (await outcome)();
}

/** Fresh module every time, or the module-scope token cache leaks between tests. */
async function freshGcal() {
  vi.resetModules();
  return import('../lib/hq/gcal');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('accessToken', () => {
  it('⚠ RIDES OUT A 503 — the exact failure of 2026-08-06', async () => {
    // Google's token service had a bad second. One retry is the whole
    // difference between a mirror that skips a beat and a banner that sits on
    // Today for ten minutes accusing a healthy credential.
    const calls = stubFetch([{ status: 503, body: {} }, TOKEN_OK]);
    const { accessToken } = await freshGcal();

    await expect(withoutTheWait(accessToken(CREDS))).resolves.toBe('live-token');
    expect(calls).toHaveLength(2);
  });

  it('gives up after the last attempt, and says Google was unavailable', async () => {
    const calls = stubFetch([{ status: 503, body: {} }]);
    const { accessToken, GoogleError } = await freshGcal();

    const err = await withoutTheWait(accessToken(CREDS)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoogleError);
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    // ⚠ THE WORDING IS THE POINT, not decoration. "Unavailable" sends nobody
    // anywhere; "refused the refresh token" sends them to re-consent.
    expect((err as Error).message).toContain('unavailable (503)');
    expect((err as Error).message).not.toContain('refused');
    expect((err as { transient: boolean }).transient).toBe(true);
  });

  it('⚠ does NOT retry a dead credential, and calls it a refusal', async () => {
    // `invalid_grant` is the one failure re-authenticating actually fixes, and
    // repeating it three times helps nobody.
    const calls = stubFetch([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token expired' } }]);
    const { accessToken, GoogleError } = await freshGcal();

    const err = await withoutTheWait(accessToken(CREDS)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoogleError);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe('Google refused the refresh token (Token expired).');
    expect((err as { transient: boolean }).transient).toBe(false);
  });

  it('treats a network that never answers as Google being away', async () => {
    const calls = stubFetch(['no answer']);
    const { accessToken } = await freshGcal();

    const err = await withoutTheWait(accessToken(CREDS)).catch((e: unknown) => e);

    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect((err as { transient: boolean }).transient).toBe(true);
    expect((err as Error).message).toContain('did not answer');
  });

  it('honours Retry-After, and still stops at the attempt ceiling', async () => {
    const calls = stubFetch([{ status: 429, body: {}, headers: { 'retry-after': '2' } }]);
    const { accessToken } = await freshGcal();

    await withoutTheWait(accessToken(CREDS)).catch(() => null);

    expect(calls).toHaveLength(MAX_ATTEMPTS);
  });

  it('mints once and then answers from the cache', async () => {
    const calls = stubFetch([TOKEN_OK]);
    const { accessToken } = await freshGcal();

    await withoutTheWait(accessToken(CREDS));
    await withoutTheWait(accessToken(CREDS));

    expect(calls).toHaveLength(1);
  });
});

describe('listEvents', () => {
  it('⚠ passes 410 straight through as an instruction, unretried', async () => {
    // `SyncTokenExpired` means "start again from nothing". Retrying it would
    // collect the same answer three times before finally acting on it.
    const calls = stubFetch([{ status: 410, body: {} }]);
    const { listEvents, SyncTokenExpired } = await freshGcal();

    const err = await withoutTheWait(listEvents(CREDS, 'tok', { syncToken: 'stale' })).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SyncTokenExpired);
    expect(calls).toHaveLength(1);
  });

  it('⚠ throws away a rejected access token so the next sync mints a new one', async () => {
    // Without this a single spurious 401 is cached as good for up to an hour,
    // and every sync in that hour fails for a reason that has already passed.
    const calls = stubFetch([TOKEN_OK, { status: 401, body: {} }, TOKEN_OK]);
    const { accessToken, listEvents } = await freshGcal();

    const token = await withoutTheWait(accessToken(CREDS));
    const err = await withoutTheWait(listEvents(CREDS, token, {})).catch((e: unknown) => e);
    expect((err as { transient: boolean }).transient).toBe(true);

    await withoutTheWait(accessToken(CREDS));

    // Three calls: mint, the 401, and the re-mint the cache no longer prevents.
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatch(TOKEN_URL);
  });

  it('retries a 502 and returns the page it eventually gets', async () => {
    const calls = stubFetch([{ status: 502, body: {} }, { body: { items: [{ id: 'a' }], nextSyncToken: 'next' } }]);
    const { listEvents } = await freshGcal();

    const page = await withoutTheWait(listEvents(CREDS, 'tok', {}));

    expect(page.items).toHaveLength(1);
    expect(page.nextSyncToken).toBe('next');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(EVENTS_URL);
  });

  it('reports a refusal Google explains, without retrying it', async () => {
    const calls = stubFetch([{ status: 404, body: { error: { message: 'Not Found' } } }]);
    const { listEvents, GoogleError } = await freshGcal();

    const err = await withoutTheWait(listEvents(CREDS, 'tok', {})).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoogleError);
    expect((err as Error).message).toBe('Not Found');
    expect((err as { transient: boolean }).transient).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
