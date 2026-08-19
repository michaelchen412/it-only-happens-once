// The document's own shape — and the one bug in this repo that every green
// check was structurally incapable of seeing.
//
// 2026-08-19: `<Analytics />` sat in SiteLayout's `<Fragment slot="head">`. It
// renders a `<vercel-analytics>` CUSTOM ELEMENT, which is not one of the tags
// the HTML parser accepts in a head — so the parser closed the head at it and
// reparented everything after it into the body. Everything after it was all of
// the CSS: Astro appends the page stylesheet <link> and its scoped <style>
// blocks LAST in head, which is after that slot. The deploy served 0
// stylesheets in `document.head` and 22 in `document.body`.
//
// `<ClientRouter />` replaces the body wholesale, so every navigation destroyed
// the stylesheet and re-created it, and the page painted a frame with NO CSS AT
// ALL — white ground, blue links, and StarMark (a viewBox with no intrinsic
// size) filling the viewport. From the outside it read as the site's own mark
// flashing across the page between pages.
//
// ⚠ WHY IT IS TESTED HERE AND NOWHERE ELSE. `npm run verify` cannot see this and
// never could: format, lint, `astro check` and vitest all read SOURCE, and this
// is a property of the PARSED DOCUMENT. Nothing was malformed in any file. The
// only place the bug exists is in a browser's DOM, which is this suite's whole
// reason for existing (see playwright.config.ts's opening note).
//
// Signed out, because the public chrome is where `<ClientRouter />` lives.
import { test, expect } from './fixtures';

/** Where the stylesheets ended up, once a real parser has had its say. */
async function cssPlacement(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    head: document.head.querySelectorAll('link[rel=stylesheet],style').length,
    body: document.body.querySelectorAll('link[rel=stylesheet],style').length,
    // ⚠ THE BODY'S FIRST CHILD IS THE ANSWER, NOT THE LIST OF DISPLACED
    // STYLESHEETS. When a parser gives up on a head it does it at ONE element,
    // and that element is then sitting at the top of the body — so a failure
    // here should name the culprit rather than its victims. The victims all
    // read `STYLE`, which tells the next reader nothing at all.
    firstInBody: document.body.firstElementChild?.tagName ?? '(empty body)',
  }));
}

for (const path of ['/', '/blog', '/about']) {
  test(`every stylesheet on ${path} is inside <head>`, async ({ page }) => {
    await page.goto(path);
    const css = await cssPlacement(page);
    // ⚠ THE ASSERTION IS `body === 0`, NOT `head > 0`. The broken build had CSS
    // on the page and rendered correctly on first paint — it was only the SWAP
    // that exposed it. "Some CSS exists" would have passed all day.
    expect(
      css.body,
      `${css.body} stylesheets reparented into <body>. The head ended at: <${css.firstInBody.toLowerCase()}>`,
    ).toBe(0);
    expect(css.head).toBeGreaterThan(0);
  });
}

test('a constellation page keeps its CSS in <head> too', async ({ page }) => {
  // The suite pages carry a second stylesheet (PostArticle), so they are the
  // page with the most to lose from a truncated head.
  await page.goto('/');
  const href = await page.locator('a.sky-row').first().getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!);
  const css = await cssPlacement(page);
  expect(
    css.body,
    `${css.body} stylesheets reparented into <body>. The head ended at: <${css.firstInBody.toLowerCase()}>`,
  ).toBe(0);
  expect(css.head).toBeGreaterThan(0);
});

test('the site mark carries its own dimensions', async ({ page }) => {
  await page.goto('/');
  // Belt to the braces above: an <svg> with a viewBox and no width/height has
  // no intrinsic size, so in ANY styleless frame it fills its container. These
  // are presentation attributes — the weakest thing in the cascade — so
  // `.star-mark` and its overrides still decide every rendered size. This is
  // only what happens when nothing else can.
  const mark = page.locator('svg.star-mark').first();
  await expect(mark).toHaveAttribute('width', '1em');
  await expect(mark).toHaveAttribute('height', '1em');
});

// ⚠ THE OBVIOUS TEST IS NOT HERE, AND THE REASON IS THE POINT. The first draft
// of this file sampled `getComputedStyle(document.body).backgroundColor` and the
// mark's width every frame across a client-side swap, asserting neither ever
// went transparent or three figures — the symptom itself, measured. It was
// dropped because it PASSED against the broken layout: this suite drives the DEV
// server, where Astro injects styles as inline <style> blocks that the swap
// re-adds synchronously. The flash needs the built output's external <link>,
// whose load is async. A test that cannot fail on the bug it is named after is
// worse than no test, because the next person reads it as coverage.
//
// The placement assertions above are the honest version: they hold in dev and in
// prod, because a head truncated by an illegal element is truncated by the same
// parser everywhere. The flash was verified by hand with Playwright against a
// real build — screenshots, not a spec.
