/**
 * Slugs are a fragment's URL identity (`/blog/forgiveness`) and are unique
 * across all fragments (data-model.md §6). This turns a title (or any text)
 * into a clean, lowercase, ASCII-ish slug; uniqueness is enforced separately
 * at save time (see uniqueSlug in the actions).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD') // split accented letters into base + diacritic
    .replace(/[̀-ͯ]/g, '') // drop the diacritics
    .toLowerCase()
    .replace(/['’]/g, '') // don't turn "don't" into "don-t"
    .replace(/[^a-z0-9]+/g, '-') // everything else becomes a separator
    .replace(/^-+|-+$/g, '') // trim leading/trailing separators
    .slice(0, 80);
}
