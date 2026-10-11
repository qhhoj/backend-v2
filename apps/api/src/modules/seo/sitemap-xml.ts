const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

const document = (root: string, entries: string[]): string =>
  `${HEADER}\n<${root} xmlns="${NAMESPACE}">\n${entries.join('\n')}\n</${root}>\n`;

export const urlSet = (locations: string[]): string =>
  document(
    'urlset',
    locations.map((loc) => `<url><loc>${escapeXml(loc)}</loc></url>`),
  );

export const sitemapIndex = (locations: string[]): string =>
  document(
    'sitemapindex',
    locations.map((loc) => `<sitemap><loc>${escapeXml(loc)}</loc></sitemap>`),
  );
