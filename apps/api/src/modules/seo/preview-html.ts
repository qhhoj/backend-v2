export interface Preview {
  title: string;
  description: string;
  /** Site path of the page, e.g. `/problems/aplusb`. */
  path: string;
  /** The page's own image (URL or site path); the site image when absent or empty. */
  image?: string;
}

export const SITE_NAME = 'QHHOJ';
export const SITE_DESCRIPTION = 'QHHOJ: online judge, contests and problems.';

const escapeAttr = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Just the head tags link-preview bots read; people get the SPA (nginx sends only bots here). */
export const previewHtml = (
  preview: Preview,
  siteUrl: string,
  imageUrl: string,
): string => {
  const url = `${siteUrl}${preview.path}`;
  const title = escapeAttr(`${preview.title} - ${SITE_NAME}`);
  const description = escapeAttr(preview.description);
  const tags = [
    ['property', 'og:site_name', SITE_NAME],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', escapeAttr(url)],
    ['property', 'og:image', escapeAttr(imageUrl)],
    ['name', 'twitter:card', 'summary'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', escapeAttr(imageUrl)],
    ['name', 'description', description],
  ].map(
    ([attr, name, content]) => `<meta ${attr}="${name}" content="${content}">`,
  );
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    `<link rel="canonical" href="${escapeAttr(url)}">`,
    ...tags,
    `</head><body><a href="${escapeAttr(url)}">${title}</a></body></html>`,
    '',
  ].join('\n');
};
