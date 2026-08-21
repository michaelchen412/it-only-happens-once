// ShareMark's behaviour — hand this fragment's address to someone. The markup,
// the placement argument and the styles live in `components/ShareMark.astro`.
//
// ⚠ A MODULE RATHER THAN A COMPONENT `<script>`, for the reason spelled out in
// `scripts/reveal.ts`: Astro emits a component's script beside the component,
// and this control renders inside reader `<template>`s and inside articles the
// Reader FETCHES — and a script that arrives through `DOMParser` is marked
// "already started" and can never run. Delegating from `document` was always
// the right shape; it just needs something to guarantee the delegation is
// installed. Measured in production 2026-08-21: a fetched essay's share mark
// was a live-looking button that did nothing at all.

/** Idempotent: the flag lives on <html>, which survives view transitions, so a
 *  second copy of this code cannot double-fire a share. */
export function initShareMark() {
  if (document.documentElement.dataset.shareBound) return;
  document.documentElement.dataset.shareBound = '1';

  let said: HTMLElement | null = null;
  let timer = 0;
  const say = (msg: string) => {
    if (!said) {
      said = document.createElement('div');
      said.className = 'share-said';
      said.setAttribute('role', 'status');
      said.setAttribute('aria-live', 'polite');
      document.body.append(said);
    }
    said.textContent = msg;
    said.setAttribute('data-on', '');
    clearTimeout(timer);
    timer = window.setTimeout(() => said?.removeAttribute('data-on'), 1800);
  };

  document.addEventListener('click', async (e) => {
    const btn = (e.target as Element)?.closest?.('[data-share]') as HTMLElement | null;
    const path = btn?.dataset.share;
    if (!path) return;
    // Absolute, because a relative URL in a share sheet or on a clipboard is
    // meaningless the moment it leaves this document.
    const url = new URL(path, location.origin).href;

    // navigator.share first: on a phone this is the native sheet — iMessage,
    // WhatsApp, the thing people actually use. Clipboard is the desktop
    // fallback, and it is the COMMON path on laptops rather than an edge case:
    // Firefox desktop has no share API at all.
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch (err) {
        // ⚠ AbortError means the reader DISMISSED the sheet — they chose not
        // to share. It is not a failure, and falling through to "Link copied"
        // would tell them a small lie about what just happened.
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied');
    } catch {
      say('Couldn’t copy — the link is in the address bar');
    }
  });
}
