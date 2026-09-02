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
//
// ⚠ AND SINCE 2026-09-01 IT ALSO CARRIES THE MOBILE ARRANGEMENTS, which are a
// live bench question — see `MusicSets.astro`'s `MOBILE_MODES` for what is being
// asked and the measurements behind it. Two of the four candidates need a tap
// behaviour that CSS cannot express; the rest of this file is unchanged and the
// desktop layout is not in question.
import { lockScroll, unlockScroll } from './scroll-lock';
import { focusTracker, isTouch, nearest, type FocusTracker } from './focus-mode';

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
type SetQuoteRow = {
  text: string;
  author: string;
  work?: string | null;
  /**
   * The two font sizes in rem, computed on the server from this quote's length.
   *
   * ⚠ THE ANSWER TRAVELS, NOT THE CURVE. A quote's size is a function of how
   * long it is (`lib/quote-scale.ts`), and this pane is the one surface on the
   * site that replaces a quote without a navigation — so either the ramp ships
   * to the browser or its answers do. Two numbers per set is smaller than the
   * function and cannot drift from what the server rendered.
   */
  size: { sm: number; lg: number } | null;
};
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

/**
 * ⚠ THE MOUNT THE DELEGATED LISTENERS ARE CURRENTLY SPEAKING FOR, and it exists
 * because those listeners live on `document` and `window` while everything they
 * act on lives in a DOM the router replaces. See `wireMusicSets` for the bug
 * that made this necessary; the shape is: the listeners bind ONCE per document
 * and read the live mount from here, so a navigation swaps the mount rather
 * than stacking a second copy of every handler on top of the first.
 *
 * `null` on a page with no music pane — which is most of them, and is why the
 * click handler asks. A stale `active` would let a `[data-set]` click on some
 * later page drive a render against a DOM that no longer exists.
 */
let active: {
  data: Record<string, SetRow>;
  base: string;
  render: (slug: string) => void;
  currentSlug: () => string;
  /** What a tap does beyond the swap, below `md`. See `syncSheet`. */
  afterTap: () => void;
  /** The history position moved. Re-derive the sheet from the URL. */
  onLeave: () => void;
  /** Is the sheet currently over the page — the only state that owns Escape. */
  sheetOpen: () => boolean;
  /** Every "I want out" gesture collapses here. See `wireMusicSets`. */
  closeIntent: () => void;
} | null = null;

let delegatesBound = false;

/**
 * The room element currently holding a scroll lock, so it can be released by
 * IDENTITY when its pane is swapped away.
 *
 * ⚠ THIS EXISTS BECAUSE `<html>` SURVIVES A VIEW TRANSITION — `scroll-lock.ts`
 * says so in its own words, and an unreleased hold would follow the reader to
 * the next page and strand them on a document that will not scroll, with no
 * sheet anywhere to close. Argument-less `unlockScroll()` is the documented
 * escape hatch for exactly that, and it is too broad here: it drops EVERY
 * owner, so a set pane leaving the DOM would also unfreeze the page behind an
 * open Reader. Holding the element is what makes the release precise.
 */
let sheetOwner: Element | null = null;

/**
 * Which index sentence the reader is ATTENDING TO — ADR 0022's model, adopted
 * here on 2026-09-01 for the affordance bench.
 *
 * ⚠ THIS IS THE HALF OF THE QUESTION THAT CSS CANNOT ANSWER. A `:hover` rule
 * covers a cursor and reaches a thumb never — *"hover is not a weaker signal on
 * touch, it is an absent one"* — so on a phone the sentence nearest the reading
 * line is lit instead, and the pointer is not consulted at all. `focusTracker`
 * owns that decision; this file only supplies the elements and the line.
 *
 * ⚠ AND IT LIVES AT MODULE SCOPE BECAUSE THE PANE IS REPLACED. `wireMusicSets`
 * runs on every arrival, and a tracker built against a dead DOM keeps a mode
 * subscription alive forever — `focus-mode.ts` says so in its own words. One
 * tracker, destroyed before the next is built.
 */
