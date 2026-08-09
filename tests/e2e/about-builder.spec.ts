// The About builder, after ADR-0020 removed three of its fields (plan 23).
//
// READ-ONLY BY CONSTRUCTION, like the rest of the harness: `pages.save` is
// stubbed, so nothing here can rewrite the live `about` row. What these specs
// prove is that the CLIENT behaves — which is precisely the gap that mattered
// here.
//
// WHY THIS FILE EXISTS AT ALL. Until 2026-08-07 no spec covered this room, and
// removing fields from it has a silent, total failure mode:
// `about-builder.ts`'s `$` helper is `getElementById(id) as T` with NO null
// check, so one surviving reference to a deleted element throws a TypeError at
// module top level, which kills the whole module, which means the Save button
// never gets its listener. The page then looks completely normal and cannot
// save. The `as T` cast hides that from TypeScript; `astro check` and vitest
// cannot see it either. Both facts below were unverifiable before this file:
//
//  · SAVE STILL WORKS. The only assertion that can distinguish "the removal was
//    clean" from "the module is dead". It is the acceptance test for plan 23.
//  · THE PAYLOAD NO LONGER CARRIES THE REMOVED KEYS. `me.headline`,
//    `me.interests` and `site.thesis` must be absent — not empty. Zod strips
//    unknown keys, so a leftover would fail silently rather than loudly.
import { test, expect, stubActions } from './fixtures';

test.describe('the About builder after ADR-0020', () => {
  test('the three removed controls are gone', async ({ page }) => {
    await page.goto('/admin/about');
    await expect(page.locator('#me-editor')).toBeVisible();

    // Absent, not hidden — an empty field in an editor is a standing invitation,
    // which is the reason the ADR removes them rather than leaving them blank.
    await expect(page.locator('#f-me-headline')).toHaveCount(0);
    await expect(page.locator('#f-site-thesis')).toHaveCount(0);
    await expect(page.locator('#interests-list')).toHaveCount(0);
    await expect(page.locator('#interest-add')).toHaveCount(0);
    await expect(page.locator('#interest-template')).toHaveCount(0);
    await expect(page.locator('.interest-row')).toHaveCount(0);

    // What must survive: both movement editors and the name fields.
    await expect(page.locator('#site-editor')).toBeVisible();
    await expect(page.locator('#f-blurb')).toBeVisible();
    await expect(page.locator('#f-spotify')).toBeVisible();
  });

  test('Save still fires, and the payload has dropped the three keys', async ({ page }) => {
    let sent: unknown = null;
    const seen = await stubActions(page, {
      'pages.save': (req) => {
        sent = JSON.parse(req.postData() ?? '{}');
        return { ok: true };
      },
    });

    await page.goto('/admin/about');
    const save = page.locator('#save-about');
    // Disabled until something is dirty — so this also proves the module reached
    // its listeners at all, before we ask it to save.
    await expect(save).toBeDisabled();

    await page.locator('#me-editor').click();
    await page.keyboard.type(' ');
    await expect(save).toBeEnabled();

    await save.click();

    // The assertion that would have caught a dead module: a TypeError at module
    // top level leaves this text on its server-rendered "Edit and save" for ever.
    await expect(page.locator('#about-status-text')).toHaveText(/^Saved /);
    expect(seen()).toContain('pages.save');

    const content = (sent as { content?: Record<string, Record<string, unknown>> })?.content ?? {};
    expect(content.me).toBeTruthy();
    expect(content.site).toBeTruthy();

    // Absent, not falsy. `toBeUndefined` rather than `toBeFalsy` on purpose:
    // `headline: ''` would pass a falsy check and is exactly the leftover this
    // guards against.
    expect(content.me!.headline).toBeUndefined();
    expect(content.me!.interests).toBeUndefined();
    expect(content.site!.thesis).toBeUndefined();

    // And the neighbours the removal sat between are still being sent.
    expect(content.me!.body).toBeTruthy();
    expect(content.me).toHaveProperty('portrait');
    expect(content.me).toHaveProperty('portrait_caption');
    expect(content.site!.body).toBeTruthy();
    expect(content.site!.name).toBeTruthy();
  });
});
