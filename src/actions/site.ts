// ============================================================================
// The site's own surfaces: editable singleton pages, and the public contact
// form — the one action here that unauthenticated visitors can call.
// ============================================================================
import { defineAction } from 'astro:actions';
import { getSecret } from 'astro:env/server';
import { z } from 'astro/zod';
import { Resend } from 'resend';
import type { Json } from '../lib/database.types';
import { fail, requireAdmin } from './_shared';

/**
 * How long either outside service gets before the contact form gives up.
 *
 * ⚠ THE PERSON WAITING HERE IS A STRANGER (plans/30 · §5). Both calls below sit
 * between a visitor pressing Send and anything at all appearing, and neither
 * had a bound — so one hung upstream held the action, the form and the button
 * for whatever the platform allows, on the one surface in this application
 * whose entire job is to be used by somebody who has no reason to be patient.
 * Five seconds is generous for a token check that normally takes a hundred
 * milliseconds; ten is generous for handing an email to an API.
 */
const TURNSTILE_TIMEOUT_MS = 5_000;
const RESEND_TIMEOUT_MS = 10_000;

/**
 * One line, from something a stranger typed.
 *
 * ⚠ TWO PLACES BELOW PUT `name` WHERE A NEWLINE MEANS SOMETHING, and Zod's
 * `.trim()` only ever touched the ends of it.
 *
 *   · **The subject is a header**, and a header ends at its first newline. The
 *     Resend SDK hands the message over as JSON rather than assembling SMTP
 *     text, so it is very probably encoding this already — but *very probably*
 *     is not a property to rest on for the one field on this site that an
 *     unauthenticated stranger controls, and the fix is a `replace`.
 *   · **The body's `From:` line is the half that actually bites**, and it does
 *     not depend on any SMTP subtlety. A name of `Bob\nFrom: ceo@example.com`
 *     renders a second, forged `From:` in the plain text Michael reads — a
 *     small phishing surface aimed at exactly one person, who has no reason to
 *     suspect the line.
 *
 * The message body itself is NOT run through this: its newlines are the message.
 *
 * Exported for `actions-pure.test.ts` and for nothing else — the same trade that
 * file's header already makes for `recurrenceOf` and its neighbours.
 */
