/**
 * A `tasks` row carrying the table's REAL defaults.
 *
 * Same reasoning as the `person` builder beside it: a fixture can never assert
 * against a shape the database cannot produce, and a new column becomes a
 * compile error in one place rather than a silently-absent field in four.
 */
import type { Tables } from '../../lib/database.types';

export type Task = Tables<'tasks'>;

export function task(over: Partial<Task> = {}): Task {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Something to do',
    notes: null,
    due_on: null,
    due_time: null,
    priority: 'normal',
    effort: 'sitting',
    lead_days: null,
    goal_id: null,
    recur_mode: null,
    recur_rrule: null,
    recur_every: null,
    recur_unit: null,
    archived_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}
