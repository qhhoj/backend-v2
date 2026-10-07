import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const POST_FEEDS = ['global', 'all'] as const;
export type PostFeed = (typeof POST_FEEDS)[number];

/** Legacy `PostList`: the newsfeed (global posts, sticky first) or every personal post. */
export class PostListQueryDto {
  @IsOptional() @IsIn(POST_FEEDS) feed: PostFeed = 'global';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}

export class PostPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}
