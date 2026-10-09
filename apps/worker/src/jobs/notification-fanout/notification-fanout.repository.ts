import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Contest,
  ContestAnnouncement,
  ContestParticipation,
  isUuid,
  newId,
  Notification,
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

  /** Per user: merge into the unread row of the group unless it already took this announcement (`lastRef`), else insert. The filter names `unread: true` (the partial unique index). Unordered, so one lost race does not stop the chunk. */
  async upsertRows(
    userIds: readonly string[],
    draft: NotificationDraft,
    ref: string,
    now: Date,
  ): Promise<void> {
    try {
      await this.notifications.bulkWrite(
        userIds.map((user) => ({
          updateOne: {
            filter: {
              user,
              groupKey: draft.groupKey,
              unread: true,
              lastRef: { $ne: ref },
            },
            update: {
              $inc: { count: 1 },
              $set: {
                kind: draft.kind,
                title: draft.title,
                body: draft.body,
                path: draft.path,
                priority: draft.priority,
                lastActivityAt: now,
                expiresAt: notificationExpiry(now),
                lastRef: ref,
              },
              $setOnInsert: { _id: newId(), readAt: null, createdAt: now },
            },
            upsert: true,
            setDefaultsOnInsert: false,
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      if (!onlyDuplicateKeys(error)) throw error;
    }
  }
}
