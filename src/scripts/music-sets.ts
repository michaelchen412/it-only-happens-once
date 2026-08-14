// The sets' client enhancement — `detail` layout only (2026-08-14).
//
// Switching sets without a navigation, which only this arrangement can do: its
// embed is stationary, so the content can be swapped inside it. `accordion`
// moves the frame between list items and `stacked` has one per set, and
// re-parenting an iframe reloads it — so both of those navigate, and that is a
// property of the layout rather than a gap here.
//
// ⚠ EVERY SENTENCE IS A REAL LINK AND THAT IS THE NO-JS FLOOR. `?set=<slug>` is
// server-rendered; this only removes the round trip. Same contract the room's
// words already honour.

interface EmbedController {
  loadEntity?: (uriOrUrl: string, preferVideo?: boolean, startAt?: number) => void;
  addListener?: (event: string, cb: (e: unknown) => void) => void;
  destroy?: () => void;
}
interface IFrameAPI {
  createController: (
    el: Element,
    opts: { width: string; height: string; uri?: string; url?: string },
    cb: (c: EmbedController) => void,
  ) => void;
}
type SetQuoteRow = { text: string; author: string; work?: string | null };
type SetRow = { title: string; desc: string; url: string; quote: SetQuoteRow | null };
type SpotifyWindow = Window & { SpotifyIframeApi?: IFrameAPI; onSpotifyIframeApiReady?: (a: IFrameAPI) => void };

const API_SRC = 'https://open.spotify.com/embed/iframe-api/v1';

/**
 * ⚠ HOW LONG WE WAIT FOR A THIRD-PARTY SCRIPT BEFORE GIVING UP ON IT. Content
 * blockers kill `open.spotify.com` scripts routinely and they do not fail
 * loudly — the request simply never resolves, so there is no error to catch and
 * `onerror` may never fire either. Without a deadline the mount stays a
 * breathing grey box forever, which is worse than the plain iframe we could
 * have rendered immediately.
 */
const API_DEADLINE_MS = 2500;

/**
 * ⚠ AND HOW LONG WE WAIT FOR `ready` BEFORE SHOWING THE PLAYER ANYWAY. Measured
 * at ~270ms; this is an order of magnitude of headroom, and it exists so that a
 * missed event can never leave a permanently hidden embed. Revealing something
 * half-drawn is a bad frame; revealing nothing is a broken page.
 */
const READY_DEADLINE_MS = 4000;

