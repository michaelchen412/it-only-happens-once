// The optimizer's width ladder — ONE owner, imported by both sides that must
// agree (plan 43 §5, and plan 42 §4.B.1 is why it is a module: a number with
// four owners is how `FILTER_THRESHOLD` ended up with a fifth that said 6).
//
// ⚠ ENTRIES ARE PERMISSIONS, NOT WORK — but they are also a FILTER, and the
// filter is silent. astro.config.mjs writes this list into the deployed
// `/_vercel/image` endpoint's allowlist, and every width any code asks for —
// `<Image widths={…}>` on the About page, `getImage({ widths })` under an
// essay — is snapped/filtered against it, with a one-entry srcset as the
// quiet failure mode (see the imagesConfig note in astro.config.mjs, which
// documents catching exactly that). If the two lists ever lived apart, an
// entry removed here would not error anywhere: essays would just ship less
// responsive images than the code asked for.
//
// 224/448 are the About portrait's 1×/2×; 640–1200 are what a ~640px reading
// column actually requests at 1×–2×; the rest is Vercel's own ladder, kept so
// a future full-bleed image still has range.
export const IMAGE_WIDTHS = [224, 448, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];
