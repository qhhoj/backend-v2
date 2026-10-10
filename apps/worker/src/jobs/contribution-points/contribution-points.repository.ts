import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { ContributionTotals } from '@libs/community';
import {
  BlogPost,
  Comment,
  Problem,
  Ticket,
  toUuid,
  User,
} from '@libs/database';

interface Total {
  total: number;
}

@Injectable()
export class ContributionPointsRepository {
  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Ticket.name) private readonly tickets: Model<Ticket>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** Through `{author, hidden, _id}`, `{authors, organization, ...}` `{suggester}` and `{user, isContributive}`. */
  async totals(userId: string): Promise<ContributionTotals> {
    const [comments, posts, publicSuggestions, goodTickets] = await Promise.all(
      [
        this.comments
          .aggregate<Total>([
            {
              $match: {
                author: toUuid(userId),
                hidden: false,
                deletedAt: null,
              },
            },
            { $group: { _id: null, total: { $sum: '$score' } } },
          ])
          .exec(),
        this.posts
          .aggregate<Total>([
            {
              $match: {
                authors: toUuid(userId),
                organization: null,
                visible: true,
              },
            },
            { $group: { _id: null, total: { $sum: '$score' } } },
          ])
          .exec(),
        this.problems
          .countDocuments({
            suggester: userId,
            isPublic: true,
            deletedAt: null,
          })
          .exec(),
        this.tickets
          .countDocuments({ user: userId, isContributive: true })
          .exec(),
      ],
    );
    return {
      commentScore: comments[0]?.total ?? 0,
      postScore: posts[0]?.total ?? 0,
      goodTickets,
      publicSuggestions,
    };
  }

  async setPoints(userId: string, contributionPoints: number): Promise<void> {
    await this.users
      .updateOne({ _id: userId }, { $set: { contributionPoints } })
      .exec();
  }
}
