// The contact form's env-shaped branches (plan 43 §3.2).
//
// What this file pins: TURNSTILE_SECRET_KEY missing means two DIFFERENT things
// in two environments, and only one of them is safe. In dev it means "no key
// exists and the widget was never rendered" — skip the check. In prod it means
// "a deploy lost its key" — and the old behaviour, skipping, made that deploy
// indistinguishable from a working one while it accepted unverified
// submissions. These tests hold the branch open in both directions, plus the
// two refusals around it.
//
// The actions are driven the way the server drives them (`orThrow.call(ctx)`,
// real defineAction, real ActionError — see stubs/astro-actions.ts). The
// outside world is a stubbed global fetch, which doubles as the proof of WHERE
// each branch stopped: a refusal that never touched the network is a refusal
// that spent nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contact } from '../actions/site';

type SendAction = { orThrow: (this: unknown, input: unknown) => Promise<unknown> };
const send = contact.send as unknown as SendAction;

const INPUT = { name: 'A Stranger', email: 'stranger@example.com', message: 'hello there' };
const ctx = () => ({ request: new Request('http://localhost/about') });

/** A fetch that answers like Resend's happy path, recording every call. The
 *  parameter exists so `mock.calls` carries the URL each caller asked for. */
const resendOk = () =>
  vi.fn(
    async (_url: string | URL | Request) =>
      new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('contact.send × TURNSTILE_SECRET_KEY', () => {
  it('prod + missing secret: refuses before spending anything (fail closed)', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
    // Resend IS configured — proving the refusal below is the Turnstile
    // branch, not the missing-Resend sentence two checks later.
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('CONTACT_TO_EMAIL', 'michael@example.com');
    const fetchSpy = resendOk();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(send.orThrow.call(ctx(), INPUT)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: expect.stringContaining('isn’t configured'),
    });
    // Neither siteverify nor Resend was reached: the refusal cost zero calls.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dev + missing secret: skips the check and the send proceeds', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('CONTACT_TO_EMAIL', 'michael@example.com');
    const fetchSpy = resendOk();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(send.orThrow.call(ctx(), INPUT)).resolves.toEqual({ ok: true });
    // Exactly one call, and it is the mail, not a verification: dev's skip is
    // a skip of Turnstile alone, never of delivery.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('api.resend.com');
  });

  it('configured secret + no token: refuses as BAD_REQUEST, no network', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts_secret');
    const fetchSpy = resendOk();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(send.orThrow.call(ctx(), INPUT)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the honeypot answers "ok" before any env is consulted — never a signal', async () => {
    // Worst config (prod, nothing set): a bot that filled the hidden field
    // still gets the silent success, so probing the form can't reveal whether
    // the deploy is configured. The order of checks IS the property.
    vi.stubEnv('PROD', true);
    vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
    vi.stubEnv('RESEND_API_KEY', undefined);
    vi.stubEnv('CONTACT_TO_EMAIL', undefined);
    const fetchSpy = resendOk();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(send.orThrow.call(ctx(), { ...INPUT, company: 'Totally Real Inc' })).resolves.toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
