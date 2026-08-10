/**
 * `wawoff2` ships no types, and the OG card endpoint needs exactly one of its
 * functions (`src/pages/og/[slug].png.ts`): satori cannot parse woff2, so the
 * card's fonts are unpacked to TrueType at request time.
 *
 * ⚠ ITS OWN FILE, AND THAT IS NOT TIDINESS. This was written into `env.d.ts`
 * first and had NO EFFECT: that file has top-level imports, which makes it a
 * module, and inside a module `declare module 'x'` is an AUGMENTATION of an
 * existing module rather than a declaration of a new one. Augmenting a package
 * that has no types augments nothing, and `astro check` went on reporting
 * ts(7016) with the declaration sitting right there. An ambient declaration
 * needs a file with no imports and no exports.
 *
 * Declared rather than suppressed with `@ts-expect-error`: a shape is a claim a
 * reader can check against the package, where a suppression is a claim that
 * something is fine with no way to tell.
 */
declare module 'wawoff2' {
  export function decompress(input: Uint8Array | Buffer): Promise<Uint8Array>;
  export function compress(input: Uint8Array | Buffer): Promise<Uint8Array>;
}
