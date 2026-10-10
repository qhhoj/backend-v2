import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const POST_FEEDS = ['global', 'all'] as const;
export type PostFeed = (typeof POST_FEEDS)[number];

/** Legacy `PostList`: the newsfeed (global posts, sticky first) or every personal post. */
export class PostListQueryDto {
  /** global for the newsfeed, all for every published personal post. */
  @ApiPropertyOptional({ enum: POST_FEEDS, enumName: 'PostFeed' })
  @IsOptional()
  @IsIn(POST_FEEDS)
  feed: PostFeed = 'global';

  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

/** The paged lists under `/posts`, `/admin/posts`, `/users/{username}/blog` and `/organizations/{slug}/posts`. */
export class PostPageQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}
