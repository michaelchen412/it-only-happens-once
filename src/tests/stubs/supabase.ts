/**
 * The smallest Supabase client that `liveAndAnswered` can be tested against.
 *
 * ⚠ IT FAKES THE BUILDER, NOT THE DATABASE. Every PostgREST builder method
 * (`select`, `eq`, `is`, `order`, …) returns the builder, and awaiting it
 * resolves to whatever was registered for that table. So the stub asserts
 * nothing about the *query* — only about what the code does with rows once they
 * come back, which is the half that has the bugs.
 *
 * The filtering a real `.eq()` would do is therefore the fixture's job: hand it
 * the rows the query would have returned, not the whole table. That is honest
 * about what this proves and what it does not — the `.eq('occurred_on', today)`
 * being correct is e2e's problem, and `tests/e2e/tasks.spec.ts` has it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/database.types';

export interface TableResult {
  data?: unknown[] | null;
  error?: { message: string } | null;
}

/** Register a result per table name; anything unregistered comes back empty. */
export function fakeDb(tables: Record<string, TableResult>): SupabaseClient<Database> {
  const from = (name: string) => {
    const result = tables[name] ?? {};
    const settled = Promise.resolve({ data: result.data ?? [], error: result.error ?? null });

    // Every builder method chains; `then` makes the chain awaitable. A Proxy
    // rather than a hand-written list, so a query gaining a `.limit()` or a
    // second `.order()` does not need this file edited.
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return settled.then.bind(settled);
          return () => builder;
        },
      },
    );
    return builder;
  };

  // The one cast, at the one boundary: this is a test double standing in for a
  // very large generated interface, and widening it any further would make the
  // production signature untyped to buy nothing.
  return { from } as unknown as SupabaseClient<Database>;
}
