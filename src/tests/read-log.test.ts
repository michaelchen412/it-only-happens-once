// The read path's log seam (plan 43 §4) — three properties, each load-bearing:
// an error speaks, a miss stays silent, and the response passes through
// UNTOUCHED, because every call site's `{ data, count }` destructure depends
// on getting back exactly what PostgREST resolved.
import { describe, expect, it, vi } from 'vitest';
import type { PostgrestError } from '@supabase/supabase-js';
import { noted, required } from '../lib/read-log';

const err = (message: string): PostgrestError =>
  ({ code: 'PGRST000', message, details: '', hint: '', name: 'PostgrestError' }) as PostgrestError;

describe('noted', () => {
  it('logs a failure with its location and hands the response back unchanged', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = { data: null, error: err('connection refused'), count: null };
    try {
      expect(noted('blog: writing')(res)).toBe(res);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain('blog: writing');
      expect(String(spy.mock.calls[0]?.[0])).toContain('connection refused');
    } finally {
      spy.mockRestore();
    }
  });

  it('a miss is not a failure: maybeSingle’s no-row shape says nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = { data: null, error: null };
    try {
      expect(noted('quote: some-slug')(res)).toBe(res);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('a success passes through with its rows and count intact', () => {
    const res = { data: [{ id: '1' }], error: null, count: 41 };
    expect(noted('blog: quotes')(res)).toBe(res);
  });
});

/*
  `required` — the same seam for a read with no honest way to degrade.

  ⚠ THE PROPERTY IS THAT IT THROWS, AND THAT IS THE WHOLE VALUE. A permalink
  whose read fails used to return `null`, which its route cannot tell from "no
  such essay" — so a transient database error answered 404 and told every
  crawler behind the reader that a published piece does not exist. A thrown
  error lands on `500.astro`: `no-store`, a status a crawler retries, and a
  sentence that is true. The miss case below is the other half: a real typo must
  still reach a real 404.
*/
describe('required', () => {
  it('throws on a failure, and logs it with its location first', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => required('writing: some-slug')({ data: null, error: err('connection refused') })).toThrow(
        /writing: some-slug/,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain('connection refused');
    } finally {
      spy.mockRestore();
    }
  });

  it('a miss is still not a failure: no row passes straight through to the 404', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = { data: null, error: null };
    try {
      expect(required('writing: typo')(res)).toBe(res);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('hands a successful read back untouched, like its sibling', () => {
    const res = { data: { id: '1' }, error: null };
    expect(required('quote: real-slug')(res)).toBe(res);
  });
});