export function wireMusicSets(): void {
  const detail = document.getElementById('set-detail');
  const slot = document.getElementById('set-embed-slot');
  const frame = document.getElementById('set-embed-frame');
  const dataEl = document.getElementById('set-data');
  if (!detail || !slot || !frame || !dataEl) return;

  let data: Record<string, SetRow>;
  try {
    data = JSON.parse(dataEl.textContent ?? '') as Record<string, SetRow>;
  } catch {
    return; // no payload → the server-rendered page stands, links and all
  }

  const base = detail.dataset.base || '/lab/sets';
  const height = detail.dataset.height || '600';
  const desc = document.getElementById('set-desc');
  const quoteEl = document.getElementById('set-quote');
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-set]')];
  let current = detail.dataset.open || Object.keys(data)[0];

  // ── showing and hiding ────────────────────────────────────────────────────
  //
  // ⚠ THE PLAYER IS REVEALED ON AN EVENT, NOT ON A TIMER, and the timer version
  // is exactly what Michael reported as *"snapping onto the page"*. Fading in
  // 420ms after calling `loadEntity` reveals an EMPTY frame and then lets the
  // content appear inside it — two events where there should be one.
  //
  // Measured 2026-08-14: `ready` RE-FIRES on every `loadEntity`, about 270ms
  // after the call, and the iframe emits a native `load` at ~250ms. So there is
  // a real signal and the guess was never necessary. The frame stays at
  // `opacity:0` over a breathing skeleton until the embed says it is built.
  //
  // ⚠ AND `is-ready` DISMISSES THE SKELETON, because a loading state should end
  // when the loading does. It is NOT the fix for the pale corners — that was
  // the embed's own white document canvas going unclipped, and it lives on the
  // wrapper in `MusicSets.astro`.
  let readyTimer = 0;
  const reveal = () => {
    clearTimeout(readyTimer);
    frame.style.opacity = '1';
    slot.classList.add('is-ready');
  };
  const conceal = () => {
    frame.style.opacity = '0';
    slot.classList.remove('is-ready');
    clearTimeout(readyTimer);
    readyTimer = window.setTimeout(reveal, READY_DEADLINE_MS);
  };

  // ── the player ────────────────────────────────────────────────────────────
  //
  // ⚠ THE CONTROLLER IS BUILT ON LOAD, NOT ON THE FIRST SWITCH. Deferring
  // looked thrifty and was a real bug: the first switch swapped the iframe's
  // `src` (one full document load) and THEN called `createController` with the
  // same playlist, which replaces the element and loads it AGAIN. Two loads, in
  // series, on the one interaction that had to feel instant.
  let controller: EmbedController | null = null;
  let settled = false;

  /** The floor: a plain iframe, the same one `<noscript>` would have rendered. */
  const mountPlainFrame = (row: SetRow) => {
    const existing = document.getElementById('set-embed') as HTMLIFrameElement | null;
    if (existing) {
      existing.src = embedSrc(row.url);
      existing.title = row.title;
      return;
    }
    const mount = document.getElementById('set-embed-mount');
    if (!mount) return;
    const el = document.createElement('iframe');
    el.id = 'set-embed';
    el.src = embedSrc(row.url);
    el.width = '100%';
    el.height = height;
    el.title = row.title;
    el.setAttribute('allow', 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture');
    el.style.cssText = 'border-radius: var(--radius-box); border: 0';
    // Without a controller there is no `ready`, so the DOM's own load event is
    // the signal. It fires on every `src` change, which is every switch.
    el.addEventListener('load', reveal);
    mount.replaceWith(el);
  };

  const startApi = () => {
    const w = window as SpotifyWindow;
    const build = (api: IFrameAPI) => {
      const mount = document.getElementById('set-embed-mount');
      if (!mount || settled) return;
      settled = true;
      api.createController(mount, { width: '100%', height, url: themed(data[current]?.url ?? '') }, (c) => {
        controller = c;
        // Registered once and fires for every entity, including this first one.
        c.addListener?.('ready', reveal);
      });
    };
    if (w.SpotifyIframeApi) return build(w.SpotifyIframeApi);
    w.onSpotifyIframeApiReady = (api: IFrameAPI) => {
      w.SpotifyIframeApi = api;
      build(api);
    };
    const s = document.createElement('script');
    s.src = API_SRC;
    s.async = true;
    document.head.appendChild(s);
    // See API_DEADLINE_MS — a blocked script never resolves, so the fallback is
    // a clock rather than an error handler.
    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      mountPlainFrame(data[current]);
    }, API_DEADLINE_MS);
  };

  // ── the swap ──────────────────────────────────────────────────────────────

  const swap = (slug: string) => {
    const row = data[slug];
    if (!row) return;
    current = slug;

    // The words change on the same beat the player goes out, so the pane reads
    // as one event rather than two. Text has nothing to wait for.
    //
    // ⚠ THE QUOTE IS WRITTEN WITH `textContent`, THE DESCRIPTION WITH `innerHTML`,
    // and the asymmetry is deliberate. `desc` is Markdown the server already
    // rendered and sanitised; a quote is three plain strings, and building it
    // from parts means no path exists here that could ever inject markup — the
    // same reasoning `renderMarkdown` exists for, applied by not needing it.
    if (desc) desc.innerHTML = row.desc;
    writeQuote(quoteEl, row.quote);

    conceal();
    if (controller?.loadEntity) controller.loadEntity(themed(row.url));
    else mountPlainFrame(row);
  };

  /**
   * ⚠ THE FIGURE IS HIDDEN, NEVER REMOVED. Most sets will carry no quote, and a
   * container that appears and disappears is a layout shift on every switch —
   * the pane would jump by the height of a line each time you crossed from a
   * set that has one to a set that does not.
   */
  const writeQuote = (fig: HTMLElement | null, q: SetQuoteRow | null) => {
    if (!fig) return;
    if (!q) {
      fig.hidden = true;
      return;
    }
    const text = fig.querySelector<HTMLElement>('[data-quote-text]');
    const author = fig.querySelector<HTMLElement>('[data-quote-author]');
    let work = fig.querySelector<HTMLElement>('[data-quote-work]');
    if (text) text.textContent = q.text;
    if (author) author.textContent = q.author;
    if (q.work) {
      // The work span is absent whenever the server rendered a quote without
      // one, so it has to be creatable rather than merely fillable.
      if (!work && author?.parentElement) {
        work = document.createElement('span');
        work.className = 'text-base-content/20';
        work.dataset.quoteWork = '';
        author.parentElement.appendChild(work);
      }
      if (work) work.textContent = `, ${q.work}`;
    } else if (work) {
      work.remove();
    }
    fig.hidden = false;
  };

  const render = (slug: string) => {
    links.forEach((a) => {
      const on = a.dataset.set === slug;
      a.classList.toggle('text-primary', on);
      a.classList.toggle('text-base-content/40', !on);
      a.classList.toggle('hover:text-base-content/75', !on);
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    swap(slug);
  };

  // ── input ─────────────────────────────────────────────────────────────────

  /**
   * ⚠ WARM THE NEXT EMBED ON INTENT. Hovering or tabbing to a sentence is the
   * cheapest possible prediction of the click that follows, and it buys the
   * whole connection-and-document cost before the press. `prefetch` rather than
   * `preload` deliberately: a document we may never navigate to should be a
   * low-priority hint the browser is free to drop, not a demand.
   *
   * Once per set, ever. And harmless when wrong — an unused prefetch is one
   * cached response.
   */
  const prefetched = new Set<string>();
  const warm = (slug: string) => {
    const row = data[slug];
    if (!row || prefetched.has(slug)) return;
    prefetched.add(slug);
    const l = document.createElement('link');
    l.rel = 'prefetch';
    l.as = 'document';
    l.href = embedSrc(row.url);
    document.head.appendChild(l);
  };
  links.forEach((a) => {
    const slug = a.dataset.set ?? '';
    a.addEventListener('pointerenter', () => warm(slug));
    a.addEventListener('focus', () => warm(slug));
  });

  /**
   * ⚠ CAPTURE PHASE AND `stopPropagation`, AND WITHOUT THEM THIS FILE IS
   * DECORATION. The site mounts `<ClientRouter />`, whose document-level click
   * listener claims any `<a href>` and navigates — and every sentence here is a
   * real anchor, because that is the no-JS floor. A bubble-phase
   * `preventDefault()` arrives after the router has already started the
   * transition, so the page swaps out from under the embed and the in-place
   * swap this whole file exists for never happens.
   *
   * `Reader.astro` hit this first and `music-room.ts` documents the same fix in
   * the same words. Third time; it is a property of the site, not a surprise.
   */
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-set]') as HTMLElement | null;
      if (!el) return;
      // ⌘/Ctrl/Shift-click still opens the real URL — the interception is an
      // enhancement, not a replacement.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const slug = el.dataset.set ?? '';
      if (!data[slug] || slug === current) return;
      history.pushState({ set: slug }, '', `${base}${base.includes('?') ? '&' : '?'}set=${encodeURIComponent(slug)}`);
      render(slug);
    },
    true,
  );

  // A set is a place you can send someone — and a place you can leave.
  window.addEventListener('popstate', () => {
    const slug = new URLSearchParams(location.search).get('set') ?? '';
    if (data[slug] && slug !== current) render(slug);
  });

  conceal();
  startApi();
}

