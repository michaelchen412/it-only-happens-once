// Web push, from first principles, on Web Crypto alone.
//
// RFC 8291 (message encryption, aes128gcm) + RFC 8292 (VAPID). No dependencies,
// and that is a decision rather than an accident — see the plan (21 · Phase 2)
// and ADR-0019.
//
// ── WHY HAND-ROLLED ─────────────────────────────────────────────────────────
//
// The sender runs unattended on a schedule, in Deno, where nobody is watching
// it fail. The Node ecosystem's `web-push` does not run cleanly there, and the
// Deno-native libraries want VAPID keys as JWK while every generator in common
// use (including `npx web-push generate-vapid-keys`, which is what
// `.env.example` tells you to run) emits raw base64url. That mismatch is a
// silent one: the wrong key format does not throw, it produces a signature the
// push service rejects with a 403 that reads like a configuration problem.
//
// This file is ~150 lines of well-specified crypto with no supply chain and no
// format negotiation, and it runs identically in Node and Deno because it
// touches nothing but `crypto.subtle`, `fetch`, `atob`/`btoa`. That portability
// is what let it be tested against a real phone from a laptop before it was
// ever deployed — which is the only reason to trust it.
//
// ⚠ EVERY BYTE HERE IS LOAD-BEARING AND NONE OF IT IS OBSERVABLE. A wrong
// length, a missing 0x00, a base64 variant with `+` instead of `-`, and the
// push service answers 400 or 403 with no detail. If you change something here,
// send a real push to a real phone before believing it.

const enc = new TextEncoder();

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * An uncompressed P-256 point (65 bytes: `0x04 || x || y`) as a JWK, optionally
 * with the private scalar.
 *
 * ⚠ THIS IS THE FORMAT BRIDGE the header talks about. Push subscriptions and
 * VAPID generators both speak raw points; `crypto.subtle.importKey` speaks JWK
 * (or `raw`, which cannot carry a private key at all). One conversion, in one
 * place, rather than a dependency that assumes the other convention.
 */
function pointToJwk(point: Uint8Array, d?: Uint8Array): JsonWebKey {
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(`expected a 65-byte uncompressed P-256 point, got ${point.length} bytes`);
  }
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(point.subarray(1, 33)),
    y: bytesToB64url(point.subarray(33, 65)),
    ext: true,
  };
  if (d) jwk.d = bytesToB64url(d);
  return jwk;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * Encrypt a payload for one subscription — RFC 8291 §3.4 then RFC 8188.
 *
 * The body it returns is the aes128gcm content-coding, whose header is
 * `salt(16) || rs(4) || idlen(1) || keyid(65)` followed by the ciphertext. The
 * `keyid` is our EPHEMERAL public key: a fresh keypair per message is what
 * makes the encryption forward-secret, so it must never be hoisted out of this
 * function to "save a little work".
 */
async function encrypt(payload: string, sub: Subscription): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'jwk',
    pointToJwk(uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256),
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // ⚠ THE ORDER IS ua THEN as, AND THE NUL IS NOT DECORATION. RFC 8291 §3.4:
  // `key_info = "WebPush: info" || 0x00 || ua_public || as_public`. Swap the
  // two keys and everything still runs, produces a plausible body, and is
  // rejected by the device with no diagnosis.
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);

  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // `0x02` is the last-record delimiter (RFC 8188 §2). A single record is all
  // we ever send; `0x01` would say "more records follow" and the device would
  // wait for one that never comes.
  const plaintext = concat(enc.encode(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plaintext));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/**
 * The `Authorization: vapid t=…, k=…` header — RFC 8292.
 *
 * ⚠ `aud` IS THE PUSH SERVICE'S ORIGIN, NOT OUR SITE and not the full endpoint.
 * Apple, Google and Mozilla each reject a token audienced at anything else, and
 * because the endpoint host differs per subscription this has to be computed
 * per message rather than once at startup.
 */
async function vapidAuth(endpoint: string, vapid: Vapid): Promise<string> {
  const claims = {
    aud: new URL(endpoint).origin,
    // Twelve hours. The spec caps it at 24; short enough that a leaked token
    // expires, long enough that clock skew is never the reason a push failed.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  };
  const signingInput = [
    bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))),
    bytesToB64url(enc.encode(JSON.stringify(claims))),
  ].join('.');

  const key = await crypto.subtle.importKey(
    'jwk',
    pointToJwk(b64urlToBytes(vapid.publicKey), b64urlToBytes(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // ⚠ RAW r||s, WHICH IS WHAT WEB CRYPTO ALREADY RETURNS FOR ECDSA. A DER
  // signature is the classic wrong turn here — it is what most command-line
  // tooling emits, it is 70-ish bytes rather than 64, and it fails as a 403.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)),
  );

  return `vapid t=${signingInput}.${bytesToB64url(signature)}, k=${vapid.publicKey}`;
}

/**
 * Deliver one message. Returns the push service's status code — the CALLER
 * decides what it means, because the only interesting cases are 404 and 410
 * ("this subscription is dead, delete the row") and that is a database
 * decision rather than a transport one.
 *
 * ⚠ IT GIVES UP AFTER 10 SECONDS, and the timeout is not defensive padding. The
 * caller is `pg_cron` via `pg_net`, which abandons the REQUEST at 30s but
 * cannot stop this function from running — so a push service that accepts a
 * connection and never answers would hold the invocation open with nobody left
 * to hear the result. A rejected fetch is caught by the loop upstream and
 * reported as a failure for that endpoint, which is exactly right: unreachable
 * is a per-device fact, not a reason to abandon the other devices.
 */
export async function sendPush(sub: Subscription, payload: string, vapid: Vapid, ttl = 60): Promise<number> {
  const body = await encrypt(payload, sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

/**
 * The Declarative Web Push payload (WebKit, iOS/Safari 18.4+).
 *
 * ⚠ NO SERVICE WORKER RENDERS THIS. The device does, which is the whole reason
 * this project has no `sw.js` (ADR-0019). `web_push: 8030` is the marker that
 * makes it declarative — omit it and the message is an ordinary push that
 * nothing is listening for, so it arrives and silently does nothing.
 *
 * ⚠ NO `app_badge`. It was sent, accepted, delivered and ignored by the device
 * on 2026-08-06, and Michael declined the chase: *"I don't really care about
 * that icon having a count."* Its absence is a decision on evidence — see the
 * plan's Phase 1 before adding it back.
 *
 * ⚠ NO `body` either. iOS prints the web app's own name above the title, so a
 * body repeating it is noise; the title carries the whole sentence.
 */
export function declarative(title: string, navigate: string): string {
  return JSON.stringify({
    web_push: 8030,
    notification: { title, navigate, lang: 'en-US', dir: 'ltr' },
  });
}
