import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Comment,
  CommentLock,
  CommentPageCounter,
  CommentReport,
  CommentVote,
  Problem,
  Revision,
  uuidStr,
} from '@libs/database';
import type { Model } from 'mongoose';

/** What the purge needs of a problem to find its assets. */
export type PurgeTarget = Pick<
  Problem,
  | '_id'
  | 'code'
  | 'deletedAt'
  | 'purgeStartedAt'
  | 'purgedAt'
  | 'pdfStatementUrl'
  | 'materialUrl'
>;

const DELETED_SINCE = new Date(0);
/** The comment threads that belong to a problem: its page and its editorial page. */
const PROBLEM_PAGE_TYPES = ['problem', 'editorial'];
const DELETE_CHUNK = 1000;

/** Deliberately S: it reads the deleted problems it is purging. */
@Injectable()
export class ProblemPurgeRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(CommentVote.name)
    private readonly commentVotes: Model<CommentVote>,
    @InjectModel(CommentLock.name)
    private readonly commentLocks: Model<CommentLock>,
    @InjectModel(CommentReport.name)
    private readonly commentReports: Model<CommentReport>,
    @InjectModel(CommentPageCounter.name)
    private readonly commentCounters: Model<CommentPageCounter>,
  ) {}

  /** Not purged yet and either deleted before `cutoff` with no claim, or claimed before `staleBefore` whatever its age: a claim that old belongs to a purge that died, and a superuser's purge-now must not wait out the grace period to be finished (sparse `{deletedAt}` index). */
  async expiredIds(cutoff: Date, staleBefore: Date): Promise<string[]> {
    return (
      await this.problems
        .distinct('_id', {
          deletedAt: { $gt: DELETED_SINCE },
          purgedAt: null,
          $or: [
            { deletedAt: { $lte: cutoff }, purgeStartedAt: null },
            { purgeStartedAt: { $lte: staleBefore } },
          ],
        })
        .exec()
    ).map(uuidStr);
  }

  findTarget(problemId: string): Promise<PurgeTarget | null> {
    return this.problems
      .findById(problemId, {
        code: 1,
        deletedAt: 1,
        purgedAt: 1,
        pdfStatementUrl: 1,
        materialUrl: 1,
      })
      .lean<PurgeTarget>()
      .exec();
  }

  /** Marks the purge started (again, on a retry); false when the problem was restored or is already purged. A restore refuses a problem with `purgeStartedAt`, so after this nobody can bring it back mid-purge. */
  async claim(problemId: string, now: Date): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: problemId, deletedAt: { $gt: DELETED_SINCE }, purgedAt: null },
        { $set: { purgeStartedAt: now } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Other problems (deleted ones included) still pointing at an uploaded file: clones copy the urls. */
  countOtherReferences(
    field: 'pdfStatementUrl' | 'materialUrl',
    url: string,
    excludedId: string,
  ): Promise<number> {
    return this.problems
      .countDocuments({ [field]: url, _id: { $ne: excludedId } })
      .exec();
  }

  /** The problem's comments with their votes and reports, and the page locks and numbering counters. Returns the number of comments removed. */
  async removeComments(problemId: string): Promise<number> {
    const page = {
      'page.type': { $in: PROBLEM_PAGE_TYPES },
      'page.id': problemId,
    };
    const ids = await this.comments.distinct('_id', page).exec();
    for (let start = 0; start < ids.length; start += DELETE_CHUNK) {
      const chunk = ids.slice(start, start + DELETE_CHUNK);
      await this.commentVotes.deleteMany({ comment: { $in: chunk } }).exec();
      await this.comments.deleteMany({ _id: { $in: chunk } }).exec();
    }
    await this.commentLocks.deleteMany(page).exec();
    await this.commentReports.deleteMany(page).exec();
    await this.commentCounters.deleteMany(page).exec();
    return ids.length;
  }

  async removeRevisions(problemId: string): Promise<number> {
    const { deletedCount } = await this.revisions
      .deleteMany({ entity: 'problem', entityId: problemId })
      .exec();
    return deletedCount;
  }

  /** Statement fields and test data emptied and `purgedAt` set, last; `code`, `name`, `deletedAt`, `purgeStartedAt` and the counters stay. */
  async emptyToTombstone(problemId: string, now: Date): Promise<void> {
    await this.problems
      .updateOne(
        { _id: problemId },
        {
          $set: {
            purgedAt: now,
            description: '',
            descriptionHtml: '',
            summary: '',
            source: '',
            translations: [],
            solution: null,
            data: null,
            pdfStatementUrl: null,
            materialUrl: null,
            ogImage: '',
          },
        },
      )
      .exec();
  }
}