/**
 * ⚠ THE ONLY PROVIDER KNOWLEDGE IN THE BROWSER, and deliberately the smallest
 * possible: the id out of a URL the SERVER has already validated and stored
 * canonically. `song-link.ts` explains why the client must not learn to answer
 * *"may this be cited?"* — that is `parseSongRef`'s job and a second copy would
 * drift. These ask a much narrower question of a string already known to be a
 * playlist URL.
 */
function playlistId(url: string): string {
  return url.split('/playlist/')[1]?.split(/[/?#]/)[0] ?? '';
}

function embedSrc(url: string): string {
  return `https://open.spotify.com/embed/playlist/${playlistId(url)}?theme=0`;
}

/**
 * ⚠ `theme=0` MUST RIDE ON THE URL HANDED TO THE CONTROLLER, and leaving it off
 * is the whole of the bug Michael reported as *"the embed suddenly changes
 * colour"* on 2026-08-14. `createController` does not inherit anything from the
 * element it replaces — it builds a fresh embed from the `url` option — so
 * passing the bare canonical URL silently dropped the theme the server had been
 * applying, and the first switch turned a black panel blue.
 *
 * Measured, four ways, on the bluest playlist in the corpus:
 *
 *   • `url: https://open.spotify.com/playlist/<id>`            → BLUE
 *   • `url: https://open.spotify.com/playlist/<id>?theme=0`    → DARK  ← this
 *   • `url: https://open.spotify.com/embed/playlist/<id>?…`    → renders nothing
 *   • `uri: spotify:playlist:<id>` + `loadUri(…, 'dark')`      → renders nothing
 *
 * So the iFrame API takes a CANONICAL url and honours its query string, and the
 * documented `theme` argument on `loadUri` does not work — which is why `swap`
 * has no `loadUri` branch. Anything that builds a URL for the controller comes
 * through here.
 *
 * (`theme=0` is dark and `theme=1` is light; `black`, `white` and `dark` are all
 * ignored and fall back to the artwork gradient, which `theme=0` suppresses.)
 */
function themed(url: string): string {
  if (!url) return url;
  return `${url}${url.includes('?') ? '&' : '?'}theme=0`;
}
