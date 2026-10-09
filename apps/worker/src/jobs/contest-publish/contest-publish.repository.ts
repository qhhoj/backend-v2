import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
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
import type { Connection, Model } from 'mongoose';

export type PublishableContest = Pick<
  Contest,
  | '_id'
  | 'key'
  | 'startTime'
  | 'endTime'
  | 'problems'
  | 'authors'
  | 'curators'
  | 'publishAfterEnd'
  | 'publishAfterEndBy'
  | 'autoPublishOutcome'
>;

const publishComment = (contestKey: string): string =>
  `Published after contest ${contestKey}`;

@Injectable()
export class ContestPublishRepository {
  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  findContest(contestId: string): Promise<PublishableContest | null> {
    return this.contests
      .findById(contestId, {
        key: 1,
        startTime: 1,
        endTime: 1,
        problems: 1,
        authors: 1,
        curators: 1,
        publishAfterEnd: 1,
        publishAfterEndBy: 1,
        autoPublishOutcome: 1,
      })
      .lean<PublishableContest>()
      .exec();
  }

  /** Ended contests with the switch on and no outcome yet: what the minute sweep looks at. The filter states `publishAfterEnd: true`, so the partial `publish_after_end_due` index (contests with the switch on only) serves it once built; no hint, so the sweep still works before the index exists. */
  async dueContestIds(now: Date): Promise<string[]> {
    const due = await this.contests
      .find(
        {
          publishAfterEnd: true,
          autoPublishOutcome: null,
          endTime: { $lte: now },
        },
        { _id: 1 },
      )
      .lean<Array<{ _id: string }>>()
      .exec();
    return due.map(({ _id }) => uuidStr(_id));
  }

  /** The recorded editor, built by the same `buildPrincipal` as the api's `PrincipalService`; null when the account is gone or inactive. */
  async actorOf(userId: string): Promise<Principal | null> {
    const user = await this.users.findById(userId).exec();
    if (!user?.isActive) return null;
    const groups = await this.groups.find({ _id: { $in: user.groups } }).exec();
    return buildPrincipal(user, groups);
  }

  /** A trashed problem is returned too: the verdict skips it as `deleted`, and the writes below still refuse it. */
  findProblem(problemId: string): Promise<Problem | null> {
    return this.problems.findById(problemId).lean<Problem>().exec();
  }

  /** Only a live private problem moves, and the flip and its revision commit together (a crash cannot leave a published problem with no revision), so racing runs publish once. */
  async publishProblem(
    problemId: string,
    note: { contestKey: string; actorId: string },
  ): Promise<boolean> {
    let flipped = false;
    await this.connection.transaction(async (session) => {
      const { matchedCount } = await this.problems
        .updateOne(
          { _id: problemId, isPublic: false, deletedAt: null },
          { $set: { isPublic: true } },
          { session },
        )
        .exec();
      flipped = matchedCount === 1;
      if (!flipped) return;
      await this.revisions.create(
        [
          {
            entity: 'problem',
            entityId: problemId,
            action: 'edit',
            userId: note.actorId,
            changes: { isPublic: { before: false, after: true } },
            comment: publishComment(note.contestKey),
          },
        ],
        { session },
      );
    });
    return flipped;
  }

  /** Whether an earlier run of this contest's publish already made the problem public (its revision is the proof): the recovery path of a crash before the follow-up jobs were queued. */
  async wasPublishedBy(
    problemId: string,
    contestKey: string,
  ): Promise<boolean> {
    return (
      (await this.revisions.exists({
        entity: 'problem',
        entityId: problemId,
        action: 'edit',
        comment: publishComment(contestKey),
      })) !== null
    );
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
          deletedAt: null,
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
