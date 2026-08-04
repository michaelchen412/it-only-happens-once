// The other half of plan 05·2, and the half that matters most: /admin/export.json
// hands over EVERYTHING in one request — every draft, every private note, every
// unpublished word, and since 2026-08-02 the private HQ tables too (ADR-0012).
// It is the single most sensitive artefact this app can emit. Signed out, it
// must not be reachable, and this file is the assertion that it isn't.
//
// This project runs `anon` as its own Playwright project with deliberately no
// storageState, so these assertions are made by a genuinely signed-out browser
// rather than by a session someone remembered to clear.
import { test, expect } from '@playwright/test';

test.describe('personal export — signed out', () => {
  test('is not served to the public', async ({ request }) => {
    const res = await request.get('/admin/export.json', { maxRedirects: 0 });

    // Middleware redirects the whole /admin tree to sign-in. What matters is
    // only that a 200 with a body never happens.
    expect(res.status(), 'a signed-out request must not get the export').not.toBe(200);
    expect([301, 302, 303, 307, 308, 401, 403, 404]).toContain(res.status());
  });

  test('not one fragment leaks, even following the redirect', async ({ request }) => {
    // Following the redirect lands on the sign-in page. Assert on the BODY
    // rather than the status, because the failure this guards against is a
    // response that is shaped like a login page and still carries data.
    const res = await request.get('/admin/export.json');
    const body = await res.text();

    // Every top-level key the export actually emits. Checking the payload's
    // own vocabulary beats checking its size.
    for (const marker of [
      'it-only-happens-once/personal',
      '"exportedAt"',
      '"counts"',
      '"fragments"',
      '"fragment_versions"',
      '"constellations"',
      // The HQ half. Its own room in this list, because a future piece adding
      // an HQ table and forgetting this file is exactly the leak to catch.
      '"settings"',
      '"home_timezone"',
    ]) {
      expect(body, `signed out, the body must not carry ${marker}`).not.toContain(marker);
    }

    // …and it positively IS the sign-in page, which is what makes "carries no
    // data" mean something rather than being the absence of a few strings.
    expect(body, 'the redirect really landed on sign-in').toContain('<title>Sign in');

    // 2026-08-01: a `body.length < 200_000` assertion lived here as a proxy for
    // "a login page, not a corpus". Removed — it measured the DEV server's
    // inlined stylesheet, so it grew whenever anyone added a Tailwind utility
    // anywhere in the project, and it had already crept over its own ceiling
    // (200,521 bytes) before the change that surfaced it. A threshold that
    // fails for reasons unrelated to the thing it guards trains you to ignore
    // it, which on a security spec is worse than not having it.
  });

  test('the Library page it is offered from is also closed', async ({ page }) => {
    await page.goto('/admin/library');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('link', { name: /export everything/i })).toHaveCount(0);
  });
});
