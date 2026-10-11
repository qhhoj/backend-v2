import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { textExcerpt } from '../home/feed-xml';
import { previewHtml, SITE_DESCRIPTION, SITE_NAME } from './preview-html';
import type { Preview } from './preview-html';
import { SeoRepository } from './seo.repository';
import type { PreviewSource } from './seo.repository';

const DESCRIPTION_LENGTH = 200;
const IMAGE_PATH = '/og-image.png';

type Kind = 'problem' | 'contest' | 'post' | 'user';
/** Both the SPA routes and the legacy links mails and Discord carry. */
const ROUTES: Array<[RegExp, Kind, string]> = [
  [/^\/problems?\/([^/]+)\/?$/, 'problem', '/problems'],
  [/^\/contests?\/([^/]+)\/?$/, 'contest', '/contests'],
  [/^\/(?:blog|post)\/([^/]+)\/?$/, 'post', '/blog'],
  [/^\/users?\/([^/]+)\/?$/, 'user', '/users'],
];

/** Head tags for link-preview bots (Discord, Facebook, ...); a page that is missing or not public gets the site's generic tags, so a preview never confirms a private page exists. */
@Injectable()
export class PreviewService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: SeoRepository,
  ) {}

  async render(path: string): Promise<string> {
    const preview = (await this.resolve(path)) ?? {
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      path: '/',
    };
    return previewHtml(
      preview,
      this.env.siteUrl,
      `${this.env.siteUrl}${IMAGE_PATH}`,
    );
  }

  private async resolve(path: string): Promise<Preview | null> {
    for (const [pattern, kind, prefix] of ROUTES) {
      const key = decodeKey(pattern.exec(path)?.[1]);
      if (key === null) continue;
      const source = await this.source(kind, key);
      if (!source) return null;
      return {
        title: source.title,
        description:
          textExcerpt(source.text, DESCRIPTION_LENGTH) || SITE_DESCRIPTION,
        path: `${prefix}/${encodeURIComponent(key)}`,
      };
    }
    return null;
  }

  private source(kind: Kind, key: string): Promise<PreviewSource | null> {
    if (kind === 'problem') return this.repository.problem(key);
    if (kind === 'contest') return this.repository.contest(key);
    if (kind === 'post') return this.repository.post(key);
    return this.repository.user(key);
  }
}

const decodeKey = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};
