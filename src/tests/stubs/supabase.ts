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
export type Call =
  | { kind: 'from'; table: string }
  | { kind: 'rpc'; fn: string; args: unknown }
  | { kind: 'op'; table: string; method: string; args: unknown[] };

export interface FakeDb {
  client: SupabaseClient<Database>;
  /** Every `from()`, `rpc()` and builder method, in order. */
  calls: Call[];
  /** Sugar for the common assertion: which tables were touched, in order. */
  tables(): string[];
  /**
   * The builder methods called against one table, as `['order', 'limit']`-style
   * entries with their arguments.
   *
   * ⚠ IT EXISTS BECAUSE SOME RULES LIVE IN THE QUERY (plans/30 · §6). The
   * brief's "your LAST words, not your second-to-last" used to be a comparison
   * in TypeScript, and this file could watch it; bounding that read moved it
   * into `.order(…).limit(1)`, where the header's "fakes the builder, not the
   * database" note would otherwise mean the rule silently stopped being tested
   * at the moment it stopped being visible. Asserting on the query is not as
   * good as asserting on rows — it pins the ASK rather than the answer — but it
   * is the difference between a rule with a test and a rule with none.
   */
  ops(table: string): { method: string; args: unknown[] }[];
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
    const rows = result.data ?? [];
    const error = result.error ?? null;
    const settled = Promise.resolve({ data: rows, error });
    // ⚠ `maybeSingle`/`single` UNWRAP, because PostgREST does. They are the one
    // pair of builder methods that changes the SHAPE of `data` — a row rather
    // than an array — and a stub that chained them like everything else handed
    // the code under test an array where it expected an object, which is not a
    // failure the production code can have. `single`'s zero-row error is not
    // modelled: register an `error` on the fixture if a test needs it.
    const one = Promise.resolve({ data: rows[0] ?? null, error });

    // Every other builder method chains; `then` makes the chain awaitable. A
    // Proxy rather than a hand-written list, so a query gaining a `.limit()` or
    // a second `.order()` does not need this file edited.
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return settled.then.bind(settled);
          const method = String(prop);
          if (method === 'maybeSingle' || method === 'single') {
            return (...args: unknown[]) => {
              calls.push({ kind: 'op', table: name, method, args });
              return one;
            };
          }
          return (...args: unknown[]) => {
            calls.push({ kind: 'op', table: name, method, args });
            return builder;
          };
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
    ops: (table: string) =>
      calls
        .filter((c): c is Extract<Call, { kind: 'op' }> => c.kind === 'op' && c.table === table)
        .map(({ method, args }) => ({ method, args })),
  };
}
