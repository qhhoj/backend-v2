import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const POST_FEEDS = ['global', 'all'] as const;
export type PostFeed = (typeof POST_FEEDS)[number];

/** Legacy `PostList`: the newsfeed (global posts, sticky first) or every personal post. */
export class PostListQueryDto {
  @ApiPropertyOptional({ enum: POST_FEEDS })
  @IsOptional()
  @IsIn(POST_FEEDS)
  feed: PostFeed = 'global';

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
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}
