// Shared helpers for the e2e specs — and the one place this suite decides
// whether it is allowed to write to the database.
//
// ⚠ THE SUITE RUNS AGAINST THE LIVE SUPABASE PROJECT. There is no local stack
// (docs/plans/GROUND-RULES.md), so "read-only" is not a nicety here: it is the
// only thing standing between a green test run and rows appearing in Michael's
// real corpus. Until 2026-08-09 that property was a CONVENTION — 23 of 49 spec
// files called `stubActions`, the other 26 simply did not write, and nothing
// checked. `tasks.mobile.spec.ts` filled `[data-due]` and dispatched `input`
// with no stubs at all; it was safe only because the task sheet has no autosave,
// and the writing sheet next door has had one (1.2s after you stop typing) since
// plan 06. The day the task or log sheet gained the same behaviour, a green
// mobile spec would have written to production.
//
// So the guarantee is now structural: **`test` below blocks `/_actions/**` for
// every spec, by default, before the test body runs.** Opting out is possible
// and deliberate — `allowActions` — but it is a line of code with a name, which
// is what makes it a decision rather than an omission.
//
// ⚠ WHAT THIS DOES NOT COVER, stated because a guarantee you misread is worse
// than none:
//
//   • `page.route` only sees the browser's requests. The `request` fixture
//     (Playwright's own APIRequestContext) bypasses it entirely — three specs
//     use it, all `GET /admin/export.json`, all read-only. A spec that POSTed
//     through `request` would not be stopped by anything here.
//   • It blocks the ACTIONS endpoint, not every write. Nothing prevents a spec
//     from importing `@supabase/supabase-js` and writing directly, which is
//     exactly what `auth.setup.ts` does with the service-role key.
//   • It cannot make an already-written row go away. It stops the request, not
//     the intent.
import fs from 'node:fs';
import path from 'node:path';
import { stringify as devalueStringify } from 'devalue';
import { test as base, expect } from '@playwright/test';
import type { Page, Request, Route } from '@playwright/test';

/** Every Astro action call. The one URL shape that can change the database. */
const ACTIONS = '**/_actions/**';

/**
 * Which pages have the guard installed. `allowActions` refuses to run without
 * it, so a spec cannot opt out of a guarantee it never had.
 */
const guarded = new WeakSet<Page>();

/**
 * `/_actions/versions.list/` → `versions.list`.
 *
 * ⚠ THE TRAILING SLASH IS THE TRAP. This project appends one, and leaving it on
 * means every handler lookup misses and every call is aborted — which looks
 * exactly like "the page is broken" rather than like a bug in this file.
 */
