// Offline outbox for the writing editor — the durability half of
// docs/plans/09 Piece 1. One record per fragment id, overwritten by every
// local save, drained to the server whenever a connection allows. Losing the
// network now means delay, not loss.
//
// This module is storage plus a drain loop, nothing else: no DOM, no Astro.
// The editor owns *when* to drain (startup, online, visibilitychange, retry
// backoff) and *how* to push (its serialized save path) — see
// writing-sheet.ts. Kept dependency-free of the app so it's unit-testable
// with fake-indexeddb.
import { openDB, type IDBPDatabase } from 'idb';

export interface OutboxEntry {
  /** Fragment id. Client-minted (uuid v4), so it exists before the server row does. */
  id: string;
  /** The saveWriting form fields, replayable verbatim. */
  fields: Record<string, string>;
  /**
   * auto — a draft autosave or an explicit save/publish: drain pushes it.
   * manual — a crash snapshot of a published piece's unsaved edits: never
   * auto-pushed (published pieces save on explicit intent only, docs/admin.md
   * §5); offered for restore when the piece is next opened.
   */
  kind: 'auto' | 'manual';
  /** Conflicts wait for a human decision; drain skips them. */
  state: 'pending' | 'conflict';
  /**
   * Monotonic per-id revision. A push races typing: if newer words landed
   * while a send was in flight, the revs differ and the entry survives.
   */
  rev: number;
  /** Epoch ms of the local write, for "edits from 14:02" restore prompts. */
  savedAt: number;
}

export type PushResult = 'done' | 'conflict' | 'retry';

export interface DrainSummary {
  pushed: number;
  conflicts: number;
  remaining: number;
}

const DB_NAME = 'ioho-admin';
const STORE = 'outbox';

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: 'id' });
    },
  });
  return dbPromise;
}

/**
 * Write the latest local state for a fragment, superseding any older entry.
 * Read-modify-write happens inside ONE readwrite transaction — the editor's
 * local debounce and a drain-triggered save can both write the same id, and
 * two racing puts must never mint the same rev (confirmSent would then drop
 * words it never sent).
 *
 * An entry never downgrades from auto to manual: auto means "there is push
 * intent" (an explicit save queued while offline), and newer keystrokes ride
 * along with that intent rather than silently cancelling it.
 */
export async function put(id: string, fields: Record<string, string>, kind: OutboxEntry['kind']): Promise<OutboxEntry> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  const prev = (await tx.store.get(id)) as OutboxEntry | undefined;
  const entry: OutboxEntry = {
    id,
    fields,
    kind: prev?.kind === 'auto' ? 'auto' : kind,
    state: 'pending', // fresh words supersede a stale conflict mark
    rev: (prev?.rev ?? 0) + 1,
    savedAt: Date.now(),
  };
  await tx.store.put(entry);
  await tx.done;
  return entry;
}

export async function get(id: string): Promise<OutboxEntry | undefined> {
  return (await db()).get(STORE, id) as Promise<OutboxEntry | undefined>;
}

export async function all(): Promise<OutboxEntry[]> {
  return (await db()).getAll(STORE) as Promise<OutboxEntry[]>;
}

export async function remove(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

export async function markConflict(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  const cur = (await tx.store.get(id)) as OutboxEntry | undefined;
  if (cur) await tx.store.put({ ...cur, state: 'conflict' });
  await tx.done;
}

/**
 * The words reached the server — remove the entry, unless a newer local
 * write (a higher rev) landed while the send was in flight. Atomic for the
 * same reason as put: a keystroke committing between the read and the delete
 * must survive.
 */
export async function confirmSent(id: string, rev: number): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  const cur = (await tx.store.get(id)) as OutboxEntry | undefined;
  if (cur && cur.rev === rev) await tx.store.delete(id);
  await tx.done;
}

async function pendingAuto(): Promise<OutboxEntry[]> {
  return (await all()).filter((e) => e.kind === 'auto' && e.state === 'pending');
}

/**
 * Push every pending auto entry once. Serialized across tabs with the Web
 * Locks API where it exists (Baseline; Safari 15.4+): `ifAvailable` means a
 * drain already running in another tab simply wins and this call returns.
 * Push failures don't throw — the entry stays for the caller's retry backoff.
 */
export async function drain(push: (entry: OutboxEntry) => Promise<PushResult>): Promise<DrainSummary> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const summary = await navigator.locks.request('ioho-outbox-drain', { ifAvailable: true }, async (lock) =>
      lock ? drainNow(push) : null,
    );
    return summary ?? { pushed: 0, conflicts: 0, remaining: (await pendingAuto()).length };
  }
  return drainNow(push);
}

async function drainNow(push: (entry: OutboxEntry) => Promise<PushResult>): Promise<DrainSummary> {
  let pushed = 0;
  let conflicts = 0;
  for (const entry of await pendingAuto()) {
    let result: PushResult;
    try {
      result = await push(entry);
    } catch {
      result = 'retry';
    }
    if (result === 'done') {
      pushed++;
      await confirmSent(entry.id, entry.rev);
    } else if (result === 'conflict') {
      conflicts++;
      await markConflict(entry.id);
    }
    // 'retry' → the entry stays as-is for the next drain
  }
  return { pushed, conflicts, remaining: (await pendingAuto()).length };
}

/** Test hook: close and drop the database so each test starts empty. */
export async function __resetForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
