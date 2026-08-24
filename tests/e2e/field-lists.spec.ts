// The field editor's list tier (plan 44) — the three fields that may hold a
// list, and the eleven that may not.
//
// ⚠ THIS IS THE ONLY PLACE THE PROPERTY IS CHECKED. `npm run verify` cannot see
// it: the behaviour is a ProseMirror schema, a toolbar and a Markdown
// serializer, and `mountMiniEditor` has no unit coverage because vitest runs
// `environment: 'node'` with no DOM. Green checks were explicitly NOT sufficient
// here, which is the case GROUND-RULES names.
//
// ⚠ THE SERIALIZED PAYLOAD IS THE ASSERTION THAT MATTERS. Before plan 44 a
// typed "- " was escaped by prosemirror-markdown to `\-`, so the field could
// not express a list even by hand. The test below captures the action payload
// and asserts a REAL list reaches it — that is the round trip, checked at the
// one point where a schema/serializer mismatch would show as data loss rather
// than as a visual bug.
//
// Read-only by construction, twice over: `test` from ./fixtures aborts
// `/_actions/**`, and the capture handler here aborts too. Nothing saves.
import { test, expect } from './fixtures';

const GOAL = '/admin/agenda/goals/morning-routine';

test('goal notes has list buttons, why does not', async ({ page }) => {
  // No click: the sheet's markup is server-rendered inside the <dialog>, so the
  // buttons' presence is a fact about the PROP, provable without opening it.
  // (Opening it here raced `goal-sheet.ts` loading — the same shape the house
  // `openSheet` helper carries, and nothing to do with this change.)
  await page.goto(GOAL);

  await expect(page.locator('#goal-notes-wrap [data-cmd="bulletList"]')).toHaveCount(1);
  await expect(page.locator('#goal-notes-wrap [data-cmd="orderedList"]')).toHaveCount(1);
  // The pair a foot apart — the whole register argument.
  await expect(page.locator('#goal-why-wrap [data-cmd="bulletList"]')).toHaveCount(0);
  await expect(page.locator('#goal-why-wrap [data-cmd="orderedList"]')).toHaveCount(0);
});

test('typing "- " makes a real list, and it serializes as one', async ({ page }) => {
  const payloads: string[] = [];
  // Registered AFTER the auto fixture, so this wins (LIFO) — capture, then
  // abort. Nothing reaches the database.
  await page.route('**/_actions/**', (route) => {
    payloads.push(route.request().postData() ?? '');
    return route.abort('failed');
  });

  await page.goto(GOAL);
  await page.locator('[data-edit-goal]').click();
  const notes = page.locator('#goal-notes .tiptap-doc');
  await notes.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('- Teeth');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Water');

  await expect(page.locator('#goal-notes ul li')).toHaveCount(2);

  // The button path, not just the input rule.
  await page.locator('#goal-notes-wrap [data-cmd="orderedList"]').click();
  await expect(page.locator('#goal-notes ol li')).toHaveCount(2);
  await page.locator('#goal-notes-wrap [data-cmd="bulletList"]').click();
  await expect(page.locator('#goal-notes ul li')).toHaveCount(2);

  await page.locator('#goal-form [data-submit]').click();
  await expect.poll(() => payloads.length).toBeGreaterThan(0);
  const body = payloads.join('\n');
  expect(body).toContain('Teeth');
  // The defect this plan opened with: a real list, never an escaped dash.
  expect(body).not.toContain('\\\\-');
  console.log('SERIALIZED PAYLOAD >>>', body.slice(0, 600));
});

test('a pasted bulleted list keeps its structure', async ({ page }) => {
  await page.goto(GOAL);
  await page.locator('[data-edit-goal]').click();
  const notes = page.locator('#goal-notes .tiptap-doc');
  await notes.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  await notes.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '- Out of bed before the phone\n- Teeth, water\n- Twenty minutes moving');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#goal-notes ul li')).toHaveCount(3);
});

test('a quote still has no list buttons', async ({ page }) => {
  await page.goto('/admin/library');
  await expect(page.locator('#quote-editor-wrap [data-cmd="bulletList"]')).toHaveCount(0);
});