let indexTracker: FocusTracker | null = null;
let indexRows: HTMLElement[] = [];
let indexRaf = 0;

/* A fixed fraction rather than a scroll-derived line, matching the constellation
   overview: this index is a short list read by glancing, not a long page read
   top to bottom, so reading progress says nothing worth acting on. */
const READING_LINE = () => window.innerHeight * 0.45;

function trackIndexFocus(): void {
  if (!indexTracker || !isTouch()) return; // proximity is never consulted with a cursor
  cancelAnimationFrame(indexRaf);
  indexRaf = requestAnimationFrame(() => indexTracker?.setProximate(nearest(indexRows, READING_LINE())));
}

/** Has the third-party script tag been appended to THIS document yet. */
let apiRequested = false;

/**
 * Take ownership of the sets pane the server rendered.
 *
 * ⚠ THIS IS CALLED AGAIN ON EVERY NAVIGATION, AND UNTIL 2026-08-19 IT WAS NOT —
 * which is the whole of a bug Michael found on the live site: *"if I navigate
 * to the music section of the blog from the writing section, there is an
 * infinite loading skeleton of the playlist embed. Hard refreshing the page
 * will cause it to properly load."*
 *
 * The mechanism is the one this repo has now paid for several times, and it is
 * the same sentence every time: **a module script executes ONCE per document,
 * and a view-transition swap replaces the DOM without re-running it.** So
 * `blog/index.astro`'s `wireMusicSets()` ran against the writing view — where
 * there is no `#set-detail`, so it returned immediately, correctly — and when
 * the Music switch swapped a fresh pane into the page, nothing ran against it.
 * Nothing called `conceal()`, so nothing ever called `reveal()`; `is-ready` was
 * never added and the skeleton breathed forever. Not even the 4s deadline could
 * save it, because the deadline is armed by `conceal()`.
 *
 * ⚠ AND IT WAS THE ONLY PUBLIC SCRIPT MISSING THIS. `blog-feed`,
 * `constellation-suite`, `back-to-top` and `sky-slot` all re-init on
 * `astro:page-load` (or `after-swap`, for the one that must beat the paint).
 * This file was written as an exported function the page calls once, which
 * reads as a cost decision — *"it returns immediately on any page without one,
 * so the two text views pay nothing but the import"* — and quietly opted out of
 * the convention that made the rest of them survive a navigation. The early
 * return is still exactly right; it just needed to happen on every arrival
 * rather than on one.
 *
 * ⚠ SO IT MUST BE IDEMPOTENT, and the guard is on the ELEMENT rather than in a
 * module variable. A module flag cannot tell "already wired" from "wired
 * against a DOM that has since been replaced" — which is the only distinction
 * that matters here. A fresh pane is a fresh element and arrives without the
 * attribute, so it wires; the same pane asked twice in one document (the page's
 * own call plus the first `astro:page-load`) does not.
 */
