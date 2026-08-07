// ============================================================================
// The site's own surfaces: editable singleton pages, and the public contact
// form — the one action here that unauthenticated visitors can call.
// ============================================================================
import { defineAction } from 'astro:actions';
import { getSecret } from 'astro:env/server';
import { z } from 'astro/zod';
import { Resend } from 'resend';
import type { Json } from '../lib/database.types';
import { fail } from './_shared';

/** Verify a Cloudflare Turnstile token server-side. Returns false on any failure. */
async function verifyTurnstile(secret: string, token: string, ip?: string): Promise<boolean> {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const outcome = (await res.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}

// --- editable singleton pages (docs/admin.md): About, and future pages ------
export const pages = {
  /** Save a page's structured content (a validated shape) to its `pages` row. */
  save: defineAction({
    input: z.object({
      slug: z.string().min(1),
      // The About page is two co-equal movements: `me` (who I am) and `site`
      // (what this place is), plus an optional contact line. See docs/admin.md.
      content: z.object({
        // ⚠ `me.interests[]`, `me.headline` and `site.thesis` were removed
        // 2026-08-07 — ADR-0020. They are absent from this schema on purpose, and
        // Zod strips unknown keys, so an older row's copies stop round-tripping on
        // the next save. Do not re-add them without reading that ADR: the one
        // change that looks like an improvement (promote each interest's insight
        // to its heading) is the one it argues is strictly worse.
        me: z
          .object({
            portrait: z.string().nullable().default(null),
            portrait_caption: z.string().default(''),
            body: z.string().default(''),
          })
          .prefault({}),
        site: z
          .object({
            body: z.string().default(''),
            name: z
              .object({
                blurb: z.string().default(''),
                spotify_url: z.string().default(''),
              })
              .prefault({}),
          })
          .prefault({}),
        contact: z
          .object({
            // Optional copy shown above the public contact form.
            intro: z.string().default(''),
          })
          .prefault({}),
      }),
    }),
    handler: async (input, ctx) => {
      const { error } = await ctx.locals.supabase
        .from('pages')
        .upsert({ slug: input.slug, content: input.content as unknown as Json }, { onConflict: 'slug' });
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
};

// --- public contact form (unauthenticated: called from /about) --------------
// Not a DB write, so it needs no session/RLS. Spam is filtered by a honeypot
// field + a Cloudflare Turnstile token (verified below); delivery is Resend.
export const contact = {
  send: defineAction({
    input: z.object({
      name: z.string().trim().min(1, 'Please add your name').max(120),
      // ⚠ THE TRIM MUST HAPPEN BEFORE THE FORMAT CHECK, which is why this is a
      // `preprocess` and not the tidier-looking `z.email().trim()`. Zod 4
      // deprecated `z.string().email()` in favour of the top-level `z.email()`,
      // but the two do not compose the same way: `.trim()` chained AFTER
      // `z.email()` runs as a later transform, so the address is validated
      // while it still has whitespace on it. A pasted " me@example.com " —
      // which is most of them, on a phone — would start being rejected.
      email: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.email('Please use a valid email').max(200)),
      message: z.string().trim().min(1, 'Please write a message').max(5000),
      // Honeypot: a hidden field real people never fill in.
      company: z.string().optional(),
      // Cloudflare Turnstile token from the widget.
      token: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      // Bots that trip the honeypot get a silent "success" — never a signal.
      if (input.company && input.company.trim()) return { ok: true };

      const ip =
        ctx.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        ctx.request.headers.get('x-real-ip') ||
        undefined;

      // Secrets via getSecret (astro:env/server): reads the server env in prod
      // AND .env files in dev — unlike import.meta.env, which since Astro v6
      // no longer exposes non-PUBLIC vars. See docs/environment-variables.
      // Turnstile: enforced when configured; skipped in local dev without a key.
      const turnstileSecret = getSecret('TURNSTILE_SECRET_KEY');
      if (turnstileSecret) {
        if (!input.token) throw fail('Please complete the “I’m human” check.', 'BAD_REQUEST');
        const ok = await verifyTurnstile(turnstileSecret, input.token, ip);
        if (!ok) throw fail('That verification didn’t go through — please try again.', 'BAD_REQUEST');
      }

      const resendKey = getSecret('RESEND_API_KEY');
      const to = getSecret('CONTACT_TO_EMAIL');
      if (!resendKey || !to) {
        throw fail('The contact form isn’t configured yet. Please try again later.', 'INTERNAL_SERVER_ERROR');
      }
      const from = getSecret('CONTACT_FROM_EMAIL') || 'It Only Happens Once <onboarding@resend.dev>';

      const resend = new Resend(resendKey);
      const { error } = await resend.emails.send({
        from,
        to,
        replyTo: input.email,
        subject: `New message from ${input.name}`,
        text: `From: ${input.name} <${input.email}>${ip ? `\nIP: ${ip}` : ''}\n\n${input.message}`,
      });
      if (error) throw fail('Sorry — the message didn’t send. Please try again.', 'INTERNAL_SERVER_ERROR');
      return { ok: true };
    },
  }),
};
