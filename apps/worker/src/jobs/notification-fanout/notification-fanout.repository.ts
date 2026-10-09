import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Contest,
  ContestAnnouncement,
  ContestParticipation,
  isUuid,
  newId,
  Notification,
  uuidStr,
} from '@libs/database';
import type { ContestFormatName } from '@libs/database';
import { notificationExpiry } from '@libs/community';
import type { NotificationDraft } from '@libs/community';
import type { Model } from 'mongoose';

export interface AnnouncedContest {
  _id: string;
  key: string;
  name: string;
  startTime: Date;
  endTime: Date;
  timeLimit: number | null;
  frozenLastMinutes: number;
  formatName: ContestFormatName;
}

export interface ParticipantRow {
  user: unknown;
  virtual: number;
  realStart: Date;
  isRegistered: boolean;
}

const MONGO_DUPLICATE_KEY = 11000;
/** Announcements remembered per row: a retry older than this many announcements on one unread row would count again. */
const REFS_KEPT = 20;

const textFields = (draft: NotificationDraft) => ({
  kind: draft.kind,
  title: draft.title,
  body: draft.body,
  path: draft.path,
  priority: draft.priority,
});

interface WriteFailure {
  index: number;
  code?: number;
}

/** The failed writes of a bulk error, or none when it is another kind of error. */
function writeFailures(error: unknown): WriteFailure[] {
  const { writeErrors } = error as { writeErrors?: unknown };
  if (!writeErrors) return [];
  return (
    Array.isArray(writeErrors) ? writeErrors : [writeErrors]
  ) as WriteFailure[];
}

/** One announcement as written to inboxes: `at` orders rows and text (the announcement's creation), `now` is the processing time that rows expire from. */
export interface AnnouncementStamp {
  ref: string;
  at: Date;
  now: Date;
}

/** Merge rounds per chunk: a user whose insert lost to a concurrent writer merges into the row that writer made. */
const MERGE_ROUNDS = 3;

@Injectable()
export class NotificationFanoutRepository {
  constructor(
    @InjectModel(ContestAnnouncement.name)
    private readonly announcements: Model<ContestAnnouncement>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  announcement(id: string): Promise<ContestAnnouncement | null> {
    return isUuid(id)
      ? this.announcements.findById(id).lean<ContestAnnouncement>().exec()
      : Promise.resolve(null);
  }

  contest(id: string): Promise<AnnouncedContest | null> {
    return this.contests
      .findById(id, {
        key: 1,
        name: 1,
        startTime: 1,
        endTime: 1,
        timeLimit: 1,
        frozenLastMinutes: 1,
        formatName: 1,
      })
      .lean<AnnouncedContest>()
      .exec();
  }

  /** One pass through `{contest, virtual}`: live and virtual rows, never spectators. */
  participationsOf(contestId: string): AsyncIterable<ParticipantRow> {
    return this.participations
      .find(
        { contest: contestId, virtual: { $gte: 0 } },
        { user: 1, virtual: 1, realStart: 1, isRegistered: 1 },
      )
      .lean<ParticipantRow[]>()
      .cursor();
  }

  /** The users of `userIds` that already took announcement `ref`, in an unread or a read row: found by `{user, refs}`. */
  async appliedUsers(
    userIds: readonly string[],
    ref: string,
  ): Promise<Set<string>> {
    const rows = await this.notifications
      .find({ user: { $in: userIds }, refs: ref }, { user: 1 })
      .lean<{ user: unknown }[]>()
      .exec();
    return new Set(rows.map((row) => uuidStr(row.user)));
  }

  /** Per user: merge into the unread row of the group, else insert (the filter names `unread: true`, the partial unique index). A user whose insert lost to a concurrent writer is merged again, up to `MERGE_ROUNDS`. Then the texts follow the newest announcement only: `lastActivityAt` moves forward with `$max`, so a reordered run puts nothing older on top. Call it for users `appliedUsers` did not return. */
  async upsertRows(
    userIds: readonly string[],
    draft: NotificationDraft,
    stamp: AnnouncementStamp,
  ): Promise<void> {
    let pending = userIds;
    for (let round = 1; pending.length; round += 1) {
      const lost = await this.mergeCounts(pending, draft, stamp);
      const done = await this.appliedUsers(lost, stamp.ref);
      pending = lost.filter((user) => !done.has(user));
      if (pending.length && round >= MERGE_ROUNDS)
        throw new Error(
          `Fan-out of ${stamp.ref}: ${pending.length} inserts keep losing`,
        );
    }
    await this.notifications.bulkWrite(
      userIds.map((user) => ({
        updateOne: {
          filter: {
            user,
            groupKey: draft.groupKey,
            unread: true,
            lastActivityAt: stamp.at,
          },
          update: { $set: textFields(draft) },
        },
      })),
      { ordered: false },
    );
  }

  /** Returns the users whose insert lost on the unique partial index (to be merged again); any other error is thrown. */
  private async mergeCounts(
    userIds: readonly string[],
    draft: NotificationDraft,
    { ref, at, now }: AnnouncementStamp,
  ): Promise<string[]> {
    try {
      await this.notifications.bulkWrite(
        userIds.map((user) => ({
          updateOne: {
            filter: {
              user,
              groupKey: draft.groupKey,
              unread: true,
              refs: { $ne: ref },
            },
            update: {
              $inc: { count: 1 },
              $max: { lastActivityAt: at, expiresAt: notificationExpiry(now) },
              $push: { refs: { $each: [ref], $slice: -REFS_KEPT } },
              $setOnInsert: {
                _id: newId(),
                ...textFields(draft),
                readAt: null,
                createdAt: at,
              },
            },
            upsert: true,
            setDefaultsOnInsert: false,
          },
        })),
        { ordered: false },
      );
      return [];
    } catch (error) {
      const failures = writeFailures(error);
      if (
        !failures.length ||
        failures.some((failure) => failure.code !== MONGO_DUPLICATE_KEY)
      )
        throw error;
      return failures.map((failure) => userIds[failure.index]);
    }
  }
}
