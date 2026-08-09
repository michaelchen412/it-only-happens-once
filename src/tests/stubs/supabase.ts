/**
 * The smallest Supabase client the action and HQ layers can be tested against.
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
  error?: { message: string; code?: string } | null;
}

/** What an `rpc(name, args)` call answers with. */
export interface RpcResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

/** One thing the code under test asked the database to do. */
export type Call = { kind: 'from'; table: string } | { kind: 'rpc'; fn: string; args: unknown };

export interface FakeDb {
  client: SupabaseClient<Database>;
  /** Every `from()` and `rpc()`, in order. */
  calls: Call[];
  /** Sugar for the common assertion: which tables were touched, in order. */
  tables(): string[];
}

/**
 * Register a result per table name; anything unregistered comes back empty.
 *
 * The plain form returns the client, which is all most callers want. Pass
 * `{ record: true }` to get the client plus the call log — needed when the
 * question is *what did it ask the database to do*, not *what did it do with
 * the answer*. `src/tests/actions-vocabulary.test.ts` uses it to pin the thing
 * the merge bug was made of: which table a handler writes to, and whether it
 * reaches the database directly when it should be going through an RPC.
 */
export function fakeDb(tables: Record<string, TableResult>): SupabaseClient<Database>;
export function fakeDb(
  tables: Record<string, TableResult>,
  opts: { record: true; rpc?: Record<string, RpcResult> },
): FakeDb;
export function fakeDb(
  tables: Record<string, TableResult>,
  opts?: { record?: boolean; rpc?: Record<string, RpcResult> },
): SupabaseClient<Database> | FakeDb {
  const calls: Call[] = [];

  const from = (name: string) => {
    calls.push({ kind: 'from', table: name });
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

  const rpc = (fn: string, args: unknown) => {
    calls.push({ kind: 'rpc', fn, args });
    const result = opts?.rpc?.[fn] ?? {};
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };

  // The one cast, at the one boundary: this is a test double standing in for a
  // very large generated interface, and widening it any further would make the
  // production signature untyped to buy nothing.
  const client = { from, rpc } as unknown as SupabaseClient<Database>;
  if (!opts?.record) return client;
  return {
    client,
    calls,
    tables: () => calls.filter((c) => c.kind === 'from').map((c) => (c as { table: string }).table),
  };
}
