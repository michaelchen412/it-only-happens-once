// Plan 05·2: the corpus export.
//
// NOT stubbed, unlike the other specs here — and it doesn't need to be, because
// this endpoint is read-only. It writes nothing, so the harness's read-only
// property holds while the assertions run against the REAL corpus. That is also
// the only way to check the thing worth checking: that the file actually
// contains what the database contains.
//
// The `anon` half lives in corpus-export.anon.spec.ts, where it belongs.
import { test, expect } from '@playwright/test';

interface Corpus {
  format: string;
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

const TABLES = [
  'subjects',
  'authors',
  'works',
  'constellations',
  'pages',
  'fragments',
  'fragment_subjects',
  'fragment_constellations',
  'fragment_versions',
];

test.describe('corpus export', () => {
  test('downloads as a file, with every table and honest counts', async ({ request }) => {
    const res = await request.get('/admin/export.json');
    expect(res.status()).toBe(200);

    // It's a download, and it must never be cached — the file carries drafts
    // and private notes.
    expect(res.headers()['content-disposition']).toMatch(/attachment; filename="it-only-happens-once-\d{4}-\d\d-\d\d\.json"/);
    expect(res.headers()['cache-control']).toContain('no-store');

    const corpus = (await res.json()) as Corpus;
    expect(corpus.format).toBe('it-only-happens-once/corpus');

    // Every table present, and `counts` agreeing with the rows actually shipped
    // — a count that disagrees with its own payload would be the exact kind of
    // reassuring lie this file exists to avoid.
    for (const table of TABLES) {
      expect(corpus.tables[table], `${table} missing from the export`).toBeDefined();
      expect(corpus.counts[table], `${table} count disagrees with its rows`).toBe(corpus.tables[table].length);
    }
  });

  test('carries the whole corpus, not PostgREST’s first thousand rows', async ({ request, page }) => {
    // The silent-truncation trap: PostgREST caps a response at 1000 rows and
    // says nothing. Compare against what the admin UI independently reports.
    const corpus = (await (await request.get('/admin/export.json')).json()) as Corpus;

    await page.goto('/admin');
    // The manager's "All" chip carries the live fragment total.
    const all = page.locator('[data-type-filter=""] .type-badge__n');
    await expect(all).toBeVisible();
    const shown = Number((await all.textContent())?.trim());
    expect(shown, 'could not read a fragment count from /admin').toBeGreaterThan(0);

    // The export includes trashed rows (a backup should), so it is >= the
    // manager's live view rather than equal to it.
    expect(corpus.counts.fragments).toBeGreaterThanOrEqual(shown);
    expect(corpus.counts.fragments).toBeLessThan(1000); // the day this trips, paging needs a real test
  });

  test('the rows are whole — bodies, not just ids', async ({ request }) => {
    // `select('*')` is what makes the export survive a schema change, so assert
    // on real columns rather than a shape someone remembered to maintain.
    const corpus = (await (await request.get('/admin/export.json')).json()) as Corpus;

    const published = corpus.tables.fragments.filter((f) => f.status === 'published');
    expect(published.length).toBeGreaterThan(0);
    const essay = published.find((f) => f.type === 'writing') as Record<string, unknown>;
    expect(essay).toBeDefined();
    for (const column of ['id', 'type', 'title', 'slug', 'body', 'status', 'occurred_at', 'created_at']) {
      expect(essay, `fragments.${column} missing`).toHaveProperty(column);
    }
    expect(String(essay.body).length, 'the essay body should be real prose').toBeGreaterThan(200);

    // Membership carries `position` — the plan named it specifically, because
    // without it a restored constellation is a set rather than a sequence.
    if (corpus.tables.fragment_constellations.length) {
      expect(corpus.tables.fragment_constellations[0]).toHaveProperty('position');
    }
  });

  test('every subject link points at a row that is also in the file', async ({ request }) => {
    // Referential integrity within the export itself. An archive whose join
    // tables point at absent rows restores into something broken, and nothing
    // else here would notice.
    const corpus = (await (await request.get('/admin/export.json')).json()) as Corpus;
    const fragmentIds = new Set(corpus.tables.fragments.map((f) => f.id));
    const subjectIds = new Set(corpus.tables.subjects.map((s) => s.id));

    const dangling = corpus.tables.fragment_subjects.filter(
      (l) => !fragmentIds.has(l.fragment_id) || !subjectIds.has(l.subject_id),
    );
    expect(dangling, 'fragment_subjects referencing rows not in the export').toHaveLength(0);

    const constellationIds = new Set(corpus.tables.constellations.map((c) => c.id));
    const danglingPlacements = corpus.tables.fragment_constellations.filter(
      (l) => !fragmentIds.has(l.fragment_id) || !constellationIds.has(l.constellation_id),
    );
    expect(danglingPlacements, 'placements referencing rows not in the export').toHaveLength(0);
  });

  test('the Library page offers it', async ({ page }) => {
    await page.goto('/admin/library');
    const link = page.getByRole('link', { name: /export corpus/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin/export.json');
  });
});
