// The embedded-relation unwrap (plans/00-groundwork.md · Piece 8).
//
// ⚠ WHAT THESE GUARD IS THE ARRAY CASE, and it is not theoretical. PostgREST
// returns a to-one embed as an OBJECT when it reads the constraint that way and
// as a ONE-ELEMENT ARRAY when it does not — decided by the query, not by the
// schema, which is precisely why `database.types.ts` cannot always be trusted
// here and why eleven hand-written casts existed before this module.
//
// A reader that assumed an object would see `undefined` for every field of a
// wrapped row rather than throwing: the brief would render blank names and say
// nothing was wrong.
import { describe, expect, it } from 'vitest';
import { many, one } from '../lib/hq/relations';

interface P {
  id: string;
  display_name: string;
}
const ada: P = { id: 'p1', display_name: 'Ada' };

describe('one', () => {
  it('passes an object straight through', () => {
    expect(one<P>(ada)).toEqual(ada);
  });

  it('⚠ unwraps the one-element array PostgREST sometimes sends instead', () => {
    expect(one<P>([ada])).toEqual(ada);
  });

  it('is null for a join that found nothing — in either shape', () => {
    expect(one<P>(null)).toBeNull();
    expect(one<P>(undefined)).toBeNull();
    expect(one<P>([])).toBeNull();
  });
});

describe('many', () => {
  it('passes a list through, and wraps a bare object into one', () => {
    expect(many<P>([ada])).toEqual([ada]);
    expect(many<P>(ada)).toEqual([ada]);
  });

  it('⚠ is an EMPTY LIST for a missing relation, never null', () => {
    // The caller wants to iterate. Returning null would put `?? []` at every
    // call site — the same omission waiting to happen eleven times.
    expect(many<P>(null)).toEqual([]);
    expect(many<P>(undefined)).toEqual([]);
  });
});
