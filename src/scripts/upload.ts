// Client-side image upload for the admin editors (docs/plans/03).
//
// Factored out of about-builder.ts, which proved this path in production: the
// SIGNED-IN BROWSER SESSION uploads to the `site` bucket and storage RLS
// (`is_admin()`) is the boundary. That precise wording matters — this is not a
// service-role path and must not become one. The anon key plus a real session
// is exactly what the rest of the app writes with.
import { createBrowserClient } from '@supabase/ssr';

/**
 * What we accept, and the extension each becomes.
 *
 * **No SVG, deliberately.** An SVG can carry script, and while a browser won't
 * run it inside an `<img>`, these files get public URLs on our own origin —
 * opening one directly would execute it as our origin. Nothing about an essay
 * needs vector art badly enough to take that.
 */
const EXT_FOR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Long edge after downscaling. ~2× the widest the reading column ever gets. */
export const MAX_EDGE = 1600;
/** Refuse before decoding — a 100 MB file shouldn't reach a canvas. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Refuse after re-encoding. Nothing legitimate lands here.  */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

let client: ReturnType<typeof createBrowserClient> | null = null;
const supabase = () =>
  (client ??= createBrowserClient(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_ANON_KEY));

export class UploadError extends Error {}

/**
 * Shrink to `maxEdge` and re-encode. Returns the original untouched whenever
 * re-encoding would be wrong or impossible, which is the safe direction:
 *
 * - **GIF** may be animated, and a canvas keeps exactly one frame.
 * - **A format the browser can't decode** (HEIC on most engines) — better to
 *   upload what we were given than to fail. iOS usually hands over JPEG from a
 *   file input anyway, so this is the paste/drop path.
 * - **Already small enough** — re-encoding would only lose quality.
 */
async function downscale(file: File, maxEdge: number): Promise<{ blob: Blob; contentType: string }> {
  const asIs = { blob: file as Blob, contentType: file.type };
  if (file.type === 'image/gif') return asIs;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return asIs;

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) {
    bitmap.close();
    return asIs;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return asIs;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // WebP where transparency might matter, JPEG for photographs.
  const contentType = file.type === 'image/png' || file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, contentType, 0.85));
  return blob ? { blob, contentType } : asIs;
}

/** First 6 bytes of SHA-256, hex. Enough to be unique within one fragment. */
async function shortHash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest).slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadImageOptions {
  /**
   * Build the storage path from the content hash and the final extension.
   * Essays key on the FRAGMENT ID rather than the slug — slugs change, and a
   * renamed piece shouldn't move its files. It also makes an orphan sweep
   * tractable later: list the prefixes, compare against live fragment ids.
   */
  pathFor(hash: string, ext: string): string;
  upsert?: boolean;
  maxEdge?: number;
}

export interface UploadedImage {
  /** Storage path — what the About page persists so it can replace the file. */
  path: string;
  /** Public URL — what an essay's markdown embeds. */
  url: string;
}

/** Validate → downscale → upload. Throws `UploadError` carrying a sentence to show. */
export async function uploadImage(file: File, opts: UploadImageOptions): Promise<UploadedImage> {
  if (!EXT_FOR[file.type]) {
    throw new UploadError(
      file.type === 'image/svg+xml'
        ? 'SVG images aren’t accepted — use a PNG or WebP.'
        : `That’s not an image this accepts (${file.type || 'unknown type'}). Try JPEG, PNG, WebP, GIF or AVIF.`,
    );
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new UploadError(`That file is ${(file.size / 1e6).toFixed(1)} MB — too large to process. Export it smaller first.`);
  }

  const { blob, contentType } = await downscale(file, opts.maxEdge ?? MAX_EDGE);
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(`Still ${(blob.size / 1e6).toFixed(1)} MB after resizing — too large to publish.`);
  }

  const ext = EXT_FOR[contentType] ?? EXT_FOR[file.type];
  const path = opts.pathFor(await shortHash(blob), ext);

  const sb = supabase();
  const { error } = await sb.storage.from('site').upload(path, blob, { upsert: opts.upsert ?? true, contentType });
  // A content-addressed path that already exists is the SAME image — re-pasting
  // one is not an error, it's a cache hit. Only surface anything else.
  if (error && !/exists/i.test(error.message)) throw new UploadError(`Upload failed: ${error.message}`);

  return { path, url: sb.storage.from('site').getPublicUrl(path).data.publicUrl };
}
