import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, REDIS } from '@libs/common';
import type { Env } from '@libs/common';
import { commentLink, pagePath } from '@libs/community';
import { uuidStr } from '@libs/database';
import { BlogAccess } from '../blog/core/blog-access';
import { BlogPostsRepository } from '../blog/core/blog-posts.repository';
import { RecentCommentsService } from '../comments/core/recent-comments.service';
import type { FeedFormat, FeedKind } from './dto/feed-params.dto';
import { atomFeed, rssFeed, textExcerpt } from './feed-xml';
import type { FeedChannel, FeedItem } from './feed-xml';
import { HomeRepository } from './home.repository';

export const FEED_ITEMS = 25;
export const FEED_CACHE_SECONDS = 300;
const SITE_NAME = 'QHHOJ';
const DESCRIPTIONS: Record<FeedKind, string> = {
  blog: `Latest ${SITE_NAME} blog posts`,
  comments: `Latest ${SITE_NAME} comments`,
  problems: `Recently added ${SITE_NAME} problems`,
};

/** Legacy `judge/feed.py`, for a signed-out viewer only: personal published posts, comments on pages anyone may read, public problems (legacy fed organization posts too). One cached document per kind and format, never per viewer. */
@Injectable()
export class FeedsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly posts: BlogPostsRepository,
    private readonly recentComments: RecentCommentsService,
    private readonly home: HomeRepository,
  ) {}

  async feed(
    kind: FeedKind,
    format: FeedFormat,
    now = new Date(),
  ): Promise<string> {
    const key = `feed:${kind}:${format}`;
    const cached = await this.redis.get(key);
    if (cached !== null) return cached;
    const channel: FeedChannel = {
      title: DESCRIPTIONS[kind],
      link: `${this.env.siteUrl}/`,
      selfLink: `${this.env.siteUrl}/feed/${kind}/${format}/`,
      description: DESCRIPTIONS[kind],
      author: SITE_NAME,
    };
    const items = await this.items(kind, now);
    const xml =
      format === 'rss' ? rssFeed(channel, items) : atomFeed(channel, items);
    await this.redis.set(key, xml, 'EX', FEED_CACHE_SECONDS);
    return xml;
  }

  private async items(kind: FeedKind, now: Date): Promise<FeedItem[]> {
    const site = this.env.siteUrl;
    if (kind === 'blog')
      return (
        await this.posts.newest(
          BlogAccess.publishedPersonalFilter(now),
          { publishOn: -1, _id: -1 },
          FEED_ITEMS,
        )
      ).map((post) => ({
        id: uuidStr(post._id),
        title: post.title,
        link: `${site}${pagePath('blog', uuidStr(post._id))}`,
        published: post.publishOn,
        html: post.summaryHtml || post.contentHtml,
      }));
    if (kind === 'comments')
      return (
        await this.recentComments.newest(null, { limit: FEED_ITEMS })
      ).items.map((comment) => ({
        id: comment.id,
        title: `${comment.author?.username ?? 'unknown'} -> ${comment.page.title}`,
        link: `${site}${commentLink(comment.page.type, comment.page.key, comment.id)}`,
        published: comment.createdAt,
        html: comment.bodyHtml,
      }));
    return (await this.home.newProblems(FEED_ITEMS, true)).map((problem) => ({
      id: uuidStr(problem._id),
      title: problem.name,
      link: `${site}${pagePath('problem', problem.code)}`,
      published: problem.date,
      html: `${textExcerpt(problem.descriptionHtml, 500)}...`,
    }));
  }
}
