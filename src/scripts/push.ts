/*
  push — subscribing this device, and keeping the subscription alive
  (docs/plans/archive/21-push.md · Phase 2, ADR-0019).

  ⚠ NO SERVICE WORKER IS REGISTERED HERE, AND THAT IS THE DESIGN, NOT AN
  OMISSION. Declarative Web Push subscribes from the PAGE via
  `window.pushManager`, and WebKit renders the payload itself — display,
  tap-navigation, badge — with no JavaScript woken on the device. Proven on the
  real phone 2026-08-06 before any of this was written.

  Registering one would be worse than redundant: Safari routes a declarative
  push THROUGH a service worker's `push` handler when one exists, so adding a
  worker would silently disable the thing this file exists to use. And a worker
  in this repo at all is the conversation [ADR-0010](docs/adr/0010-online-first-writing.md)
  owns — its reopen trigger is logged lost work, not convenience.

  ── WHAT THIS COSTS, AND HOW IT IS PAID ─────────────────────────────────────

  Without a worker there is no `pushsubscriptionchange` firing in the
  background, so a subscription that the browser quietly rotates or drops can
  never repair itself while the app is closed. The only moment we can learn that
  a subscription is alive is a moment the app is OPEN — so `sync()` below takes
  every one of them, on every admin load. That is the whole upkeep strategy, and
  it is why `push.touch` exists as its own action.

  ⚠ DESKTOP IS EXPECTED TO READ AS "unsupported", and that is correct rather
  than broken. `window.pushManager` is WebKit's; Chrome and Firefox expose push
  only through a service worker registration, which this repo does not have. The
  phone is what this feature is for (21 · §A/B), and the dialog says so plainly
  instead of offering a button that cannot work.
*/
import { actions } from 'astro:actions';
import { closeWithExit, openDialog } from './dialog-close';

/** Public by design — it is the `applicationServerKey` the browser subscribes
 *  with, and it travels in every subscription request anyway. The PRIVATE half
 *  never leaves the Supabase Edge Function. */
const VAPID_PUBLIC = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY as string | undefined;

type State = 'loading' | 'unsupported' | 'unconfigured' | 'off' | 'on' | 'denied' | 'error';

/**
 * base64url → bytes. Safari takes the raw string too, but the BufferSource form
 * is what every implementation has always accepted.
 *
 * ⚠ `Uint8Array<ArrayBuffer>`, NOT a bare `Uint8Array`. Since TypeScript 5.7 the
 * type is generic over its backing buffer and the bare form widens to
 * `ArrayBufferLike`, which includes `SharedArrayBuffer` and therefore is not a
 * `BufferSource`. The annotation is the whole fix; the body was always right.
 */
function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** `window.pushManager` is the declarative-push entry point and exists only
 *  where this feature can actually work. Everything else reads `unsupported`.
 *
 *  ⚠ THE MISSING KEY IS DELIBERATELY *NOT* CHECKED HERE. Folding it in was the
 *  first shape of this function, and it made a DEPLOYMENT fault wear a DEVICE
 *  fault's clothes: with `PUBLIC_VAPID_PUBLIC_KEY` unset in Vercel, an installed
 *  iPhone app was told "this device can't receive them — add it to the Home
 *  Screen", which is advice to do the thing you have already done. The two
 *  conditions have nothing to do with each other and now answer separately. */
function manager(): PushManager | null {
  const w = window as unknown as { pushManager?: PushManager };
  if (!w.pushManager || typeof Notification === 'undefined') return null;
  return w.pushManager;
}

function mount(): void {
  const dialog = document.getElementById('push-dialog') as HTMLDialogElement | null;
  const body = document.getElementById('push-body');
  const opener = document.getElementById('push-open');
  if (!dialog || !body || !opener) return;

  const show = (state: State, message?: string): void => {
    body.dataset.state = state;
    if (message) {
      const el = document.getElementById('push-error');
      if (el) el.textContent = message;
    }
    // The opener wears the answer, so the state is legible without opening
    // anything — the same argument the attention pill makes about the sidebar.
    opener.dataset.pushState = state;
    opener.setAttribute(
      'aria-label',
      state === 'on' ? 'Notifications, on for this device' : 'Notifications, off for this device',
    );
  };

  /**
   * What is true right now — and, if we are subscribed, tell the server this
   * device is still here.
   *
   * ⚠ THE `touch` IS THE POINT OF CALLING THIS ON EVERY LOAD, not the state
   * label. See the header: with no service worker, an open app is the only
   * chance we get to notice a subscription is alive. `known: false` means the
   * browser kept a subscription whose row we lost — re-assert it rather than
   * leaving a device that thinks it is subscribed and never hears anything.
   */
  async function sync(): Promise<void> {
    const pm = manager();
    if (!pm) return show('unsupported');
    // ⚠ AFTER the capability check, not before. On a desktop browser both are
    // true and "unsupported" is the permanent honest answer; on the installed
    // phone `pushManager` exists, so this is the one that surfaces — which is
    // the only place the distinction can be acted on.
    if (!VAPID_PUBLIC) return show('unconfigured');
    if (Notification.permission === 'denied') return show('denied');

    try {
      const sub = await pm.getSubscription();
      if (!sub) return show('off');

      const { data } = await actions.push.touch({ endpoint: sub.endpoint });
      if (data && !data.known) await persist(sub);
      show('on');
    } catch {
      // A failed check must not present as a failed FEATURE — the likeliest
      // cause is being offline, and the honest report is the state we can see.
      show('off');
    }
  }

  async function persist(sub: PushSubscription): Promise<void> {
    const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
    const { error } = await actions.push.subscribe({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      userAgent: navigator.userAgent.slice(0, 500),
    });
    if (error) throw new Error(error.message);
  }

  document.getElementById('push-enable')?.addEventListener('click', async () => {
    const pm = manager();
    if (!pm) return show('unsupported');
    if (!VAPID_PUBLIC) return show('unconfigured');
    show('loading');
    try {
      // ⚠ FROM THE CLICK, NEVER FROM LOAD. iOS refuses a prompt raised outside a
      // user gesture AND remembers the refusal, so an "improvement" that asked
      // on page load would permanently deny the feature on that install.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return show(permission === 'denied' ? 'denied' : 'off');

      const sub = await pm.subscribe({
        userVisibleOnly: true, // not advisory: WebKit permits no silent push
        applicationServerKey: keyBytes(VAPID_PUBLIC),
      });
      await persist(sub);
      show('on');
    } catch (err) {
      show('error', err instanceof Error ? err.message : 'That did not work.');
    }
  });

  document.getElementById('push-disable')?.addEventListener('click', async () => {
    show('loading');
    try {
      const sub = await manager()?.getSubscription();
      // ⚠ THE ROW GOES FIRST, and the order is the whole reliability argument:
      // the sender can only reach an endpoint it HAS, so deleting the row is
      // what actually stops the notifications. If the browser-side
      // `unsubscribe()` then fails, the result is a dead endpoint nobody pushes
      // to. Do it the other way round and a failure leaves a live row for an
      // endpoint the browser has already retired — silent, and it fails OPEN.
      if (sub) {
        const { error } = await actions.push.forget({ endpoint: sub.endpoint });
        if (error) throw new Error(error.message);
        await sub.unsubscribe().catch(() => {
          // Already gone, or refused. The row is what mattered.
        });
      }
      show('off');
    } catch (err) {
      show('error', err instanceof Error ? err.message : 'That did not work.');
    }
  });

  opener.addEventListener('click', () => openDialog(dialog));
  document.getElementById('push-close')?.addEventListener('click', () => void closeWithExit(dialog));

  void sync();
}

mount();
