// Granting the building permission to speak first (21 · Phase 2, ADR-0019).
//
// ⚠ READ-ONLY, AND IT TOOK DELIBERATE WORK TO STAY THAT WAY. Every path here
// ends in a real write — `push.subscribe` stores standing permission to make a
// phone ring — so every spec that reaches one stubs `/_actions/**`. The suite
// runs against the LIVE project; a spec that actually subscribed would leave a
// row behind that a scheduled Edge Function would later push to.
//
// ⚠ AND THE PUSH API ITSELF IS STUBBED, for a reason worth stating rather than
// apologising for: `window.pushManager` is WebKit's declarative-push entry
// point, and this harness is chromium. There is no configuration of Playwright
// that makes the real thing available here. So these prove the STATE MACHINE —
// what the dialog says, which button it offers, what it sends, and in what
// order — and they cannot prove that a notification arrives. That was proven
// once by hand on the real phone (21 · Phase 1) and is Phase 5's job again.
import { expect, test, type Page } from '@playwright/test';
import { stubActions } from './fixtures';

/** Put a WebKit-shaped `window.pushManager` in front of chromium. */
async function stubPushApi(
  page: Page,
  opts: { permission?: NotificationPermission; subscribed?: boolean } = {},
): Promise<void> {
  const { permission = 'default', subscribed = false } = opts;
  await page.addInitScript(
    ([permission, subscribed]) => {
      const log: string[] = [];
      (window as unknown as { __push: string[] }).__push = log;

      // ⚠ ACTION CALLS GO IN THE SAME LOG AS THE BROWSER CALLS, and that is the
      // entire reason this wrapper exists. The two halves of "turn off" happen
      // in different places — one is an `astro:actions` fetch, the other is a
      // `PushSubscription` method — so two separate logs can only ever prove
      // that BOTH happened, never that one happened FIRST. That gap was real:
      // the ordering spec below passed against a deliberately reversed
      // implementation until this line existed.
      const origFetch = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/_actions/')) {
          log.push(
            'action:' +
              decodeURIComponent(url)
                .replace(/^.*\/_actions\//, '')
                .replace(/\/$/, ''),
          );
        }
        return origFetch.call(this, input, init);
      };

      const fakeSub = {
        endpoint: 'https://web.push.apple.com/FAKE-ENDPOINT',
        toJSON: () => ({
          endpoint: 'https://web.push.apple.com/FAKE-ENDPOINT',
          keys: { p256dh: 'FAKE-P256DH', auth: 'FAKE-AUTH' },
        }),
        unsubscribe: () => {
          log.push('browser:unsubscribe');
          return Promise.resolve(true);
        },
      };

      let current = subscribed === 'yes' ? fakeSub : null;

      Object.defineProperty(window, 'pushManager', {
        configurable: true,
        value: {
          getSubscription: () => Promise.resolve(current),
          subscribe: (o: { userVisibleOnly?: boolean }) => {
            // Asserted on: WebKit permits no silent push, so this is not a
            // preference the app may quietly drop.
            log.push(`browser:subscribe:userVisibleOnly=${String(o?.userVisibleOnly)}`);
            current = fakeSub;
            return Promise.resolve(fakeSub);
          },
        },
      });

      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
          permission,
          requestPermission: () => {
            log.push('browser:requestPermission');
            Object.defineProperty(window.Notification, 'permission', {
              configurable: true,
              value: permission === 'default' ? 'granted' : permission,
            });
            return Promise.resolve(permission === 'default' ? 'granted' : permission);
          },
        },
      });
    },
    [permission, subscribed ? 'yes' : 'no'] as const,
  );
}

/**
 * The interleaved log of browser-push calls and action calls, in real order.
 *
 * ⚠ FILTERED TO THIS FEATURE, and not out of tidiness. `/admin` syncs the Google
 * calendar on view (ADR-0014), so `action:calendar.sync` lands in this log at a
 * moment nothing here controls — the same harness leak
 * [the board](../../docs/plans/README.md) already warns costs an hour if you
 * believe it. Asserting an unfiltered sequence would make these specs fail on
 * whichever unrelated action a page happens to fire next.
 */
const browserLog = async (page: Page): Promise<string[]> => {
  const all = await page.evaluate(() => (window as unknown as { __push?: string[] }).__push ?? []);
  return all.filter((e) => e.startsWith('browser:') || e.startsWith('action:push.'));
};
const state = (page: Page) => page.locator('#push-body').evaluate((el) => (el as HTMLElement).dataset.state);

