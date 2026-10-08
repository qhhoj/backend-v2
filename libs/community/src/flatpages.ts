import { FLATPAGE_URL_MAX_LENGTH } from '@libs/database';

export { FLATPAGE_URL_MAX_LENGTH };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** The stored form of a flatpage url: leading slash, no trailing slash (`/about`, `/help/faq`); null when no page can have that url (empty, dot segments, control characters, too long). Legacy urls were `/about/`. */
export function normalizeFlatpageUrl(raw: string): string | null {
  if (raw.length > FLATPAGE_URL_MAX_LENGTH || CONTROL_CHARACTER.test(raw))
    return null;
  const segments = raw.split('/').filter(Boolean);
  if (
    !segments.length ||
    segments.some((part) => part === '.' || part === '..')
  )
    return null;
  return `/${segments.join('/')}`;
}
