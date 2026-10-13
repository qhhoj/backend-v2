import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Group, User } from '@libs/database';
import type { Model } from 'mongoose';

/** Codenames that were renamed: a role or user holding the old one gets the new one instead. */
export const PERMISSION_RENAMES: readonly { from: string; to: string }[] = [
  // 2026-10-13: Polygon import uses the normal creation and edit rights; only syncing keeps a permission.
  { from: 'judge.import_polygon_package', to: 'judge.sync_polygon_problem' },
];

/** One-off data migration, idempotent, so every worker boot may run it: after the first it matches nothing. The api's role cache follows through its change stream. */
@Injectable()
export class PermissionRenameService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionRenameService.name);

  constructor(
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const rename of PERMISSION_RENAMES) {
      const renamed = await this.rename(rename);
      if (renamed)
        this.logger.log(`${rename.from} → ${rename.to}: ${renamed} holders`);
    }
  }

  /** Swaps the codename in place on roles and users holding it; returns how many documents changed. */
  async rename({ from, to }: { from: string; to: string }): Promise<number> {
    const swap = [
      {
        $set: {
          permissions: {
            $setUnion: [{ $setDifference: ['$permissions', [from]] }, [to]],
          },
        },
      },
    ];
    const results = await Promise.all([
      this.groups.updateMany({ permissions: from }, swap).exec(),
      this.users.updateMany({ permissions: from }, swap).exec(),
    ]);
    return results.reduce((sum, result) => sum + result.modifiedCount, 0);
  }
}
