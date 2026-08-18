// The read path's log seam (plan 43 §4) — three properties, each load-bearing:
// an error speaks, a miss stays silent, and the response passes through
// UNTOUCHED, because every call site's `{ data, count }` destructure depends
// on getting back exactly what PostgREST resolved.
import { describe, expect, it, vi } from 'vitest';
import type { PostgrestError } from '@supabase/supabase-js';
import { noted } from '../lib/read-log';

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
