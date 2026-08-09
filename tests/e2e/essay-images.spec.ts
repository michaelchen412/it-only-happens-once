// Plan 03: images in essays.
//
// The capability that did not exist — before this, a blog post physically could
// not contain a picture. The render path was already fine (the sanitizer has
// allowlisted `img` all along); what was missing was every way of getting one
// in.
//
// READ-ONLY, two ways. `/_actions/**` is stubbed as usual, and so is
// `**/storage/v1/**` — so no file is written to the live `site` bucket and no
// row is written to the corpus. The upload REQUEST is still made and inspected,
// which is the part worth checking: it carries the path convention.
import type { Page } from '@playwright/test';
import { test, expect, stubActions } from './fixtures';

/** A real 1×1 PNG. Small enough that the downscale path returns it untouched. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface Uploaded {
  paths: string[];
  saves: string[];
}

/**
 * Intercept Supabase Storage and the composer's actions.
 *
 * `getPublicUrl` builds its URL client-side without a request, so the `<img>`
 * that lands in the editor points at a real-looking public URL that doesn't
 * exist — served here as the same PNG so the editor renders something.
 */
async function stubEverything(page: Page): Promise<Uploaded> {
  const paths: string[] = [];
  const saves: string[] = [];

  await page.route('**/storage/v1/object/public/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  await page.route('**/storage/v1/object/site/**', (route) => {
    paths.push(new URL(route.request().url()).pathname.replace(/^.*\/object\/site\//, ''));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'site/x' }) });
  });

  await stubActions(page, {
    'fragments.saveWriting': (req) => {
      saves.push(req.postData() ?? '');
      return { id: 'stub', slug: 'stub-slug', updated_at: new Date(0).toISOString() };
    },
  });
  return { paths, saves };
}

async function openComposer(page: Page) {
  await page.goto('/admin/fragments#new-writing');
  await expect(page.locator('#wsheet')).toBeVisible();
  await expect(page.locator('#ws-editor .tiptap-doc')).toBeVisible();
}

/** Click the toolbar's image button and hand it a file. */
async function insertViaToolbar(page: Page, name = 'photo.png') {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#ws-toolbar [data-cmd="image"]').click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: PNG });
}

const altDialog = (page: Page) => page.locator('#ws-alt-dialog');
const editorImg = (page: Page) => page.locator('#ws-editor .tiptap-doc img');

/**
 * supabase-js posts an upload as `multipart/form-data`, so the request body is
 * an envelope rather than the image — `postDataBuffer()` on its own decodes to
 * nothing. Pull out the one part that carries a Content-Type, which is the file.
 */
function filePart(body: Buffer, contentTypeHeader: string): { type: string; bytes: Buffer } {
  const boundary = contentTypeHeader.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error(`no boundary in ${contentTypeHeader}`);
  const sep = Buffer.from(`--${boundary}`);
  for (let i = body.indexOf(sep); i !== -1;) {
    const next = body.indexOf(sep, i + sep.length);
    if (next === -1) break;
    const part = body.subarray(i + sep.length, next);
    i = next;
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd === -1) continue;
    const type = part
      .subarray(0, headEnd)
      .toString('latin1')
      .match(/content-type:\s*([^\r\n]+)/i)?.[1];
    if (type) return { type: type.trim(), bytes: part.subarray(headEnd + 4, part.length - 2) };
  }
  throw new Error('no file part in the upload body');
}

test.describe('images in essays', () => {
  test('the toolbar puts a picture in the essay, keyed on the fragment id', async ({ page }) => {
    const { paths } = await stubEverything(page);
    await openComposer(page);
    await page.locator('#wsheet input[name="title"]').fill('A piece with a picture');

    await insertViaToolbar(page);

    // Alt text is asked for on insert, and it is a real prompt rather than a gate.
    await expect(altDialog(page)).toBeVisible();
    await altDialog(page).locator('.alt-text').fill('A snowy road at dusk');
    await altDialog(page).locator('.alt-apply').click();

    const img = editorImg(page);
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'A snowy road at dusk');

    // The path convention, which is the decision that makes an orphan sweep
    // possible later: essays/<fragment id>/<content hash>.<ext>. Keyed on the
    // ID and not the slug, so renaming a piece never moves its files.
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^essays\/[0-9a-f-]{36}\/[0-9a-f]{12}\.png$/);
  });

  test('the image reaches the database as ordinary markdown', async ({ page }) => {
    // The whole point of the round-trip: what gets stored is `![alt](url)`,
    // which the public sanitizer already allows. If tiptap-markdown ever stops
    // serialising the image node, the picture silently vanishes on save — this
    // is the assertion that catches it.
    const { saves } = await stubEverything(page);
    await openComposer(page);
    await page.locator('#wsheet input[name="title"]').fill('A piece with a picture');

    await insertViaToolbar(page);
    await altDialog(page).locator('.alt-text').fill('A snowy road at dusk');
    await altDialog(page).locator('.alt-apply').click();
    await expect(editorImg(page)).toBeVisible();

    await expect.poll(() => saves.length, { timeout: 6000 }).toBeGreaterThan(0);
    const body = saves.at(-1)!;
    expect(body).toContain('![A snowy road at dusk](');
    expect(body).toContain('/storage/v1/object/public/site/essays/');
  });

  test('pasting a screenshot uploads it — the affordance that actually matters', async ({ page }) => {
    const { paths } = await stubEverything(page);
    await openComposer(page);
    await page.locator('#ws-editor .tiptap-doc').click();
    await page.keyboard.type('Look at this:');

    // A real paste carrying a file, which is what ⌘V from a screenshot is.
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
      document
        .querySelector('#ws-editor .tiptap-doc')!
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG.toString('base64'));

    await expect(altDialog(page)).toBeVisible();
    await altDialog(page).locator('.alt-skip').click(); // "Leave empty" is allowed

    await expect(editorImg(page)).toBeVisible();
    await expect(editorImg(page)).toHaveAttribute('alt', '');
    expect(paths).toHaveLength(1);
    // The typed words survive the paste — it must not replace the selection.
    await expect(page.locator('#ws-editor .tiptap-doc')).toContainText('Look at this:');
  });

  test('clicking a picture lets you fix its description', async ({ page }) => {
    await stubEverything(page);
    await openComposer(page);
    await insertViaToolbar(page);
    await altDialog(page).locator('.alt-skip').click();
    await expect(editorImg(page)).toHaveAttribute('alt', '');

    await editorImg(page).click();
    await expect(altDialog(page)).toBeVisible();
    await altDialog(page).locator('.alt-text').fill('Added later');
    await altDialog(page).locator('.alt-apply').click();

    await expect(editorImg(page)).toHaveAttribute('alt', 'Added later');
  });

  test('a big photo is downscaled before it ever leaves the browser', async ({ page }) => {
    // The assertion the other specs can't make: they all paste a 1×1 PNG, which
    // skips the canvas path entirely. This one generates a 3000×2000 image, so
    // the resize actually runs — it's the only thing standing between a phone
    // photo and a 5MB page load.
    let uploaded: Buffer | null = null;
    let contentType = '';
    await page.route('**/storage/v1/object/public/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
    );
    await page.route('**/storage/v1/object/site/**', (route) => {
      uploaded = route.request().postDataBuffer();
      contentType = route.request().headers()['content-type'] ?? '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'site/x' }) });
    });
    await stubActions(page, {});
    await openComposer(page);

    const sourceBytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 3000;
      c.height = 2000;
      const ctx = c.getContext('2d')!;
      // Noise, not flat colour — a solid fill compresses to almost nothing and
      // would make the size comparison meaningless.
      const img = ctx.createImageData(3000, 2000);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = (i * 7) % 255;
        img.data[i + 1] = (i * 13) % 255;
        img.data[i + 2] = (i * 29) % 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      const file = new File([blob!], 'huge.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document
        .querySelector('#ws-editor .tiptap-doc')!
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return file.size;
    });

    await expect(altDialog(page)).toBeVisible();
    await altDialog(page).locator('.alt-skip').click();
    await expect(editorImg(page)).toBeVisible();

    expect(uploaded, 'the upload should have carried a body').not.toBeNull();
    const { type, bytes } = filePart(uploaded! as Buffer, contentType);

    // Decode what was ACTUALLY sent and measure it. 1600 is MAX_EDGE.
    const dims = await page.evaluate(async (b64) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([raw]));
      return { w: bmp.width, h: bmp.height };
    }, bytes.toString('base64'));

    expect(Math.max(dims.w, dims.h)).toBe(1600);
    expect(dims.w / dims.h).toBeCloseTo(1.5, 2); // aspect ratio preserved
    expect(bytes.length).toBeLessThan(sourceBytes); // and it actually got smaller
    // PNG re-encodes to WebP so transparency survives.
    expect(type).toBe('image/webp');
  });

  test('a file that is not an image is refused with a reason', async ({ page }) => {
    const { paths } = await stubEverything(page);
    await openComposer(page);

    const chooser = page.waitForEvent('filechooser');
    await page.locator('#ws-toolbar [data-cmd="image"]').click();
    await (await chooser).setFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });

    await expect(page.locator('#ws-error')).toBeVisible();
    await expect(page.locator('#ws-error')).toContainText('not an image');
    expect(paths, 'nothing should have been uploaded').toHaveLength(0);
    await expect(editorImg(page)).toHaveCount(0);
  });

  test('SVG is refused by name, because it is the one that matters', async ({ page }) => {
    // An SVG can carry script and these objects get public URLs on our own
    // origin. The message says so rather than lumping it in with "not an image".
    const { paths } = await stubEverything(page);
    await openComposer(page);

    const chooser = page.waitForEvent('filechooser');
    await page.locator('#ws-toolbar [data-cmd="image"]').click();
    await (
      await chooser
    ).setFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });

    await expect(page.locator('#ws-error')).toContainText('SVG');
    expect(paths).toHaveLength(0);
  });
});
