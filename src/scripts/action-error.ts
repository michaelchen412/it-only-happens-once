// Shared client helpers for the admin scripts (composer + list), so the same
// error-formatting and time-stamping isn't hand-written in two places.
import { isInputError } from 'astro:actions';

/**
 * Turn an Action error into one human sentence (field errors joined).
 *
 * Also handles what `astro:actions` *throws* rather than returns: a dead
 * network surfaces as a bare `TypeError: Failed to fetch` from the fetch
 * underneath, and that string must never reach a human — it reads like a bug
 * when it's just a missing connection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatActionError(error: any): string {
  if (isInputError(error)) return Object.values(error.fields).flat().join(' · ');
  if (isNetworkError(error)) return 'You’re offline — the server can’t be reached right now.';
  return error?.message ?? 'Something went wrong.';
}

/** True when a failure is connectivity rather than an answer from the server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isNetworkError(error: any): boolean {
  return error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/** "3:45 PM" — the timestamp shown in save indicators (now, or a given epoch ms). */
export const nowTime = (at?: number) =>
  new Date(at ?? Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
