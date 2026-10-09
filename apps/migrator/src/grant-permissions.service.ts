import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { PERMISSION_GRANTS } from './permission-grants';
import type { PermissionGrant } from './permission-grants';

export const PERMISSION_GRANTS_TOKEN = Symbol('PERMISSION_GRANTS');

@Injectable()
export class GrantPermissionsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(PERMISSION_GRANTS_TOKEN)
    private readonly grants: readonly PermissionGrant[] = PERMISSION_GRANTS,
  ) {}

  /** Idempotent: `$addToSet` leaves a holder that already has the codename unmodified, so a rerun changes nothing and never duplicates. Anchors are held by groups and, in migrated data, directly by users (`auth_user_user_permissions`); both get the codename. Returns the groups and users changed per codename. */
  async grant(): Promise<Record<string, number>> {
    const changed: Record<string, number> = {};
    for (const { permission, heldBy } of this.grants) {
      let count = 0;
      for (const holders of ['groups', 'users']) {
        const { modifiedCount } = await this.connection
          .collection(holders)
          .updateMany(
            { permissions: heldBy },
            { $addToSet: { permissions: permission } },
          );
        count += modifiedCount;
      }
      changed[permission] = count;
    }
    return changed;
  }
}
