import { uuidStr } from '@libs/database';
import type { Revision } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export type FlatpageRevisionAction = 'create' | 'edit' | 'delete';

export class FlatpageRevisionResponse {
  id!: string;
  at!: Date;
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
