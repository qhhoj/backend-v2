import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { escapeRegExp } from '@libs/common';
import type { Paginated } from '@libs/common';
import type { BlogPost } from '@libs/database';
import type { FilterQuery, SortOrder } from 'mongoose';
import { BlogPostsService } from '../core/blog-posts.service';
import type { PostListItemResponse } from '../core/dto/post.response';
import type {
  ModerationState,
  PostModerationQueryDto,
} from './dto/blog-moderation.dto';

const NEWEST: Record<string, SortOrder> = { publishOn: -1, _id: -1 };

/** `hidden`: every draft, personal or organization. `scheduled`: visible posts whose publish time is still ahead. `organization`: every organization post. `any`: every post (legacy `BlogPostAdmin`). */
const filterFor = (
  state: ModerationState,
  now: Date,
): FilterQuery<BlogPost> => {
  switch (state) {
    case 'hidden':
      return { visible: false };
    case 'scheduled':
      return { visible: true, publishOn: { $gt: now } };
    case 'organization':
      return { organization: { $ne: null } };
    case 'any':
      return {};
  }
};

@Injectable()
export class BlogModerationService {
  constructor(
    private readonly posts: BlogPostsService,
    private readonly users: UsersRepository,
  ) {}

  async list(
    principal: Principal,
    { state, search, page }: PostModerationQueryDto,
    now = new Date(),
  ): Promise<Paginated<PostListItemResponse>> {
    const filter = filterFor(state, now);
    const text = search?.trim();
    const textFilter = text ? await this.searchFilter(text) : {};
    return this.posts.pageOf(
      principal,
      { $and: [filter, textFilter] },
      NEWEST,
      page,
    );
  }

  /** The title contains `text`, or `text` is the username of one of the authors. */
  private async searchFilter(text: string): Promise<FilterQuery<BlogPost>> {
    const title = { title: { $regex: escapeRegExp(text), $options: 'i' } };
    const author = await this.users.findByUsername(text, { _id: 1 });
    return author ? { $or: [title, { authors: author._id }] } : title;
  }
}