export const oneLine = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex -- the point is the control characters
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Verify a Cloudflare Turnstile token server-side. Returns false on any failure. */
async function verifyTurnstile(secret: string, token: string, ip?: string): Promise<boolean> {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      // A timeout lands in the `catch` below, so it fails CLOSED — the visitor
      // is asked to try again rather than waved through unverified.
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    const outcome = (await res.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}

// --- editable singleton pages (docs/admin.md): About, and future pages ------

/** The ceiling every long-text field in this layer shares. */
const PROSE = 20_000;

export const pages = {
  /** Save a page's structured content (a validated shape) to its `pages` row. */
  save: defineAction({
    input: z.object({
      slug: z.string().min(1),
      // The About page is two co-equal movements: `me` (who I am) and `site`
      // (what this place is), plus an optional contact line. See docs/admin.md.
      // ⚠ EVERY FIELD HERE IS BOUNDED, and it was the last long-text schema in
      // the layer that wasn't. `PROSE` is the 20k every other long field caps
      // at (`interactions.body`, `fragments.suggestSubjects`, `proofread`), and
      // it is a guard rather than an editorial opinion: this row is a `jsonb`
      // blob with no column widths of its own, so without a cap the only thing
      // standing between a stuck paste and the database is nothing at all. The
      // short fields get the length their control implies instead of the same
      // number, so the refusal names the actual mistake.
      content: z.object({
        // ⚠ `me.interests[]`, `me.headline` and `site.thesis` were removed
        // 2026-08-07 — ADR-0020. They are absent from this schema on purpose, and
        // Zod strips unknown keys, so an older row's copies stop round-tripping on
        // the next save. Do not re-add them without reading that ADR: the one
        // change that looks like an improvement (promote each interest's insight
        // to its heading) is the one it argues is strictly worse.
        me: z
          .object({
            // A storage path inside the `site` bucket, never a pasted URL.
            portrait: z.string().max(500).nullable().default(null),
            portrait_caption: z.string().max(300).default(''),
            body: z.string().max(PROSE).default(''),
          })
          .prefault({}),
        site: z
          .object({
            body: z.string().max(PROSE).default(''),
            name: z
              .object({
                blurb: z.string().max(PROSE).default(''),
                spotify_url: z.string().max(500).default(''),
              })
              .prefault({}),
          })
          .prefault({}),
        contact: z
          .object({
            // Optional copy shown above the public contact form.
            intro: z.string().max(PROSE).default(''),
          })
          .prefault({}),
      }),
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
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
      // ⚠ NO `requireAdmin` HERE, AND THAT IS NOT AN OVERSIGHT. Every other
      // mutating handler in this tree guards (see `requireAdmin`'s note in
      // _shared.ts); this one is the single deliberate exception, because a
      // contact form a stranger cannot use is not a contact form. What stands
      // in for the guard is the honeypot below, the Turnstile check, and the
      // fact that this writes to no table at all — it hands a message to
      // Resend and returns.
      //
      // Bots that trip the honeypot get a silent "success" — never a signal.
      if (input.company && input.company.trim()) return { ok: true };

      const ip =
        ctx.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        ctx.request.headers.get('x-real-ip') ||
        undefined;

      // Secrets via getSecret (astro:env/server): reads the server env in prod
      // AND .env files in dev — unlike import.meta.env, which since Astro v6
      // no longer exposes non-PUBLIC vars. See docs/environment-variables.
      //
      // ⚠ IN PROD, A MISSING TURNSTILE SECRET REFUSES THE SEND (plan 43 §3.2,
      // ruled 2026-08-18). It used to skip the check instead — right for local
      // dev, where no key exists and the widget isn't rendered, but in prod a
      // skip is indistinguishable from a misconfigured deploy, and the form
      // silently accepting unverified submissions is the one failure shape
      // nothing would ever surface. Refusing uses the same friendly-sentence
      // shape as the missing Resend key below, and `fail()` logs 5xx-class
      // errors — so the misconfiguration also lands in Vercel's function log
      // instead of arriving as spam. Dev keeps the skip; that is the branch.
      const turnstileSecret = getSecret('TURNSTILE_SECRET_KEY');
      if (!turnstileSecret) {
        if (import.meta.env.PROD) {
          throw fail('The contact form isn’t configured yet. Please try again later.', 'INTERNAL_SERVER_ERROR');
        }
      } else {
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
      // `oneLine` on the name at both sites — see its note. `email` needs none:
      // it has already been through `z.email()`, which no newline survives.
      const who = oneLine(input.name);
      const send = resend.emails.send({
        from,
        to,
        replyTo: input.email,
        subject: `New message from ${who}`,
        text: `From: ${who} <${input.email}>${ip ? `\nIP: ${ip}` : ''}\n\n${input.message}`,
      });

      // ⚠ A RACE, NOT A SIGNAL, AND THAT IS THE SDK'S LIMIT RATHER THAN A
      // PREFERENCE. `ResendOptions` is `{ baseUrl, userAgent }` and the send
      // options are `{ query, headers }` — there is nowhere to hand it an
      // `AbortSignal` and no custom-fetch hook to wrap, so this bounds the
      // WAIT rather than the request.
      //
      // ⚠ WHICH MAKES THE TIMEOUT OUTCOME GENUINELY AMBIGUOUS, and it is worth
      // being plain about: the request is still in flight when we stop waiting,
      // so a message can be delivered after the visitor has been told it wasn't.
      // That was weighed and accepted — a stranger who sends twice has cost
      // Michael a duplicate email, where a stranger left on a dead button has
      // been shown that the form does not work. Cost falls on the right side.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('resend-timeout')), RESEND_TIMEOUT_MS).unref?.(),
      );
      let sent;
      try {
        sent = await Promise.race([send, timeout]);
      } catch {
        throw fail('Sorry — the message didn’t send. Please try again.', 'GATEWAY_TIMEOUT');
      }
      if (sent.error) throw fail('Sorry — the message didn’t send. Please try again.', 'INTERNAL_SERVER_ERROR');
      return { ok: true };
    },
  }),
};
