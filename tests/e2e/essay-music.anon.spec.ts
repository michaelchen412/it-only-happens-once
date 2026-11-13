// An essay plays its music — the READ path, unstubbed, against live (ADR 0044).
//
// `music-tab.spec.ts` stubs the write, so this is the half that runs the real
// query: `getWritingPost` selecting `music_url`, and PostArticle turning it into
// a player. One essay per kind the column can hold, because each embeds
// differently (a one-row track, a tall playlist, a 16:9 video) and the two
// playlist essays are the ones a song-only parser once silently dropped.
//
// ⚠ IT CHECKS THE FRAME'S `src`, NEVER THAT IT PLAYED. Whether Spotify or
// YouTube answers is somebody else's uptime; that we asked for the right embed
// is ours.
//
// The slugs are real published essays. If one is renamed or loses its music,
// this goes red on purpose — pick another from
// `select slug from fragments where music_url is not null`.
import { expect, test } from './fixtures';

const CASES = [
  { slug: 'color', kind: 'a Spotify track', src: 'https://open.spotify.com/embed/track/0Bx9T65ZsexNuiLSbBav9p' },
  {
    slug: 'a-certain-vibe',
    kind: 'a Spotify playlist',
    src: 'https://open.spotify.com/embed/playlist/2wQlYWCZpxDvO7UAWEUSY5',
  },
  { slug: 'the-spirit-of-jazz', kind: 'a YouTube video', src: 'https://www.youtube-nocookie.com/embed/IXQN1mv6CtI' },
];

for (const c of CASES) {
  test(`an essay with ${c.kind} renders its player above the words`, async ({ page }) => {
    await page.goto(`/blog/${c.slug}`);
    const frame = page.locator('.post-paired iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', new RegExp(`^${c.src.replace(/[.?]/g, '\\$&')}`));
    // The accessible name says what the player cannot: that it goes with THIS piece.
    await expect(frame).toHaveAttribute('title', /^Music for /);
  });
}
