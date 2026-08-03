/**
 * A `people` row carrying the table's REAL defaults.
 *
 * Shared by every people test so a fixture can never assert against a shape the
 * database cannot produce — and so a new column is a compile error in one place
 * rather than a silently-absent field in four. `drift_mutes` proved that on the
 * day it was added: this builder failed to typecheck before any test ran.
 */
import type { Person } from '../../lib/hq/people';

export function person(over: Partial<Person> = {}): Person {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'someone',
    display_name: 'Someone',
    full_name: null,
    sort_name: null,
    circle: 'friends',
    epithet: null,
    bio: null,
    photo_path: null,
    birth_month: null,
    birth_day: null,
    birth_year: null,
    birthday_lead_days: 30,
    known_since_year: null,
    location: null,
    cadence_days: 365,
    drift_muted_until: null,
    drift_mutes: 0,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}
