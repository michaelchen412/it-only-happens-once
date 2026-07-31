// Shared helpers for the e2e specs.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export interface Fixtures {
  /** An existing unpublished essay (draft or note), or null if there is none. */
  draftSlug: string | null;
  draftStatus: 'note' | 'draft' | null;
  /** An existing published essay. */
  publishedSlug: string | null;
  /** Any constellation — the only route to the fragment browser. */
  constellationId: string | null;
}

export function fixtures(): Fixtures {
  const file = path.join('tests', 'e2e', '.auth', 'fixtures.json');
  if (!fs.existsSync(file)) throw new Error('fixtures.json missing — did the setup project run?');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Cut the writing composer off from the database for the length of a test.
 *
 * The sheet autosaves a draft 1.2s after you stop typing, and these specs run
 * against the LIVE project — so a test that types into the composer would
 * otherwise leave real rows behind in Michael's corpus. Everything plan 06 adds
 * is client-side (a word count and a preflight read off the form), so refusing
 * the save costs the test nothing and keeps the harness read-only.
 *
 * Returns a getter for how many saves were attempted, which is itself worth
 * asserting on: it's how you notice the composer started writing somewhere new.
 */
export async function blockWrites(page: Page): Promise<() => number> {
  let attempts = 0;
  await page.route('**/_actions/**', async (route) => {
    attempts++;
    await route.abort('failed'); // the sheet treats this as "can't reach the server"
  });
  return () => attempts;
}