export function wireMusicSets(): void {
  const detail = document.getElementById('set-detail');
  const slot = document.getElementById('set-embed-slot');
  const frame = document.getElementById('set-embed-frame');
  const dataEl = document.getElementById('set-data');
  if (!detail || !slot || !frame || !dataEl) {
    // No pane on this page. Drop the old one so the delegated listeners below
    // stop answering for a DOM that is gone.
    active = null;
    // And let go of the page, if a sheet was over it when the reader navigated.
    if (sheetOwner) {
      unlockScroll(sheetOwner);
      sheetOwner = null;
    }
    // A tracker outlives its DOM otherwise, holding a mode subscription for a
    // list of anchors that no longer exist.
    indexTracker?.destroy();
    indexTracker = null;
    indexRows = [];
    return;
  }
  if (detail.dataset.setsWired) return;
  detail.dataset.setsWired = '1';

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
  const titleEl = detail.querySelector<HTMLElement>('[data-set-title]');
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-set]')];
  let current = detail.dataset.open || Object.keys(data)[0];

  // ── the sheet, below `md` ─────────────────────────────────────────────────
  //
  // Ruled 2026-09-01 on `/lab/sets`; `MusicSets.astro`'s header carries the
  // question, the measurements and the three deleted rivals. What lives here is
  // only what CSS cannot do — CSS cannot know that a tap means "open".
  //
  // ⚠ THE BREAKPOINT IS ASKED AT TAP TIME, NOT AT WIRE TIME. `wireMusicSets`
  // runs once per pane and a phone can be rotated, so a `matchMedia` result
  // captured up here would be a stale answer to a question whose whole job is
  // to be current. It is one cheap synchronous read on an interaction.
  const room = detail.closest<HTMLElement>('.sets-room');
  const isNarrow = () => window.matchMedia('(max-width: 767px)').matches;

  /* The index's affordance tracker. Rebuilt against this pane's links, and the
     old one destroyed first — see `indexTracker`. The `setProximate` call is
     NOT behind the `isTouch` guard in `trackIndexFocus`, because a phone that
     lands and never scrolls has to be answered on the first pass. */
  indexTracker?.destroy();
  indexRows = links;
  indexTracker = links.length ? focusTracker(links) : null;
  indexTracker?.setProximate(isTouch() ? nearest(indexRows, READING_LINE()) : null);

  /**
   * ⚠ THE SHEET IS A CLASS ON THE ROOM AND NOTHING ELSE, because the pane must
   * not move. `MusicSets.astro`'s CSS lifts it out of flow with `position:
   * fixed`; the node stays exactly where the server put it, so the embed inside
   * it is never re-parented and never reloads. That is the same constraint that
   * killed `accordion` on the first bench, honoured a different way.
   *
   * ⚠ AND THE SCROLL LOCK IS THE SITE'S OWN, not a local `overflow: hidden`.
   * `scroll-lock.ts` counts owners, which is what stops this from fighting the
   * Reader if a quote's sheet is ever openable from inside a set.
   */
  /**
   * ⚠ THE LOCK IS RE-ASSERTED RATHER THAN TAKEN ONCE, AND THAT IS NOT BELT AND
   * BRACES — it is the fix for a bug measured on 2026-09-01, on the one path
   * that reaches it: back out of an open sheet, then go FORWARD again.
   *
   * What happens, in order: `popstate` fires and this opens the sheet and locks
   * the page; THEN the ClientRouter runs its view transition, which **replaces
   * the room element and wipes `<html>`'s entire class list** — `scroll-locked`
   * with it. `astro:page-load` re-wires against the fresh pane and calls this
   * again, but `scroll-lock.ts` still counts the OLD room as an owner, so its
   * `wasEmpty` check is false and it never re-adds the class it just lost. The
   * sheet comes back open over a page that scrolls behind it.
   *
   * Both halves are handled here rather than in `scroll-lock.ts`, which is
   * correct as written: owning-by-element is exactly right, and it cannot be
   * expected to know that somebody else erased its class. What it needs from a
   * caller that survives a DOM swap is to be told which owner is stale.
   */
  const openSheet = () => {
    if (!room) return;
    const already = room.classList.contains('is-open');
    // A previous pane's room, still holding the lock after the router replaced
    // it. Released by identity — never `unlockScroll()` bare, which would drop
    // an open Reader's hold too.
    if (sheetOwner && sheetOwner !== room) unlockScroll(sheetOwner);
    room.classList.add('is-open');
    unlockScroll(room);
    lockScroll(room);
    sheetOwner = room;
    // A sheet opens at its top — but only on a real open. Re-asserting the lock
    // on an already-open sheet must not throw the reader back to the first line.
    if (!already) detail.scrollTop = 0;
  };
  const closeSheet = () => {
    if (!room || !room.classList.contains('is-open')) return;
    room.classList.remove('is-open');
    unlockScroll(room);
    if (sheetOwner === room) sheetOwner = null;
  };

  /**
   * ⚠ ONE INVARIANT GOVERNS THE WHOLE SHEET: **below `md`, it is open exactly
   * when the URL names a set.** Everything else follows from that and nothing
   * needs its own rule — a tap pushes `?set=` and opens; the phone's back
   * gesture pops it away and closes; a shared `?set=` link arrives open; the
   * close control rewrites the URL and shuts. Four gestures, one fact.
   *
   * ⚠ AND THE CLOSE CONTROL DOES NOT CALL `history.back()`, which is where the
   * first version of this went wrong. Routing dismissal through the history
   * stack means dismissal can FAIL — and it did, measured: `history.back()`
   * invoked from a keydown handler produced no `popstate` and no URL change at
   * all, while the identical call from a click did. Reproduced with an unrelated
   * key and an empty handler, so it is the platform rather than this file, and
   * it may well be headless-only. It does not matter which: a sheet that stays
   * shut only if a history API cooperates is a sheet that can trap someone, and
   * ADR 0032's whole finding is that *"a modal that will not close does not read
   * as protected; it reads as stuck."*
   *
   * So the control closes the sheet ITSELF and rewrites the URL to match.
   * `replaceState` rather than `back()` also fixes the case that made the first
   * version need a flag: `/listening?set=<slug>` is a URL somebody can be SENT,
   * where there is no pushed entry to pop and "back" means "leave this site
   * entirely" — the one thing a close control must never do.
   */
  const syncSheet = () => {
    if (!isNarrow()) return;
    const named = new URLSearchParams(location.search).get('set');
    if (named && data[named]) openSheet();
    else closeSheet();
  };

  /*
    ⚠ A DEEP LINK OPENS THE SHEET ON ARRIVAL, and the room is pointless without
    it: `?set=<slug>` is the link the share control produces, and on a phone it
    would otherwise land on the index with the set it names hidden behind it —
    eight sentences and no reason the link was sent.

    ⚠ THE PARAM MUST BE PRESENT, not merely resolvable, which is why `syncSheet`
    reads the URL rather than asking the pane what is open. `resolveSet` falls
    back to the first set, so a bare `/listening` always renders with something
    open — and treating that as a deep link would mean the room opens as a sheet
    over an index nobody has touched, every single time. Only an explicit `?set=`
    is an instruction.
  */
  syncSheet();

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
    // Overwritten deliberately when a second pane arrives before the script
    // resolves: the newest mount is the one that should be built.
    w.onSpotifyIframeApiReady = (api: IFrameAPI) => {
      w.SpotifyIframeApi = api;
      build(api);
    };
    // ⚠ ONCE PER DOCUMENT, not once per pane. `startApi` runs on every arrival
    // at the music view now, and the document never reloads — so without this
    // a reader crossing Writing ⇄ Music four times would append four copies of
    // the same third-party script to <head>, each a fresh request for a file
    // whose only export is a global the first one already set.
    if (!apiRequested) {
      apiRequested = true;
      const s = document.createElement('script');
      s.src = API_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
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
    // `textContent`, for the same reason the quote below uses it: a title is one
    // plain string and building it from parts means no path here can inject
    // markup. Written unconditionally even though only `lead` and `sheet` show
    // it — a hidden element holding the wrong set's title is a bug waiting for
    // whichever arrangement wins.
    if (titleEl) titleEl.textContent = row.title;
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
    /*
      ⚠ THE SIZE IS SET ON THE `<blockquote>`, NOT ON THE `<p>` THAT HOLDS THE
      WORDS, because that is where the server puts it and `.quote-ramp` is on
      the same element. Setting it a level down would give the pane two sources
      of truth for one number and the swap would silently disagree with the
      first paint.
    */
    const block = fig.querySelector<HTMLElement>('blockquote');
    if (block && q.size) {
      block.style.setProperty('--qs', `${q.size.sm}rem`);
      block.style.setProperty('--ql', `${q.size.lg}rem`);
    }
    if (text) text.textContent = q.text;
    if (author) author.textContent = q.author;
    if (q.work) {
      // The work span is absent whenever the server rendered a quote without
      // one, so it has to be creatable rather than merely fillable.
      if (!work && author?.parentElement) {
        work = document.createElement('span');
        // Must match MusicSets.astro's server-rendered span — see the note there
        // for why the work is italic rather than fainter.
        work.className = 'italic';
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
      // ⚠ ONE CLASS, NOT THREE UTILITIES (2026-09-01). This used to toggle
      // `text-primary` / `text-whisper` / `hover:text-base-content/75` by hand,
      // which meant the index's colour was stated in two places — here and in
      // the component's class list — and any treatment the affordance bench
      // proposed would have had to be restated here too, or the first swap
      // would undo it. `.is-open` is the state; the stylesheet owns the ink.
      a.classList.toggle('is-open', on);
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
  /*
    ⚠ THE CLOSE CONTROL BINDS TO THE PANE AND NOT TO THE DOCUMENT, unlike the
    two listeners below, and the asymmetry is not an oversight: those exist
    because they act on anchors the router also wants, and because they must
    survive a pane being replaced. This button IS part of the pane, so it dies
    with it and needs no delegation.

    ⚠ AND IT GOES THROUGH `closeIntent` RATHER THAN CLOSING DIRECTLY, which is
    `Reader.astro`'s rule in the same words: *"every close intent collapses to"*
    one path. This control, Escape and the phone's back gesture are three
    gestures meaning the same thing, and ADR 0032's finding was that hand-wiring
    them per surface is exactly how they drift apart.
  */
  detail.querySelector('[data-set-close]')?.addEventListener('click', () => active?.closeIntent());

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
  // Hand this mount to the document-level listeners, which were bound once and
  // outlive every pane they drive.
  active = {
    data,
    base,
    render,
    currentSlug: () => current,
    /*
      What a tap does BEYOND swapping the pane. Above `md` it does nothing, and
      correctly: there the pane is already beside the index and has never needed
      help being seen. The whole mobile question lives in this one branch.
    */
    afterTap: () => syncSheet(),
    /*
      ⚠ BACK MUST DISMISS THE SHEET, and the `popstate` handler could not do it
      before: it re-rendered only when the URL named a DIFFERENT set, so backing
      out to a URL with no `?set=` at all matched nothing and fell through
      silently. Harmless while the pane was always visible; it is the difference
      between a sheet you can leave and one you cannot.

      It is `syncSheet` rather than a bare close because back is not the only way
      to arrive here — FORWARD lands on a URL that names a set again, and the
      invariant says that is an open sheet.
    */
    onLeave: () => syncSheet(),
    sheetOpen: () => !!room?.classList.contains('is-open'),
    /* The URL is the state, so closing means rewriting it. See `syncSheet`. */
    closeIntent: () => {
      const url = new URL(location.href);
      url.searchParams.delete('set');
      history.replaceState(null, '', url);
      closeSheet();
    },
  };
  bindDelegates();

  conceal();
  startApi();
}

/**
 * The two listeners that cannot live on the pane, bound once per document.
 *
 * ⚠ THEY USED TO BE INSIDE `wireMusicSets`, WHICH WAS CORRECT WHILE IT RAN ONCE
 * AND IS A LEAK NOW THAT IT RUNS PER NAVIGATION. Left there, every trip through
 * the Music switch would add another capturing click listener and another
 * `popstate` listener to a document that never reloads — each closed over a
 * dead pane, each still calling `preventDefault()` and `stopPropagation()`, and
 * the oldest one winning. Reading the live mount out of `active` is what lets
 * there be exactly one of each.
 */
function bindDelegates(): void {
  if (delegatesBound) return;
  delegatesBound = true;

  /* Proximity, for the index's affordance on a device that cannot point. Bound
     once per document like everything else here; `trackIndexFocus` returns
     immediately where there is no pane or where a cursor exists. */
  addEventListener('scroll', trackIndexFocus, { passive: true });
  addEventListener('resize', trackIndexFocus);

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
      if (!active) return; // no pane on this page — let the router have it
      const el = (e.target as HTMLElement | null)?.closest?.('[data-set]') as HTMLElement | null;
      if (!el) return;
      // ⌘/Ctrl/Shift-click still opens the real URL — the interception is an
      // enhancement, not a replacement.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const slug = el.dataset.set ?? '';
      // ⚠ THE GUARD MOVED ABOVE `preventDefault`, and it had to. Swallowing a
      // click we then decline to act on is how a link becomes inert: a
      // `[data-set]` anchor for a set this pane does not know would have been
      // cancelled here and navigated nowhere. Now it falls through to the
      // router, which is the honest outcome and the no-JS floor besides.
      if (!active.data[slug]) return;
      e.preventDefault();
      e.stopPropagation();

      /*
        ⚠ THREE QUESTIONS THAT USED TO BE ONE, and collapsing them was a bug the
        sheet made visible. The old guard was `if (slug === currentSlug) return`
        — one test standing in for "is there anything to do at all" — which was
        right while the pane was always on screen and the only possible response
        was a re-render.

        With a sheet there are two more responses, and they do not agree with
        each other:

          · PUSH — should the address bar start naming this set? Yes whenever it
            does not already, INCLUDING when the pane is already showing it.
            Dismiss-then-tap-the-same-set is the most ordinary gesture there is,
            and under the old guard it reopened a sheet the URL denied was open,
            with a back button that skipped straight off the page.
          · RENDER — should the pane's contents change? Only on a real change.
            Rewriting the same words would flash the embed for nothing.
          · RESPOND — should anything happen visibly? Always. "Already selected"
            was never a reason to swallow a tap.
      */
      if (new URLSearchParams(location.search).get('set') !== slug) {
        const base = active.base;
        history.pushState({ set: slug }, '', `${base}${base.includes('?') ? '&' : '?'}set=${encodeURIComponent(slug)}`);
      }
      if (slug !== active.currentSlug()) active.render(slug);
      active.afterTap();
    },
    true,
  );

  // A set is a place you can send someone — and a place you can leave.
  window.addEventListener('popstate', () => {
    if (!active) return;
    const slug = new URLSearchParams(location.search).get('set') ?? '';
    if (active.data[slug] && slug !== active.currentSlug()) active.render(slug);
    // ⚠ UNCONDITIONALLY, not only when the set is gone. The URL is the sheet's
    // state, so every move through history has to be re-derived — back to a
    // bare `/listening` closes it, forward to a `?set=` opens it again, and a
    // move between two sets leaves it open while the pane swaps underneath.
    active.onLeave();
  });

  /*
    ⚠ ESCAPE, BECAUSE A SHEET THAT TRAPS YOU IS THE ONE THING ADR 0032 REFUSES.
    A `<dialog>` would give this for free and the room cannot have one — moving
    the pane into the top layer means moving the node, and that reloads the
    embed. So the key is bound by hand, which is the price of the constraint.
  */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !active) return;
    /*
      ⚠ GATED ON THE SHEET BEING OPEN, not on there being a pane. Without this
      the room would swallow Escape on every `/listening?set=<slug>` at every
      width — a key that did nothing visible on desktop and quietly walked the
      reader back through their history. Escape belongs to whatever is on top,
      and when no sheet is open that is not this.
    */
    if (!active.sheetOpen()) return;
    active.closeIntent();
  });
}

// ⚠ THE RE-INIT, AND IT LIVES HERE RATHER THAN IN THE PAGE. `/music` still
// calls `wireMusicSets()` itself, which is what covers a first arrival straight
// onto the room; this covers every arrival after it. Putting the listener in the
// module means the rule travels with the thing it protects — the page cannot
// forget it, and neither can the next surface that mounts a sets pane.
// Registered once, because this module body runs once.
//
// ⚠ AND THE BUG THIS EXISTS FOR IS NOT FIXED BY THE ROUTE MOVE (ADR 0040). It
// was found crossing from Writing to Music inside `/blog`, but every word of it
// is about the ROUTER rather than about that page: a module script executes once
// per document, and a view-transition swap replaces the DOM without re-running
// it. `Blog → Music` in the top bar is the same swap across two routes.
document.addEventListener('astro:page-load', () => wireMusicSets());

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
