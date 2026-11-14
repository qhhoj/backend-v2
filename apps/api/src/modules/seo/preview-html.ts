import { escapeHtml } from '@libs/common';

export interface Preview {
  title: string;
  description: string;
  /** Site path of the page, e.g. `/problems/aplusb`. */
  path: string;
  /** The page's own image (URL or site path); the site image when absent or empty. */
  image?: string;
  /** Unlisted pages (share links): bots that index must not. */
  isNoindex?: boolean;
}

export const SITE_NAME = 'QHHOJ';
export const SITE_DESCRIPTION = 'QHHOJ: online judge, contests and problems.';

/** Just the head tags link-preview bots read; people get the SPA (nginx sends only bots here). */
export const previewHtml = (
  preview: Preview,
  siteUrl: string,
  imageUrl: string,
): string => {
  const url = `${siteUrl}${preview.path}`;
  const title = escapeHtml(`${preview.title} - ${SITE_NAME}`);
  const description = escapeHtml(preview.description);
  const tags = [
    ['property', 'og:site_name', SITE_NAME],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', escapeHtml(url)],
    ['property', 'og:image', escapeHtml(imageUrl)],
    ['name', 'twitter:card', 'summary'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', escapeHtml(imageUrl)],
    ['name', 'description', description],
  ].map(
    ([attr, name, content]) => `<meta ${attr}="${name}" content="${content}">`,
  );
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    ...(preview.isNoindex
      ? ['<meta name="robots" content="noindex, nofollow">']
      : []),
    ...tags,
    `</head><body><a href="${escapeHtml(url)}">${title}</a></body></html>`,
    '',
  ].join('\n');
};
