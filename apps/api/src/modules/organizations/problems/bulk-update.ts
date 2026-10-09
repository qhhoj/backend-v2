import type { UpdateQuery } from 'mongoose';
import type { OrganizationProblem } from '@libs/database';
import type { BulkAction } from './dto/bulk.dto';

/** The update for one problem's link; a link that does not exist yet is created with the other field at its default. */
export function bulkUpdate(
  action: BulkAction,
  tagId: string | undefined,
): UpdateQuery<OrganizationProblem> {
  switch (action) {
    case 'archive':
      return { $set: { archived: true }, $setOnInsert: { tagIds: [] } };
    case 'unarchive':
      return { $set: { archived: false }, $setOnInsert: { tagIds: [] } };
    case 'add-tag':
      return {
        $addToSet: { tagIds: tagId },
        $setOnInsert: { archived: false },
      };
    case 'remove-tag':
      return { $pull: { tagIds: tagId }, $setOnInsert: { archived: false } };
  }
}
