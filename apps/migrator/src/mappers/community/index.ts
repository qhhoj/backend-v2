import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { BlogPostsMapper } from './blog-posts.mapper';
import { BlogVotesMapper } from './blog-votes.mapper';
import { CommentLocksMapper } from './comment-locks.mapper';
import { CommentVotesMapper } from './comment-votes.mapper';
import { CommentsMapper } from './comments.mapper';

/** This area's backfill jobs in run order. */
export const COMMUNITY_MAPPERS: Type<Mapper>[] = [
  CommentsMapper,
  CommentVotesMapper,
  CommentLocksMapper,
  BlogPostsMapper,
  BlogVotesMapper,
];
