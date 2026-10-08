import { SettingRevision, uuidStr } from '@libs/database';

export class SettingRevisionResponse {
  id!: string;
  before!: unknown;
  after!: unknown;
  changedFields!: string[];
  actor!: string | null;
  createdAt!: Date;

  static from(revision: SettingRevision): SettingRevisionResponse {
    return {
      id: uuidStr(revision._id),
      before: revision.before,
      after: revision.after,
      changedFields: revision.changedFields,
      actor: revision.actor && uuidStr(revision.actor),
      createdAt: revision.createdAt,
    };
  }
}
