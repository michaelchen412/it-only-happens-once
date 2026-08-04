// Shared helpers for the e2e specs.
import fs from 'node:fs';
import path from 'node:path';
import { stringify as devalueStringify } from 'devalue';
import type { Page, Request } from '@playwright/test';

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
 * Take Astro's dev toolbar out of the page.
 *
 * ⚠ IT SITS BOTTOM-CENTRE AND EATS CLICKS THERE, which is precisely where this
 * project puts a floating pill — `.bulkbar` since the fragment manager shipped,
 * `.undo-bar` since 14 · Piece 1. A click on either fails with
 * "<astro-dev-toolbar> intercepts pointer events" and reads exactly like a
 * broken control.
 *
 * It is a DEV-ONLY element (`astro build` never emits it), so removing it makes
 * the test match production rather than diverging from it. Call this in any
 * spec that presses something at the bottom of the viewport.
 */
export async function hideDevToolbar(page: Page): Promise<void> {
  // ⚠ A STYLE RULE, not just a `.remove()`. The toolbar is injected some time
  // AFTER load, so removing the element right after `goto` reliably wins a race
  // it then loses again a moment later — which is how this was first "fixed"
  // and still failed. A rule on the document outlives every re-injection, and
  // `display: none` takes it out of hit testing rather than merely hiding it.
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
  await page.evaluate(() => document.querySelector('astro-dev-toolbar')?.remove());
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

/**
 * `blockWrites` for specs that need the server to ANSWER — the composer can't
 * be driven through a flow that starts from existing data if every request is
 * refused.
 *
 * Same read-only guarantee, arrived at from the other side: nothing reaches the
 * live project because every request is answered here. That's strictly safer
 * than finding a real published piece in Michael's corpus and editing it, which
 * is the only other way to exercise a flow that needs a piece with versions.
 *
 * A name with no handler is aborted, not passed through, so a spec can never
 * silently start talking to the database because the composer grew a call.
 * The returned getter lists the action names seen, in order — assert on it.
 *
 * Responses are devalue, not JSON: `astro:actions` parses successful bodies
 * with `devalue.parse` (see astro/dist/actions/runtime/client.js), so a plain
 * `JSON.stringify` here would fail to deserialize on the client.
 */
export async function stubActions(
  page: Page,
  handlers: Record<string, (req: Request) => unknown>,
): Promise<() => string[]> {
  const seen: string[] = [];
  await page.route('**/_actions/**', async (route) => {
    // `/_actions/versions.list/` — this project appends the trailing slash, and
    // leaving it on means every handler lookup misses and every call is
    // aborted, which looks exactly like "the composer is broken".
    const name = decodeURIComponent(new URL(route.request().url()).pathname)
      .replace(/^.*\/_actions\//, '')
      .replace(/\/$/, '');
    seen.push(name);
    const handler = handlers[name];
    if (!handler) return void (await route.abort('failed'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json+devalue',
      body: devalueStringify(handler(route.request())),
    });
  });
  return () => seen;
}
