// The music room's palette — `/blog?view=music` (docs/plans/33 §4, §5, §7).
//
// The server has already rendered the field at its correct sizes and the right
// cards shown, so this file changes nothing on load. What it adds is the room
// working WITHOUT a navigation: press a word, the field collapses toward what is
// still reachable, the room shortens, and the URL keeps up.
//
// ⚠ NOTHING HERE IS EVER RE-RENDERED, and that is the constraint everything else
// bends around. Re-parenting an `<iframe>` reloads it, so replacing the field's
// markup or the card list would stop whatever is playing and restart it from
// zero. Every change below is a style, a class or an attribute on a node that
// was already there.
//
// ⚠ AND THE COUNTS COME FROM THE INDEX, NEVER FROM THE DOM (ruling 3). The
// palette must describe the whole qualifying corpus, not the page that happens
// to be loaded. Counting `.song-card` elements would work perfectly today and
// become a silent lie the day cards are delivered a window at a time — which is
// the change this seam exists to make survivable.
import {
  type FacetIndex,
  matching,
  maskOf,
  musicHref,
  parseFeelings,
  toggleFeeling,
  wordStates,
  wordWeight,
} from '../lib/music-room';

const MIN_REM = 1.05;
const MAX_REM = 2.75;

export function wireMusicRoom(): void {
  const field = document.getElementById('feel-field');
  const list = document.getElementById('feel-list');
  if (!field || !list) return;

  let index: FacetIndex;
  try {
    const parsed = JSON.parse(field.dataset.index ?? '') as Omit<FacetIndex, 'dropped'>;
    index = { ...parsed, dropped: [] };
  } catch {
    return; // no index → the server-rendered room stands, links and all
  }

  // Where a word's link points. The server put it here rather than the client
  // assuming `/blog`: the bench mounts this same component at its own path, and
  // a pushState to a path you are not on makes the address bar lie.
  const base = field.dataset.base || '/blog?view=music';
  const liveEl = document.getElementById('feel-live');
  const emptyEl = document.getElementById('feel-empty');
  const words = [...field.querySelectorAll<HTMLElement>('.feel-word')];
  const cards = [...list.querySelectorAll<HTMLElement>('.song-card')];
  const hideTimers = new WeakMap<HTMLElement, number>();

  let selected: string[] = [];

  // --- the field ------------------------------------------------------------

  /**
   * ⚠ THE FIELD MOVES BY TRANSFORM, NOT BY `font-size`, and this is the visible
   * half of the jank fix. Animating font-size over 380ms means the flex row
   * RE-WRAPS on every frame: a word that ends up on line two spends the
   * transition migrating there, so stacking a second word looked like the whole
   * field scrambling rather than settling.
   *
   * FLIP fixes it exactly. Measure where every word IS, apply the new sizes in
   * one synchronous write so layout re-wraps ONCE, measure where every word
   * LANDED, then invert the difference with a transform and let that animate to
   * zero. Transforms do not affect layout, so nothing re-wraps mid-flight.
   *
   * Measuring `first` while a previous animation may still be running is
   * deliberate: `getBoundingClientRect` reports the CURRENT transformed box, so
   * an interrupted transition continues from where the eye last saw it instead
   * of snapping back.
   */
  const flipField = (apply: () => void) => {
    const first = words.map((w) => w.getBoundingClientRect());
    words.forEach((w) => {
      w.style.transition = 'none';
      w.style.transform = 'none';
    });
    apply();
    const last = words.map((w) => w.getBoundingClientRect());
    words.forEach((w, i) => {
      const f = first[i];
      const l = last[i];
      const dx = f.left - l.left;
      const dy = f.top - l.top;
      const scale = l.width > 0 ? f.width / l.width : 1;
      if (!dx && !dy && Math.abs(scale - 1) < 0.001) {
        w.style.transition = '';
        return;
      }
      w.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    });
    requestAnimationFrame(() => {
      words.forEach((w) => {
        w.style.transition = ''; // back to the CSS rule
        w.style.transform = '';
      });
    });
  };

  // --- players --------------------------------------------------------------

  /**
   * ⚠ MOUNT ON APPROACH, NOT ON REVEAL. The room opens with the whole corpus, so
   * "revealed" as a proxy for "about to be looked at" would spawn a frame per
   * song on arrival. A card mounts when it comes within 600px of the viewport
   * and is in the set, and never again. Scrolling the whole room still mounts
   * everything; what this bounds is the cost of ARRIVING.
   */
  const NEAR = 600;
  const nearViewport = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect();
    return r.bottom > -NEAR && r.top < window.innerHeight + NEAR;
  };

  const mountEmbed = (card: HTMLElement) => {
    const slot = card.querySelector<HTMLElement>('[data-embed]');
    if (!slot || slot.dataset.mounted === '1') return;
    const src = slot.dataset.src;
    if (!src) return;
    slot.dataset.mounted = '1';
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.loading = 'lazy';
    iframe.title = slot.dataset.title ?? '';
    // ⚠ `allow` is not optional and its absence fails INTERMITTENTLY — Chrome
    // blocks autoplay and encrypted-media in a cross-origin frame unless the
    // embedder delegates them, and weighs its per-origin Media Engagement Index
    // on top. See `MediaEmbed.allow`; this string comes from the provider's own
    // embed code by way of the server.
    iframe.setAttribute('allow', slot.dataset.allow ?? '');
    iframe.style.border = '0';
    if (slot.dataset.height === 'video') {
      slot.className = 'aspect-video overflow-hidden';
      slot.style.borderRadius = 'var(--radius-box)';
      iframe.className = 'h-full w-full';
    } else {
      iframe.width = '100%';
      iframe.height = slot.dataset.height ?? '152';
      iframe.style.borderRadius = 'var(--radius-box)';
    }
    slot.appendChild(iframe);
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const card = e.target as HTMLElement;
        if (card.hidden) continue; // out of the set — leave it observed
        mountEmbed(card);
        io.unobserve(card);
      }
    },
    { rootMargin: `${NEAR}px 0px` },
  );
  cards.forEach((c) => io.observe(c));

  /**
   * ⚠ LEAVING THE ROOM STOPS THE SOUND, and removing the iframe is the only way
   * to do it — a cross-origin frame cannot be paused from outside.
   *
   * This is the narrow exception to "a player is built once and left alone", and
   * the two rules only look like a conflict until you say what the first one is
   * protecting: NARROWING must not kill music that is still on screen. A song
   * the filter has excluded is not on screen, so its sound has no business
   * continuing. The card is already hidden by the time this runs.
   */
  const unmountEmbed = (card: HTMLElement) => {
    if (!card.hidden) return; // it came back before we got to it
    const slot = card.querySelector<HTMLElement>('[data-embed]');
    if (!slot || slot.dataset.mounted !== '1') return;
    slot.replaceChildren();
    slot.dataset.mounted = '';
    slot.className = '';
    slot.style.borderRadius = '';
    io.observe(card); // eligible to mount again
  };

  /**
   * ⚠ TEARDOWN WAITS OUT THE COLLAPSE, and skipping that costs exactly the jank
   * the phasing below removes. Narrowing a room of 48 down to 11 destroys 37
   * cross-origin frames; starting at 310ms — mid-animation — measured 13 long
   * frames with a 133ms worst case, because the browser was destroying frames
   * and interpolating the whole field in the same frames. Deferring past the
   * 380ms and draining on idle measured zero. The cost is a 0.5–1s tail of sound
   * after a song leaves the set, which is a real thing to judge and is written
   * into the plan as one.
   */
  const unmountQueue: HTMLElement[] = [];
  let draining = false;
  type IdleCb = (d: { timeRemaining: () => number }) => void;
  // Read off `window` ONCE rather than `'requestIdleCallback' in window` inline:
  // that narrowing collapses `window` to `never` in the else branch, so the
  // setTimeout fallback stops type-checking.
  const ric = (window as unknown as { requestIdleCallback?: (f: IdleCb, o?: object) => void }).requestIdleCallback;
  const idle = (fn: IdleCb, timeout = 400) => {
    if (ric) ric.call(window, fn, { timeout });
    else window.setTimeout(() => fn({ timeRemaining: () => 8 }), 60);
  };
  const drainUnmounts: IdleCb = (deadline) => {
    const t0 = performance.now();
    while (unmountQueue.length && performance.now() - t0 < Math.max(4, deadline.timeRemaining())) {
      unmountEmbed(unmountQueue.shift()!);
    }
    if (unmountQueue.length) idle(drainUnmounts);
    else draining = false;
  };
  const queueUnmount = (card: HTMLElement) => {
    unmountQueue.push(card);
    if (draining) return;
    draining = true;
    window.setTimeout(() => idle(drainUnmounts), 220);
  };

  const hide = (card: HTMLElement) => {
    if (card.hidden || card.classList.contains('is-out')) return;
    card.classList.add('is-out');
    hideTimers.set(
      card,
      window.setTimeout(() => {
        card.hidden = true;
        hideTimers.delete(card);
        queueUnmount(card);
      }, 310),
    );
  };

  /**
   * ⚠ READS AND WRITES ARE STRICTLY PHASED, and that is the whole fix for the
   * jank Michael reported on 2026-08-10 (*"everything's recomputing"*). The
   * recompute was never the problem — sixteen words against fifty songs is
   * microseconds. The problem was interleaving per card: write `hidden`, read a
   * rect, write an iframe, read `offsetHeight`, write a class, in a loop. Every
   * read after a write forces a synchronous layout, so one press cost up to
   * ninety-odd full layouts of a tree containing live third-party iframes.
   *
   * Decide with no DOM, write every `hidden`, force ONE reflow, write every
   * class. Mounting happens in a later frame and reads all its rects before it
   * writes any iframe.
   */
  const applyVisibility = (wanted: Set<string>) => {
    cards.forEach((card) => {
      if (!wanted.has(card.dataset.song ?? '')) return;
      const t = hideTimers.get(card);
      if (t) {
        clearTimeout(t);
        hideTimers.delete(card);
      }
      card.hidden = false;
    });
    // One flush for the batch, so removing `is-out` below actually transitions
    // instead of collapsing into the same frame as `display`.
    void list.offsetHeight;
    cards.forEach((card) => {
      if (wanted.has(card.dataset.song ?? '')) card.classList.remove('is-out');
      else hide(card);
    });
  };

  const mountVisible = () => {
    const pending: HTMLElement[] = [];
    for (const card of cards) {
      if (card.hidden) continue;
      const slot = card.querySelector<HTMLElement>('[data-embed]');
      if (!slot || slot.dataset.mounted === '1') continue;
      if (nearViewport(card)) pending.push(card);
    }
    for (const card of pending) {
      mountEmbed(card);
      io.unobserve(card);
    }
  };

  // --- the live region ------------------------------------------------------

  /**
   * Announce the settled count, never the first render (ruling 7). Coalesced, so
   * stacking three words quickly says one number rather than three — which
   * matches how the collapse itself resolves, and is the difference between a
   * useful announcement and a reason to turn announcements off.
   */
  let announceTimer = 0;
  const announce = (n: number) => {
    if (!liveEl) return;
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      liveEl.textContent = `${n} ${n === 1 ? 'song' : 'songs'}`;
    }, 450);
  };

  // --- the render -----------------------------------------------------------

  const render = (announceCount: boolean) => {
    const states = wordStates(index, selected);
    const max = Math.max(1, ...states.map((s) => s.count));

    flipField(() => {
      words.forEach((el, i) => {
        const s = states[i];
        el.style.fontSize = s.selected
          ? `${MAX_REM}rem`
          : `${(MIN_REM + (MAX_REM - MIN_REM) * wordWeight(s.count, max)).toFixed(3)}rem`;
        el.style.opacity = s.selected ? '1' : s.disabled ? '0.12' : String(0.4 + 0.6 * (s.count / max));
        el.classList.toggle('is-on', s.selected);
        el.classList.toggle('is-out', s.disabled);
        el.setAttribute('aria-pressed', String(s.selected));
        if (s.disabled) el.setAttribute('aria-disabled', 'true');
        else el.removeAttribute('aria-disabled');
        // The href stays honest even while script is driving: copying a word's
        // link mid-session must give the URL that selection would produce.
        el.setAttribute('href', musicHref(toggleFeeling(selected, s.slug), base));
      });
    });

    const inSet = matching(index.songs, maskOf(index.vocabulary, selected));
    const wanted = new Set(inSet.map((s) => s.id));
    applyVisibility(wanted);
    requestAnimationFrame(mountVisible);

    for (const card of cards) {
      card.querySelectorAll<HTMLElement>('.song-word').forEach((el) => {
        const slug = el.dataset.feel ?? '';
        el.classList.toggle('is-on', selected.includes(slug));
        el.setAttribute('href', musicHref(toggleFeeling(selected, slug), base));
      });
    }

    if (emptyEl) {
      if (selected.length && wanted.size === 0) {
        // ⚠ FAILING WELL: name the nearest thing that DOES exist. Rare — every
        // word that would empty the room is a dead end before you can press it —
        // but reachable by following a shared link whose combination has since
        // stopped holding, which is exactly the reader who deserves an exit.
        const near = selected
          .map((slug) => {
            const rest = selected.filter((s) => s !== slug);
            return { slug, n: matching(index.songs, maskOf(index.vocabulary, rest)).length };
          })
          .sort((a, b) => b.n - a.n)[0];
        const name = index.vocabulary.find((w) => w.slug === near.slug)?.name ?? near.slug;
        emptyEl.replaceChildren();
        const head = document.createElement('p');
        head.className = 'text-base-content/45 font-serif text-lg italic';
        head.textContent = 'Nothing holds all of that at once.';
        const sub = document.createElement('p');
        sub.className = 'text-base-content/35 mt-3 font-sans text-sm';
        sub.append('Let go of ');
        const a = document.createElement('a');
        a.href = musicHref(toggleFeeling(selected, near.slug), base);
        a.dataset.feel = near.slug;
        a.className = 'text-primary underline underline-offset-4';
        a.textContent = name;
        sub.append(a, ` and ${near.n} ${near.n === 1 ? 'song' : 'songs'} remain.`);
        emptyEl.append(head, sub);
        emptyEl.hidden = false;
      } else {
        emptyEl.hidden = true;
      }
    }

    if (announceCount) announce(wanted.size);
  };

  // --- input ----------------------------------------------------------------

  const setSelection = (next: string[], push: boolean) => {
    selected = next;
    if (push) history.pushState({ feel: next }, '', musicHref(next, base));
    render(true);
  };

  /**
   * ⚠ CAPTURE PHASE AND `stopPropagation`, AND WITHOUT THEM THIS ENTIRE FILE IS
   * DECORATION. Found by driving the bench on 2026-08-11: pressing a word looked
   * like it worked — the field re-sized, the room narrowed, the URL updated — and
   * none of it was this code. The site mounts `<ClientRouter />`, whose own
   * document-level click listener claims any `<a href>` and NAVIGATES. Every
   * word here is a real anchor (that is the no-JS floor), so the router won a
   * race that a bubble-phase `preventDefault()` cannot enter: it had already
   * started the transition. What the eye saw was a server round trip per press,
   * with a document swap in the middle.
   *
   * The tell was the live region going empty after correctly saying "5 songs" —
   * the node it had been written into was gone, replaced by the swap. Which is
   * also what would have happened to every playing `<iframe>`: §5's whole
   * proposition is that a player survives a filter change, and a navigation
   * destroys all of them.
   *
   * `Reader.astro` hit this first and documents the same fix in the same words.
   * Capturing lets us claim the click before the router sees it; stopping
   * propagation is what keeps it claimed.
   */
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-feel]') as HTMLElement | null;
      if (!el) return;
      // ⌘/Ctrl/Shift-click still opens the real URL in a tab — every word is a
      // link, and the interception is an enhancement rather than a replacement.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (el.getAttribute('aria-disabled') === 'true') return;
      setSelection(toggleFeeling(selected, el.dataset.feel ?? ''), true);
    },
    true,
  );

  /** The URL is the state — the same read the server does, from the same function. */
  const fromUrl = () => parseFeelings(new URLSearchParams(location.search).get('feeling'), index.vocabulary);

  // Back and forward move through selections, because §7's whole claim is that a
  // combination is a place you can send someone — and a place you can leave.
  window.addEventListener('popstate', () => {
    selected = fromUrl();
    render(true);
  });

  // The server already rendered this state; the first pass only takes ownership
  // of it (and mounts whatever is on screen). No announcement — see `announce`.
  selected = fromUrl();
  render(false);
}
