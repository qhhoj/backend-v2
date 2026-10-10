import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { ANY_JSON_VALUE } from '../../../settings/dto/any-json-value';
import { uuidStr } from '@libs/database';
import type { Revision } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export const FLATPAGE_REVISION_ACTIONS = ['create', 'edit', 'delete'] as const;
export type FlatpageRevisionAction = (typeof FLATPAGE_REVISION_ACTIONS)[number];

export class FieldChangeResponse {
  /** Value before the change. */
  @ApiProperty(ANY_JSON_VALUE)
  before!: unknown;
  /** Value after the change. */
  @ApiProperty(ANY_JSON_VALUE)
  after!: unknown;
}

@ApiExtraModels(FieldChangeResponse)
export class FlatpageRevisionResponse {
  /** Revision id. */
  id!: string;
  /** When the change was made. */
  at!: Date;
  /** What happened to the page. */
  @ApiProperty({ enum: FLATPAGE_REVISION_ACTIONS })
  action!: FlatpageRevisionAction;
  /** Null when the editor's account is gone. */
  editor!: UserSummaryResponse | null;
  /** Per changed field, its value before and after. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(FieldChangeResponse) },
  })
  changes!: Record<string, FieldChangeResponse>;

  static from(
    row: Revision,
    editor: UserSummaryResponse | null,
  ): FlatpageRevisionResponse {
    return {
      id: uuidStr(row._id),
      at: row.createdAt,
      action: row.action as FlatpageRevisionAction,
      editor,
      changes: row.changes,
    };
  }
}

/** A deleted page: its id keeps the history readable at `pages/:id/revisions`. */
export class FlatpageDeletedResponse {
  /** Id of the deleted page. */
  id!: string;
  /** The url the page had when it was deleted. */
  url!: string;
  /** When the page was deleted. */
  deletedAt!: Date;

  static from(row: Revision): FlatpageDeletedResponse {
    return {
      id: uuidStr(row.entityId),
      url: String((row.changes.url?.before as string | null) ?? ''),
      deletedAt: row.createdAt,
    };
  }
}
