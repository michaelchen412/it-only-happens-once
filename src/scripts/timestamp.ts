// The reader's half of `Timestamp.astro` — the parts of a date that depend on
// WHEN and WHERE someone is reading, which a server cannot know.
//
// ⚠ THIS EXISTS BECAUSE THE SERVER GOT BOTH WRONG AT ONCE (2026-11-13). An essay
// published at 7:02pm in New York showed "Yesterday", and its popover said
// "Last updated on Saturday, November 14, 2026 at 12:02 AM". Michael, at 7pm
// on Friday the 13th: "says published yesterday and last edited at midnight."
//
//   · "Yesterday" — the component measured TODAY on the server's clock, which
//     is UTC, where it was already the 14th. And even a right answer there
//     would rot: a public page is edge-cached, so a "Today" rendered on Monday
//     is still being served on Tuesday. A relative day is relative to the
//     READER, so only the reader's device can say it.
//   · "12:02 AM" — `updated_at` is an INSTANT, formatted on a UTC server. The
//     component's own comment recorded this as the one place it broke the
//     no-UTC-on-screen rule, deferred for want of a format that keeps the year.
//
// So the server now renders only what is true everywhere — the calendar date
// itself — and this upgrades it: "Today" / "Yesterday" / a weekday from the
// reader's own date, and the update in the reader's own zone.
//
// ⚠ AND "LAST UPDATED" ONLY WHEN IT IS NEWS. `updated_at` moves on the publish
// write itself — 0.1s after `published_at` on both essays that night — so the
// line appeared on every piece the moment it went live, announcing an edit
// that never happened. It shows now only when the update falls on a LATER DAY
// than the publish did, in the reader's zone: a typo fixed ten minutes after
// posting is not something a reader is being told. Measured from the publish
// INSTANT when the page has it, because both ends are then instants and the
// answer is the same in every zone; from the calendar date when it does not
// (quotes, which mostly have no `published_at`).
import { onPage } from './page';

const DAY_MS = 86_400_000;
const CAL = { timeZone: 'UTC' } as const;

/** A `YYYY-MM-DD` calendar date as a comparable day number (UTC midnight). */
function dayOf(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

/** The reader's own calendar day for an instant, on the same scale as `dayOf`. */
function localDay(at: Date): number {
  return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());
}

export function renderTimestamps(root: ParentNode = document): void {
  const now = new Date();
  const today = localDay(now);

  // The surface token: a calendar date, relabelled against the reader's today.
  root.querySelectorAll<HTMLTimeElement>('time[data-ts-day]').forEach((el) => {
    const day = dayOf(el.dataset.tsDay ?? '');
    if (day === null) return;
    const diff = Math.round((today - day) / DAY_MS);
    const d = new Date(day);
    // A calendar date has no zone, so it is read back in UTC, where it was
    // written (ADR 0039) — never in the reader's zone, which would move it.
    el.textContent =
      diff === 0
        ? 'Today'
        : diff === 1
          ? 'Yesterday'
          : diff > 1 && diff < 7
            ? d.toLocaleDateString('en-US', { ...CAL, weekday: 'long' })
            : d.toLocaleDateString('en-US', {
                ...CAL,
                month: 'long',
                day: 'numeric',
                // The year only when it is not this one — the reader's year.
                ...(d.getUTCFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
              });
  });

  // The popover's "Last updated" line: an instant, in the reader's zone.
  root.querySelectorAll<HTMLElement>('[data-ts-updated]').forEach((line) => {
    const time = line.querySelector('time');
    // An instant (the publish) or a calendar date (the fallback).
    const since = line.dataset.tsUpdated ?? '';
    const posted = since.includes('T') ? localDay(new Date(since)) : dayOf(since);
    if (!time || posted === null || Number.isNaN(posted)) return;
    const at = new Date(time.dateTime);
    if (Number.isNaN(at.getTime())) return;
    time.textContent = `${at.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })} at ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    line.hidden = localDay(at) <= posted;
  });
}

/*
  On every arrival, because the public site navigates through `<ClientRouter />`
  and a swapped body arrives carrying the server's spelling. Content the Reader
  clones from a `<template>` or fetches arrives AFTER that, which is why
  `Reader.astro` calls `renderTimestamps` on what it fills, too.
*/
onPage(() => renderTimestamps());
