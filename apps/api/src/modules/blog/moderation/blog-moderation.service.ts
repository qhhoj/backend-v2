import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { Paginated } from '@libs/common';
import type { BlogPost } from '@libs/database';
import type { FilterQuery, SortOrder } from 'mongoose';
import { BlogPostsService } from '../core/blog-posts.service';
import type { PostListItemResponse } from '../core/dto/post.response';
import type {
  ModerationState,
  PostModerationQueryDto,
} from './dto/blog-moderation.dto';

const NEWEST: Record<string, SortOrder> = { publishOn: -1, _id: -1 };

/** `hidden`: every draft, personal or organization. `scheduled`: visible posts whose publish time is still ahead. */
const filterFor = (state: ModerationState, now: Date): FilterQuery<BlogPost> =>
  state === 'hidden'
    ? { visible: false }
    : { visible: true, publishOn: { $gt: now } };

@Injectable()
export class BlogModerationService {
  constructor(private readonly posts: BlogPostsService) {}

  list(
    principal: Principal,
    { state, page }: PostModerationQueryDto,
    now = new Date(),
  ): Promise<Paginated<PostListItemResponse>> {
    return this.posts.pageOf(principal, filterFor(state, now), NEWEST, page);
  }
}
