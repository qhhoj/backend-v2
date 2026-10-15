import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Revision, Submission, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';

/** Score overrides of internal-error rows: the revisions whose submission may still carry the IE message. */
export const IE_OVERRIDE_FILTER = {
  entity: 'submission',
  action: 'override_score',
  'changes.result.before': 'IE',
} as const;

export interface IeOverrideCleanupCounts {
  /** Revisions overriding an internal error. */
  found: number;
  /** Submissions whose message moved into the revision this run. */
  cleared: number;
  /** Found but left alone: already clean, still IE, a compile error, or graded again since the override. */
  skipped: number;
}

type OverrideRevision = Pick<
  Revision,
  '_id' | 'entityId' | 'changes' | 'createdAt'
>;
type OverriddenRow = Pick<
  Submission,
  '_id' | 'status' | 'result' | 'error' | 'judgedDate'
>;

/** The row still shows the overridden internal error's message: not IE now, not a compile log, and not graded again after the override (a regrade replaced `error`). */
const keepsInternalError = (
  row: OverriddenRow,
  revision: OverrideRevision,
): boolean =>
  row.error !== null &&
  ![row.status, row.result].some(
    (verdict) => verdict === 'IE' || verdict === 'CE',
  ) &&
  (row.judgedDate === null || row.judgedDate <= revision.createdAt);

/** The revision has no copy of the message yet, or holds this exact text. */
const revisionAccepts = (revision: OverrideRevision, text: string): boolean => {
  const copied = revision.changes.error;
  return copied === undefined || copied.before === text;
};

/**
 * One-off data cleanup, idempotent, so every worker boot may run it. Before 2.29.2 a score override of an IE row kept the
 * internal-error message (it can quote jury data) on the row, which then read as graded and showed it to everyone; since
 * 2.29.2 the override moves it into its revision. This moves the message of older overrides the same way.
 */
@Injectable()
export class IeOverrideCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IeOverrideCleanupService.name);

  constructor(
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { found, cleared, skipped } = await this.run();
    this.logger.log(
      `IE override messages: found ${found}, cleared ${cleared}, skipped ${skipped}`,
    );
  }

  /** Moves each still-shown message into its override revision; counts only, the text is never logged. */
  async run(): Promise<IeOverrideCleanupCounts> {
    const revisions = await this.revisions
      .find(IE_OVERRIDE_FILTER, { entityId: 1, changes: 1, createdAt: 1 })
      .lean<OverrideRevision[]>()
      .exec();
    const rows = await this.rowsById(
      revisions.map((revision) => uuidStr(revision.entityId)),
    );
    let cleared = 0;
    for (const revision of revisions) {
      const row = rows.get(uuidStr(revision.entityId));
      if (row && (await this.moveMessage(revision, row))) cleared++;
    }
    return {
      found: revisions.length,
      cleared,
      skipped: revisions.length - cleared,
    };
  }

  private async rowsById(ids: string[]): Promise<Map<string, OverriddenRow>> {
    const rows = await this.submissions
      .find(
        { _id: { $in: ids } },
        { status: 1, result: 1, error: 1, judgedDate: 1 },
      )
      .lean<OverriddenRow[]>()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row]));
  }

  /** Copies the message into the revision first, then clears it on the row only while it still holds that text: a crash in between leaves both copies, and the next run clears. */
  private async moveMessage(
    revision: OverrideRevision,
    row: OverriddenRow,
  ): Promise<boolean> {
    const text = row.error;
    if (
      text === null ||
      !keepsInternalError(row, revision) ||
      !revisionAccepts(revision, text)
    )
      return false;
    await this.revisions
      .updateOne(
        { _id: revision._id, 'changes.error': { $exists: false } },
        { $set: { 'changes.error': { before: text, after: null } } },
      )
      .exec();
    const { modifiedCount } = await this.submissions
      .updateOne({ _id: row._id, error: text }, { $set: { error: null } })
      .exec();
    return modifiedCount === 1;
  }
}
