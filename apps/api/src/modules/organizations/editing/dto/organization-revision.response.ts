import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { uuidStr } from '@libs/database';
import type { Revision } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { FieldChangeResponse } from '../../../site/admin/dto/flatpage-revision.response';

export const ORGANIZATION_REVISION_ACTIONS = [
  'create',
  'edit',
  'kick',
] as const;
export type OrganizationRevisionAction =
  (typeof ORGANIZATION_REVISION_ACTIONS)[number];

@ApiExtraModels(FieldChangeResponse)
export class OrganizationRevisionResponse {
  /** Revision id. */
  id!: string;
  /** When the change was made. */
  at!: Date;
  /** `create`, `edit`, or `kick` (a member removed; `changes.member.before` is their username). */
  @ApiProperty({
    enum: ORGANIZATION_REVISION_ACTIONS,
    enumName: 'OrganizationRevisionAction',
  })
  action!: OrganizationRevisionAction;
  /** Who made the change; null when that account is gone. */
  editor!: UserSummaryResponse | null;
  /** Per changed field, its value before and after; admins appear as `admins`, a sorted list of usernames. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(FieldChangeResponse) },
  })
  changes!: Record<string, FieldChangeResponse>;

  static from(
    row: Revision,
    editor: UserSummaryResponse | null,
  ): OrganizationRevisionResponse {
    return {
      id: uuidStr(row._id),
      at: row.createdAt,
      action: row.action as OrganizationRevisionAction,
      editor,
      changes: row.changes,
    };
  }
}
