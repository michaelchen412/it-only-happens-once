// The link-preview card (plan 32 · §7), as THE ADMIN.
//
// ⚠ THE ADMIN SESSION IS THE ONLY WAY TO TEST THE ASSERTION THAT MATTERS. The
// card endpoint is published-only, and the thing that could go wrong is that it
// stops being — but signed out, a draft is invisible either way, so an anon spec
// would pass against a completely broken endpoint. Same shape as the draft
// cache-header specs, and the same reason.
//
// WHY IT MATTERS MORE HERE THAN ON THE PAGE. `/blog/[slug]` deliberately serves
// a draft to the admin, behind `private, no-store`. An IMAGE endpoint has no
// session to check at a CDN and no way to vary on one, so the same courtesy
// would turn unpublished writing into a public, cacheable PNG. There is no admin
// branch in the endpoint on purpose: the preview of a draft is the page, never
// the card.
//
// ⚠ Read-only by construction: every request here is a GET for an image.
import { test, expect } from './fixtures';
import { fixtures } from './fixtures';

const { draftSlug, publishedSlug, quoteSlug } = fixtures();

test.describe('the card', () => {
  test.skip(!publishedSlug, 'no published essay in the database');

  test('renders a real 1200×630 PNG for a published essay', async ({ request }) => {
    const res = await request.get(`/og/${publishedSlug}.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    const body = await res.body();
    // The PNG signature, then the IHDR width/height. Asserting the bytes rather
    // than the status catches the failure this endpoint actually has — satori
    // throwing and something else answering 200 with an error page.
    expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(body.readUInt32BE(16)).toBe(1200);
    expect(body.readUInt32BE(20)).toBe(630);
  });

  test('renders for a quote too — the card IS the quote', async ({ request }) => {
    test.skip(!quoteSlug, 'no published quote in the database');
    const res = await request.get(`/og/${quoteSlug}.png`);
    expect(res.status()).toBe(200);
    expect((await res.body()).readUInt32BE(16)).toBe(1200);
  });

  test('⚠ REFUSES A DRAFT, even to the admin who can read the page', async ({ request, page }) => {
    test.skip(!draftSlug, 'no unpublished essay in the database');
    // The control: this session really can see the draft's page. Without it a
    // green assertion below could just mean the session expired.
    const asPage = await page.goto(`/blog/${draftSlug}`);
    expect(asPage?.status(), 'the admin session cannot read the draft page — fixture or auth problem').toBe(200);

    const asCard = await request.get(`/og/${draftSlug}.png`);
    expect(asCard.status(), 'a draft rendered into a public, cacheable PNG').toBe(404);
  });

  test('an unknown slug is a 404, not a blank card', async ({ request }) => {
    expect((await request.get('/og/definitely-not-a-real-fragment-slug.png')).status()).toBe(404);
  });
});
