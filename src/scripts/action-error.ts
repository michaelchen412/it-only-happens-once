// Shared client helpers for the admin scripts (composer + list), so the same
// error-formatting and time-stamping isn't hand-written in two places.
import { isInputError } from 'astro:actions';

/** Turn an Action error into one human sentence (field errors joined). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatActionError(error: any): string {
  return isInputError(error) ? Object.values(error.fields).flat().join(' · ') : error.message;
}

/** "3:45 PM" — the timestamp shown in save indicators. */
export const nowTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
