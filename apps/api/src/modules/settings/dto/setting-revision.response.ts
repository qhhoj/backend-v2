import { ApiProperty } from '@nestjs/swagger';
import { ANY_JSON_VALUE } from './any-json-value';
import { SettingRevision, uuidStr } from '@libs/database';

export class SettingRevisionResponse {
  /** Revision id. */
  id!: string;
  /** Value before the change, with secret parts removed. */
  @ApiProperty(ANY_JSON_VALUE)
  before!: unknown;
  /** Value after the change, with secret parts removed. */
  @ApiProperty(ANY_JSON_VALUE)
  after!: unknown;
  /** Names of the fields that changed. */
  changedFields!: string[];
  /** Id of the user who made the change; null if unknown. */
  actor!: string | null;
  /** When the change was made. */
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
