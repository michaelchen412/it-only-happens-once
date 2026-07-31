// The other half of plan 05·2, and the half that matters most: /admin/export.json
// hands over the ENTIRE private corpus in one request — every draft, every
// private note, every unpublished word. Signed out, it must not be reachable.
//
// This project runs `anon` as its own Playwright project with deliberately no
// storageState, so these assertions are made by a genuinely signed-out browser
// rather than by a session someone remembered to clear.
import { test, expect } from '@playwright/test';

test.describe('corpus export — signed out', () => {
  test('is not served to the public', async ({ request }) => {
    const res = await request.get('/admin/export.json', { maxRedirects: 0 });

    // Middleware redirects the whole /admin tree to sign-in. What matters is
    // only that a 200 with a body never happens.
    expect(res.status(), 'a signed-out request must not get the corpus').not.toBe(200);
    expect([301, 302, 303, 307, 308, 401, 403, 404]).toContain(res.status());
  });

  test('not one fragment leaks, even following the redirect', async ({ request }) => {
    // Following the redirect lands on the sign-in page. Assert on the BODY
    // rather than the status, because the failure this guards against is a
    // response that is shaped like a login page and still carries data.
    const res = await request.get('/admin/export.json');
    const body = await res.text();
    expect(body).not.toContain('it-only-happens-once/corpus');
    expect(body).not.toContain('"fragments"');
    expect(body.length, 'a sign-in page, not a corpus').toBeLessThan(200_000);
  });

  test('the Library page it is offered from is also closed', async ({ page }) => {
    await page.goto('/admin/library');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('link', { name: /export corpus/i })).toHaveCount(0);
  });
});
