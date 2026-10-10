import { IsIn } from 'class-validator';

export const FEED_KINDS = ['blog', 'comments', 'problems'] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
export const FEED_FORMATS = ['rss', 'atom'] as const;
export type FeedFormat = (typeof FEED_FORMATS)[number];

export class FeedParamsDto {
  /** Which feed: `blog`, `comments` or `problems`. */
  @IsIn(FEED_KINDS) kind!: FeedKind;
  /** Feed format: `rss` or `atom`. */
  @IsIn(FEED_FORMATS) format!: FeedFormat;
}
