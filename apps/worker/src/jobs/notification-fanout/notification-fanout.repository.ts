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

/** A retried upsert loses against the row its first run wrote (unique partial index): that is the idempotent outcome, not an error. */
function onlyDuplicateKeys(error: unknown): boolean {
  const { writeErrors } = error as { writeErrors?: unknown };
  const list = Array.isArray(writeErrors)
    ? writeErrors
    : writeErrors
      ? [writeErrors]
      : [];
  return (
    list.length > 0 &&
    list.every(
      (entry) => (entry as { code?: number }).code === MONGO_DUPLICATE_KEY,
    )
  );
}

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

  /** Per user, an announcement made at `at`: merge into the unread row of the group, else insert (the filter names `unread: true`, the partial unique index). `lastActivityAt` only moves forward and the texts follow only the newest announcement, so a reordered run puts nothing older on top. Call it for users `appliedUsers` did not return. Unordered, so one lost race does not stop the chunk. */
  async upsertRows(
    userIds: readonly string[],
    draft: NotificationDraft,
    ref: string,
    at: Date,
  ): Promise<void> {
    try {
      await this.mergeCounts(userIds, draft, ref, at);
      await this.notifications.bulkWrite(
        userIds.map((user) => ({
          updateOne: {
            filter: {
              user,
              groupKey: draft.groupKey,
              unread: true,
              lastActivityAt: at,
            },
            update: { $set: textFields(draft) },
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      if (!onlyDuplicateKeys(error)) throw error;
    }
  }

  private mergeCounts(
    userIds: readonly string[],
    draft: NotificationDraft,
    ref: string,
    at: Date,
  ) {
    return this.notifications.bulkWrite(
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
            $max: { lastActivityAt: at, expiresAt: notificationExpiry(at) },
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
  }
}