function actionName(url: string): string {
  return decodeURIComponent(new URL(url).pathname)
    .replace(/^.*\/_actions\//, '')
    .replace(/\/$/, '');
}

/**
 * The fields of an action call, whichever way the client encoded them.
 *
 * ⚠ IT IS `multipart/form-data`, NOT URL-ENCODED, and assuming otherwise is how
 * the Library spec first failed: an action declared `accept: 'form'` is sent a
 * real `FormData`, so the browser picks multipart and every field read back
 * through `URLSearchParams` is `undefined`. JSON actions are handled too, since
 * the two are indistinguishable at the call site.
 */
export function formFields(req: Request): Record<string, string> {
  const body = req.postData() ?? '';
  const boundary = /boundary=(.+)$/.exec(req.headers()['content-type'] ?? '')?.[1];
  if (!boundary) return Object.fromEntries(new URLSearchParams(body));

  const fields: Record<string, string> = {};
  for (const part of body.split(`--${boundary}`)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    const start = part.indexOf('\r\n\r\n');
    if (!name || start === -1) continue;
    fields[name] = part.slice(start + 4).replace(/\r\n$/, '');
  }
  return fields;
}

/**
 * The `test` every spec in this directory imports, instead of `@playwright/test`.
 *
 * The auto fixture installs a catch-all abort on `/_actions/**` before the test
 * body runs. `stubActions` and `blockWrites` then register their own handlers,
 * which WIN: Playwright matches route handlers in reverse registration order
 * (LIFO — see `page.route`'s docs and `Route.fallback`), so the most recently
 * registered handler is consulted first and this one is only ever the fallback.
 * That ordering is the whole mechanism, which is why it is written down here
 * rather than left to be rediscovered.
 *
 * ⚠ `src/tests/e2e-read-only.test.ts` fails `npm run verify` if any spec file
 * imports `test` from `@playwright/test` instead of from here. Without that,
 * this fixture protects only the files that remember to use it — which is the
 * same convention it replaced, one import line further down.
 */
export const test = base.extend<{ readOnly: void }>({
  readOnly: [
    async ({ page }, use) => {
      guarded.add(page);
      await page.route(ACTIONS, (route: Route) => route.abort('failed'));
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Let action calls REACH THE LIVE PROJECT — all of them, or only the ones named.
 *
 * ⚠ **Prefer the named form.** `allowActions(page, ['fragments.get'])` lets one
 * READ through and goes on refusing everything else, so a spec that needs the
 * server to answer a question does not thereby acquire permission to write. The
 * unnamed form lifts the guard completely and is for the one spec that must
 * genuinely mutate the database.
 *
 * The named form exists because of a real case, and it is worth recording: the
 * audit concluded no spec needed live action calls, and one did.
 * `today.spec.ts` opens a deep link at `#edit=<id>`, and the writing sheet loads
 * that piece through `fragments.get`. With the call refused, the sheet opens as
 * an inert error shell **and clears the hash** (`writing-sheet.ts` — the failure
 * path calls `openSheet('')`), so the spec's assertion about the URL surviving
 * the bounce failed on a URL that was correct until the load failed. Blanket
 * blocking is right by default and wrong in exactly this shape.
 *
 * A spec that opts in to WRITES additionally owns:
 *
 *   1. **Subjects it created**, never ones it found. Discovering an existing row
 *      and mutating it is how a test eats real work.
 *   2. **A name nobody would mistake for real data**, so a failed cleanup leaves
 *      something obviously disposable rather than a plausible-looking corpus row.
 *   3. **Cleanup that runs even when the assertions fail** — `afterEach`, not a
 *      line at the end of the test body.
 *
 * `library.spec.ts` is the worked example. Every caller of either form must be
 * listed in `src/tests/e2e-read-only.test.ts`'s `OPT_OUTS`, with its reason.
 *
 * Implemented by registering a WINNING handler rather than by unrouting the
 * guard: same LIFO rule the whole file rests on, and it keeps the "only these
 * names" case expressible, which unrouting could not.
 */
export async function allowActions(page: Page, only?: string[]): Promise<void> {
  if (!guarded.has(page)) {
    throw new Error(
      'allowActions: this page has no read-only guard to lift — the spec is importing `test` from ' +
        '`@playwright/test` rather than from ./fixtures, so its calls were never blocked in the first place.',
    );
  }
  await page.route(ACTIONS, async (route) => {
    if (!only || only.includes(actionName(route.request().url()))) return void (await route.continue());
    await route.abort('failed');
  });
}

export interface Fixtures {
  /** Any published quote — `/blog/<slug>` now serves one (plan 32 · §3). */
  quoteSlug: string | null;
  /** A published quote with its whole neighbourhood lit: placed in a
   *  constellation AND by an author with other lines. Rarer than it sounds —
   *  19 of 77 quotes are in no constellation, and 29 of 35 authors have exactly
   *  one quote — so the spec skips rather than asserting against a stub. */
  richQuoteSlug: string | null;
  /** An existing unpublished essay (draft or note), or null if there is none. */
  draftSlug: string | null;
  draftStatus: 'note' | 'draft' | null;
  /** An existing published essay. */
  publishedSlug: string | null;
  /** Any constellation — the only route to the fragment browser. */
  constellationId: string | null;
  /** One with at least two fragments placed in it — the composer specs need a
   *  suite with rows to remove, and the one above may well be empty. */
  composedConstellationId: string | null;
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
 * Cut the writing composer off from the database for the length of a test, and
 * COUNT what it tried to send.
 *
 * ⚠ SINCE 2026-08-09 THE BLOCKING HALF IS REDUNDANT — `test` above already
 * refuses `/_actions/**` for every spec. What this still buys is the counter,
 * and the counter is the point: it is how a spec notices that the composer
 * started writing somewhere new. `expect(attempts()).toBe(0)` is an assertion
 * about behaviour; the default block is only a safety net.
 *
 * Registered after the default blocker and therefore consulted first (Playwright
 * matches route handlers LIFO), so the count is complete.
 */
export async function blockWrites(page: Page): Promise<() => number> {
  let attempts = 0;
  await page.route(ACTIONS, async (route) => {
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
  await page.route(ACTIONS, async (route) => {
    const name = actionName(route.request().url());
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
