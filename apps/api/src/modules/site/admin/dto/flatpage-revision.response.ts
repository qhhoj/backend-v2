import { ApiProperty } from '@nestjs/swagger';
import { uuidStr } from '@libs/database';
import type { Revision } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export const FLATPAGE_REVISION_ACTIONS = ['create', 'edit', 'delete'] as const;
export type FlatpageRevisionAction = (typeof FLATPAGE_REVISION_ACTIONS)[number];

export class FlatpageRevisionResponse {
  id!: string;
  at!: Date;
  @ApiProperty({ enum: FLATPAGE_REVISION_ACTIONS })
  action!: FlatpageRevisionAction;
  /** Null when the editor's account is gone. */
  editor!: UserSummaryResponse | null;
  changes!: Record<string, { before: unknown; after: unknown }>;

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
  id!: string;
  /** The url the page had when it was deleted. */
  url!: string;
  deletedAt!: Date;

  static from(row: Revision): FlatpageDeletedResponse {
    return {
      id: uuidStr(row.entityId),
      url: String((row.changes.url?.before as string | null) ?? ''),
      deletedAt: row.createdAt,
    };
  }
}
