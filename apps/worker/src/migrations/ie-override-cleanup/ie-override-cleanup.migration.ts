import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Revision, Submission, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';
import type { Migration } from '../migration';

/** Score overrides as the api's override wrote them before 2.29.2 (a migration matches what was written then, so this stays even if the writer changes); the revisions of internal-error rows: whose submission may still carry the IE message. */
const IE_OVERRIDE_FILTER = {
  entity: 'submission',
  action: 'override_score',
  'changes.result.before': 'IE',
} as const;

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
 * Before 2.29.2 a score override of an IE row kept the internal-error message (it can quote jury data) on the row, which
 * then read as graded and showed it to everyone; since 2.29.2 the override moves it into its revision. This moves the
 * message of older overrides the same way (decisions.md: IE override cleanup).
 */
@Injectable()
export class IeOverrideCleanupMigration implements Migration {
  readonly id = '2026-10-15-ie-override-cleanup';

  constructor(
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** Moves each still-shown message into its override revision; returns the rows cleared (the text is never logged). */
  async run(): Promise<number> {
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
    return cleared;
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
