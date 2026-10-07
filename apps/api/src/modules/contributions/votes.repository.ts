import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import type { VoteScore } from '@libs/community';
import {
  BlogPost,
  BlogVote,
  Comment,
  CommentVote,
  newId,
  uuidStr,
} from '@libs/database';

export type VoteTarget = 'blog' | 'comment';

interface VoteRow {
  voter: string;
  score: number;
}
interface ScoredRow {
  score: number;
}
interface Ledger {
  votes: Model<VoteRow>;
  /** The vote row's field naming the target (`blogVotes.blog`, `commentVotes.comment`). */
  field: 'blog' | 'comment';
  scored: Model<ScoredRow>;
}

/** Concurrent first votes by one voter can race the unique index past the transaction's retry. */
const DUPLICATE_RETRIES = 2;

/** The one writer of vote rows and of `score` on posts and comments. */
@Injectable()
export class VotesRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(BlogVote.name) private readonly blogVotes: Model<BlogVote>,
    @InjectModel(CommentVote.name)
    private readonly commentVotes: Model<CommentVote>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
  ) {}

  private ledger(target: VoteTarget): Ledger {
    return target === 'blog'
      ? {
          votes: this.blogVotes as unknown as Model<VoteRow>,
          field: 'blog',
          scored: this.posts as unknown as Model<ScoredRow>,
        }
      : {
          votes: this.commentVotes as unknown as Model<VoteRow>,
          field: 'comment',
          scored: this.comments as unknown as Model<ScoredRow>,
        };
  }

  /** Sets (or with 0 deletes) the voter's row and moves the target's score by the difference in one transaction (retried on write conflicts), so parallel votes never lose or double a point. Returns the new score. */
  async cast(
    target: VoteTarget,
    targetId: string,
    voterId: string,
    score: VoteScore,
  ): Promise<number> {
    const { votes, field, scored } = this.ledger(target);
    const key = { [field]: targetId, voter: voterId };
    for (let attempt = 0; ; attempt += 1) {
      try {
        let total = 0;
        await this.connection.transaction(async (session) => {
          const previous =
            score === 0
              ? await votes.findOneAndDelete(key, { session }).lean().exec()
              : await votes
                  .findOneAndUpdate(
                    key,
                    { $set: { score }, $setOnInsert: { _id: newId() } },
                    { upsert: true, new: false, session },
                  )
                  .lean()
                  .exec();
          const updated = await scored
            .findOneAndUpdate(
              { _id: targetId },
              { $inc: { score: score - (previous?.score ?? 0) } },
              { new: true, session, projection: { score: 1 } },
            )
            .lean()
            .exec();
          if (!updated)
            throw new AppError('not_found', 404, 'No such post or comment');
          total = updated.score;
        });
        return total;
      } catch (error) {
        if (!isDuplicateKey(error) || attempt >= DUPLICATE_RETRIES) throw error;
      }
    }
  }

  /** The viewer's votes on `targetIds`, through the unique `{target, voter}` index. */
  async viewerVotes(
    target: VoteTarget,
    targetIds: readonly string[],
    voterId: string,
  ): Promise<Map<string, VoteScore>> {
    const { votes, field } = this.ledger(target);
    if (!targetIds.length) return new Map();
    const rows = await votes
      .find(
        { [field]: { $in: targetIds }, voter: voterId },
        { [field]: 1, score: 1 },
      )
      .lean<Array<Record<string, unknown> & ScoredRow>>()
      .exec();
    return new Map(
      rows.map((row) => [
        uuidStr(row[field] as string),
        row.score as VoteScore,
      ]),
    );
  }

  /** Every vote on one target (moderation). */
  async votesOn(
    target: VoteTarget,
    targetId: string,
  ): Promise<Array<{ voter: string; score: number }>> {
    const { votes, field } = this.ledger(target);
    const rows = await votes
      .find({ [field]: targetId }, { voter: 1, score: 1 })
      .sort({ _id: 1 })
      .lean()
      .exec();
    return rows.map((row) => ({ voter: uuidStr(row.voter), score: row.score }));
  }
}
