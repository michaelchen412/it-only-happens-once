// Paired with src/pages/admin/capture-lab.astro — delete both together once the
// note-tier-vs-separate-store call is made (docs/plans/10-hq.md §8).
//
// Every save is stubbed, so nothing reaches Michael's corpus. What that still
// proves is the whole of what he's judging: the box saves itself on a debounce,
// an empty box is never a row, ＋ New parks the old thought under a NEW id
// rather than overwriting it, and the pile updates without a reload.
//
// What it does NOT prove: the real round-trip through `fragments.saveWriting`.
// That action is shipped and unchanged; the risk this leaves is the shape of
// the FormData, which is why the field assertions below are the contract check.
import { test, expect } from '@playwright/test';
import { stubActions } from './fixtures';

/** Pull one field out of a multipart body — enough to assert the contract. */
function field(body: string | null, name: string): string | null {
  if (!body) return null;
  return body.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`))?.[1] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('capture lab — the quick-dump box', () => {
  test('autosaves, never saves empty, and ＋ New starts a genuinely new note', async ({ page }) => {
    const saved: Array<{ id: string | null; body: string | null; status: string | null }> = [];

    await stubActions(page, {
      'fragments.saveWriting': (req) => {
        const body = req.postData();
        const id = field(body, 'id');
        saved.push({ id, body: field(body, 'body'), status: field(body, 'status') });
        return { id, slug: 'stub', updated_at: new Date().toISOString() };
      },
    });

    await page.goto('/admin/capture-lab');
    const box = page.locator('#cap-box');
    await expect(box).toBeFocused(); // you land ready to type — no click required

    // 1. An empty box is never a row. Wait out the debounce and assert silence.
    await page.waitForTimeout(1200);
    expect(saved).toHaveLength(0);

    // 2. Typing saves itself. No button was pressed.
    //    Poll the captured calls rather than the status line: the status is
    //    transient (it fades), so asserting on it races both ways.
    await box.fill('call the dentist');
    await expect(page.locator('#cap-status')).toHaveText('Saved'); // it does say so, once
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].body).toBe('call the dentist');
    expect(saved[0].status).toBe('note'); // the existing tier, not a new store
    expect(saved[0].id).toMatch(UUID); // client-minted, so the first save is an insert

    // 3. The pile updates in place.
    const rows = page.locator('#cap-recent li');
    await expect(rows.first()).toContainText('call the dentist');

    // 4. ＋ New parks it and hands over a blank, still focused.
    await page.locator('#cap-new').click();
    await expect(box).toHaveValue('');
    await expect(box).toBeFocused();

    // 5. The next thought is a NEW note — the bug that would matter most here is
    //    the second dump overwriting the first.
    await box.fill('idea: a constellation about thresholds');
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1].id).not.toBe(saved[0].id);
    expect(saved[1].body).toBe('idea: a constellation about thresholds');

    // 6. Both are in the pile, newest first — scratch sitting beside an essay
    //    seed, which is precisely the thing being judged.
    await expect(rows.nth(0)).toContainText('idea: a constellation about thresholds');
    await expect(rows.nth(1)).toContainText('call the dentist');
  });

  test('⌘/Ctrl+Enter parks the thought without reaching for the mouse', async ({ page }) => {
    const ids: Array<string | null> = [];
    await stubActions(page, {
      'fragments.saveWriting': (req) => {
        const id = field(req.postData(), 'id');
        ids.push(id);
        return { id, slug: 'stub', updated_at: new Date().toISOString() };
      },
    });

    await page.goto('/admin/capture-lab');
    const box = page.locator('#cap-box');

    await box.fill('one');
    await expect.poll(() => ids.length).toBe(1);
    await box.press('ControlOrMeta+Enter');
    await expect(box).toHaveValue('');

    await box.fill('two');
    await expect.poll(() => ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
