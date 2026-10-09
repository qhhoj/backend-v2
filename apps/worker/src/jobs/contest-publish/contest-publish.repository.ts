import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { buildPrincipal } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  Contest,
  Group,
  Problem,
  Revision,
  User,
  uuidStr,
} from '@libs/database';
import type { ContestAutoPublishOutcome } from '@libs/database';
import type { Model } from 'mongoose';

export type PublishableContest = Pick<
  Contest,
  | '_id'
  | 'key'
  | 'startTime'
  | 'endTime'
  | 'problems'
  | 'publishAfterEnd'
  | 'publishAfterEndBy'
  | 'autoPublishOutcome'
>;

@Injectable()
export class ContestPublishRepository {
  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Group.name) private readonly groups: Model<Group>,
  ) {}

  findContest(contestId: string): Promise<PublishableContest | null> {
    return this.contests
      .findById(contestId, {
        key: 1,
        startTime: 1,
        endTime: 1,
        problems: 1,
        publishAfterEnd: 1,
        publishAfterEndBy: 1,
        autoPublishOutcome: 1,
      })
      .lean<PublishableContest>()
      .exec();
  }

  /** Ended contests with the switch on and no outcome yet: what the minute sweep looks at (`endTime` index). */
  async dueContestIds(now: Date): Promise<string[]> {
    return (
      await this.contests
        .distinct('_id', {
          publishAfterEnd: true,
          autoPublishOutcome: null,
          endTime: { $lte: now },
        })
        .exec()
    ).map(uuidStr);
  }

  /** The recorded editor, built by the same `buildPrincipal` as the api's `PrincipalService`; null when the account is gone or inactive. */
  async actorOf(userId: string): Promise<Principal | null> {
    const user = await this.users.findById(userId).exec();
    if (!user?.isActive) return null;
    const groups = await this.groups.find({ _id: { $in: user.groups } }).exec();
    return buildPrincipal(user, groups);
  }

  /** A deleted problem reads as missing, so the verdict skips it as `not_found`. */
  findProblem(problemId: string): Promise<Problem | null> {
    return this.problems
      .findOne({ _id: problemId, deletedAt: null })
      .lean<Problem>()
      .exec();
  }

  /** Only a private problem moves, so racing runs publish (and write the revision) once. */
  async publishProblem(
    problemId: string,
    note: { contestKey: string; actorId: string },
  ): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: problemId, isPublic: false },
        { $set: { isPublic: true } },
      )
      .exec();
    if (matchedCount === 0) return false;
    await this.revisions.create({
      entity: 'problem',
      entityId: problemId,
      action: 'edit',
      userId: note.actorId,
      changes: { isPublic: { before: false, after: true } },
      comment: `Published after contest ${note.contestKey}`,
    });
    return true;
  }

  /** Compare-and-set: only the writer that finds the editorial unreleased records the revision; false when it is missing or already released. */
  async releaseEditorial(
    problem: Problem,
    note: { actorId: string; now: Date },
  ): Promise<boolean> {
    const problemId = uuidStr(problem._id);
    const { modifiedCount } = await this.problems
      .updateOne(
        {
          _id: problemId,
          solution: { $ne: null },
          $or: [
            { 'solution.isPublic': false },
            { 'solution.publishOn': { $gt: note.now } },
          ],
        },
        {
          $set: { 'solution.isPublic': true, 'solution.publishOn': note.now },
        },
      )
      .exec();
    if (modifiedCount !== 1) return false;
    await this.revisions.create({
      entity: 'problem',
      entityId: problemId,
      action: 'editorial',
      userId: note.actorId,
      changes: {
        solution: {
          before: {
            isPublic: problem.solution?.isPublic,
            publishOn: problem.solution?.publishOn,
          },
          after: { isPublic: true, publishOn: note.now },
        },
      },
      comment: 'Editorial published after contest',
    });
    return true;
  }

  /** Written once: a second writer finds the outcome set and changes nothing. */
  async recordOutcome(
    contestId: string,
    outcome: ContestAutoPublishOutcome,
  ): Promise<void> {
    await this.contests
      .updateOne(
        { _id: contestId, autoPublishOutcome: null },
        { $set: { autoPublishOutcome: outcome } },
      )
      .exec();
  }
}