test.describe('the notifications control', () => {
  test('lives with the theme toggle, not in the nav', async ({ page }) => {
    // The decision: it is about THIS DEVICE and this session, like the theme
    // and Sign out — and a switch you press once per device does not justify a
    // ninth nav item in a list whose whole argument is that it is short.
    await page.goto('/admin');
    await expect(page.locator('#push-open')).toHaveCount(1);
    await expect(page.locator('#sidebar #push-open')).toHaveCount(1);
    await expect(page.locator('nav a', { hasText: 'Notification' })).toHaveCount(0);
  });

  test('⚠ says "unsupported" on a browser with no declarative push, rather than offering a dead button', async ({
    page,
  }) => {
    // Chromium as it really is — no `window.pushManager`. This is what the
    // DESKTOP will genuinely show, and it is correct rather than broken:
    // ADR-0019 rules out the service worker that desktop push would need, so
    // the honest thing is to say so instead of offering a button that throws.
    await page.goto('/admin');
    await page.locator('#push-open').click();
    await expect.poll(() => state(page)).toBe('unsupported');
    await expect(page.locator('#push-enable')).toBeHidden();
    await expect(page.getByText('add it to the Home Screen')).toBeVisible();
  });

  test('offers to turn on when the device can, and says what it will cost', async ({ page }) => {
    await stubPushApi(page);
    await page.goto('/admin');
    await page.locator('#push-open').click();
    await expect.poll(() => state(page)).toBe('off');
    await expect(page.locator('#push-enable')).toBeVisible();
    await expect(page.locator('#push-disable')).toBeHidden();
    // The promise the dialog makes, asserted — because it is the promise
    // Phase 3's trigger has to keep.
    await expect(page.getByText('at most one a day')).toBeVisible();
  });

  test('⚠ subscribes from the click, with userVisibleOnly, and stores the keys', async ({ page }) => {
    let sent: unknown = null;
    const seen = await stubActions(page, {
      'push.touch': () => ({ known: false }),
      'push.subscribe': (req) => {
        sent = req.postDataJSON();
        return { ok: true };
      },
    });
    await stubPushApi(page);
    await page.goto('/admin');
    await page.locator('#push-open').click();
    await expect.poll(() => state(page)).toBe('off');

    await page.locator('#push-enable').click();
    await expect.poll(() => state(page)).toBe('on');

    // ⚠ THE WHOLE ORDERED SEQUENCE, and every step of it is load-bearing.
    // Permission FIRST and from the click, because iOS refuses a prompt raised
    // outside a user gesture and REMEMBERS the refusal — so an "improvement"
    // that asked on load would permanently deny the feature on that install.
    // `userVisibleOnly: true` because WebKit permits no silent push, so it is
    // not a preference this app may quietly drop. And the row stored LAST,
    // because there is nothing to store until the browser has minted an
    // endpoint.
    //
    // Note there is no `action:push.touch` here: nothing was subscribed on
    // load, so `sync()` correctly returned without asking the server anything.
    expect(await browserLog(page)).toEqual([
      'browser:requestPermission',
      'browser:subscribe:userVisibleOnly=true',
      'action:push.subscribe',
    ]);
    expect(seen()).toContain('push.subscribe');
    expect(sent).toMatchObject({
      endpoint: 'https://web.push.apple.com/FAKE-ENDPOINT',
      p256dh: 'FAKE-P256DH',
      auth: 'FAKE-AUTH',
    });
  });

  test('⚠ turning off deletes the ROW before it retires the endpoint', async ({ page }) => {
    // The order is the whole reliability argument. The sender can only reach an
    // endpoint it HAS, so deleting the row is what actually stops the
    // notifications; if the browser call then fails, the result is a dead
    // endpoint nobody pushes to. The other way round, a failure leaves a LIVE
    // row for an endpoint the browser already retired — silent, and it fails
    // OPEN, which on this feature means a phone that keeps ringing.
    const seen = await stubActions(page, {
      'push.touch': () => ({ known: true }),
      'push.forget': () => ({ ok: true }),
    });
    await stubPushApi(page, { permission: 'granted', subscribed: true });
    await page.goto('/admin');
    await page.locator('#push-open').click();
    await expect.poll(() => state(page)).toBe('on');

    await page.locator('#push-disable').click();
    await expect.poll(() => state(page)).toBe('off');

    expect(seen()).toContain('push.forget');

    // ⚠ THE ORDER, NOT MERELY THE PAIR. Asserted from one interleaved log,
    // because an assertion that both happened passes just as happily when they
    // happen backwards — which is how the first version of this spec stayed
    // green against a deliberately reversed implementation.
    // The whole life of this device in one sequence: re-asserted on load, then
    // the row deleted, then the endpoint retired.
    expect(await browserLog(page), 'the row must be deleted before the endpoint is retired').toEqual([
      'action:push.touch',
      'action:push.forget',
      'browser:unsubscribe',
    ]);
  });

  test('⚠ re-asserts the subscription on every admin load — the no-service-worker upkeep', async ({ page }) => {
    // With no worker there is no `pushsubscriptionchange` running in the
    // background, so an open app is the ONLY chance to notice a subscription is
    // alive. `known: false` means the browser kept a subscription whose row we
    // lost; re-subscribing is what stops a device that thinks it is subscribed
    // from silently never hearing anything.
    let resubscribed = 0;
    const seen = await stubActions(page, {
      'push.touch': () => ({ known: false }),
      'push.subscribe': () => {
        resubscribed++;
        return { ok: true };
      },
    });
    await stubPushApi(page, { permission: 'granted', subscribed: true });
    await page.goto('/admin');

    // Nobody opened the dialog — this happens on load, in every room.
    await expect.poll(() => seen()).toContain('push.touch');
    await expect.poll(() => resubscribed).toBe(1);

    await page.goto('/admin/people');
    await expect.poll(() => seen().filter((n) => n === 'push.touch').length).toBe(2);
  });

  test('a blocked device explains the only way back', async ({ page }) => {
    await stubPushApi(page, { permission: 'denied' });
    await page.goto('/admin');
    await page.locator('#push-open').click();
    await expect.poll(() => state(page)).toBe('denied');
    await expect(page.locator('#push-enable')).toBeHidden();
    await expect(page.getByText('delete the Observatory from your Home Screen')).toBeVisible();
  });
});
