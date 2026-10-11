import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppError, ENV, REDIS } from '@libs/common';
import type { Env } from '@libs/common';
import { SITEMAP_PAGE_SIZE, SeoRepository } from './seo.repository';
import type { Lister } from './seo.repository';
import { sitemapIndex, urlSet } from './sitemap-xml';

export const SITEMAP_KINDS = [
  'pages',
  'problems',
  'contests',
  'posts',
  'users',
] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];
export const SITEMAP_CACHE_SECONDS = 3600;

/** Static top-level pages; the rest come from the database. */
const STATIC_PATHS = [
  '/',
  '/problems',
  '/contests',
  '/users',
  '/blog',
  '/organizations',
];
const staticLister: Lister = {
  count: () => Promise.resolve(STATIC_PATHS.length),
  page: (page) =>
    Promise.resolve(page === 1 ? STATIC_PATHS.map((path) => ({ path })) : []),
};

/** Public problems, contests, published personal posts and listed users, as a signed-out visitor sees them; cached for an hour. */
@Injectable()
export class SitemapService {
  private readonly listers: Record<SitemapKind, Lister>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    repository: SeoRepository,
  ) {
    this.listers = {
      pages: staticLister,
      problems: repository.problems,
      contests: repository.contests,
      posts: repository.posts,
      users: repository.users,
    };
  }

  index(): Promise<string> {
    return this.cached('sitemap:index', () => this.buildIndex());
  }

  async page(kind: SitemapKind, page: number): Promise<string> {
    const xml = await this.cached(`sitemap:${kind}:${page}`, () =>
      this.buildPage(kind, page),
    );
    if (xml === '') throw new AppError('not_found', 404, 'No such sitemap');
    return xml;
  }

  private async cached(
    key: string,
    build: () => Promise<string>,
  ): Promise<string> {
    const hit = await this.redis.get(key);
    if (hit !== null) return hit;
    const xml = await build();
    if (xml !== '') await this.redis.set(key, xml, 'EX', SITEMAP_CACHE_SECONDS);
    return xml;
  }

  private async buildIndex(): Promise<string> {
    const locations: string[] = [];
    for (const kind of SITEMAP_KINDS) {
      const count = await this.listers[kind].count();
      const pages = Math.max(1, Math.ceil(count / SITEMAP_PAGE_SIZE));
      for (let page = 1; page <= pages; page++)
        locations.push(`${this.env.siteUrl}/sitemap-${kind}-${page}.xml`);
    }
    return sitemapIndex(locations);
  }

  /** Empty string for a page past the end (the first page of an empty kind is a valid empty set). */
  private async buildPage(kind: SitemapKind, page: number): Promise<string> {
    const entries = await this.listers[kind].page(page);
    if (entries.length === 0 && page > 1) return '';
    return urlSet(entries.map((entry) => `${this.env.siteUrl}${entry.path}`));
  }
}
