/** Account, admin and API paths stay out of search indexes; everything public is allowed. */
const DISALLOWED = [
  '/admin',
  '/api/',
  '/login',
  '/register',
  '/activate',
  '/forgot-password',
  '/reset-password',
  '/account',
  '/settings',
  '/notifications',
  '/tickets',
  '/submissions',
];

export const robotsTxt = (siteUrl: string): string =>
  [
    'User-agent: *',
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
