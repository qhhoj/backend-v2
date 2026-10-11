import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  BlogPost,
  Contest,
  OrganizationProblem,
  OrganizationProblemTag,
  Problem,
} from '@libs/database';
import type { Model } from 'mongoose';

/** The content writes of an organization delete; each is idempotent, so a repeated delete finishes an interrupted one. */
@Injectable()
export class OrganizationUnlinkRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(OrganizationProblem.name)
    private readonly problemLinks: Model<OrganizationProblem>,
    @InjectModel(OrganizationProblemTag.name)
    private readonly problemTags: Model<OrganizationProblemTag>,
  ) {}

  /** Problems and contests keep their privacy flags: an organization-private one left with no organization is visible only to its editors. */
  async unlinkProblemsAndContests(organizationId: string): Promise<void> {
    const linked = { organizations: organizationId };
    const pull = { $pull: { organizations: organizationId } };
    await Promise.all([
      this.problems.updateMany(linked, pull).exec(),
      this.contests.updateMany(linked, pull).exec(),
      this.problemLinks.deleteMany({ organization: organizationId }).exec(),
      this.problemTags.deleteMany({ organization: organizationId }).exec(),
    ]);
  }

  /** A post without an organization is a personal post, public once visible, so detached posts are also hidden. */
  async unlinkPosts(organizationId: string): Promise<void> {
    await this.posts
      .updateMany(
        { organization: organizationId },
        { $set: { organization: null, visible: false } },
      )
      .exec();
  }
}
