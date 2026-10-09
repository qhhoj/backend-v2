const TAG_MAX = 20;

/** A legacy contest tag name as a v2 tag (`^[a-z0-9-]{1,20}$`); null when nothing is left. */
export function tagSlug(name: string): string | null {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_MAX)
    .replace(/-+$/, '');
  return slug || null;
}
