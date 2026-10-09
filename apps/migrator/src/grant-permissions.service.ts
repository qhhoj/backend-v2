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

  /** Idempotent: `$addToSet` leaves a group that already has the codename unmodified, so a rerun changes nothing and never duplicates. Returns the groups changed per codename. */
  async grant(): Promise<Record<string, number>> {
    const changed: Record<string, number> = {};
    for (const { permission, heldBy } of this.grants) {
      const { modifiedCount } = await this.connection
        .collection('groups')
        .updateMany(
          { permissions: heldBy },
          { $addToSet: { permissions: permission } },
        );
      changed[permission] = modifiedCount;
    }
    return changed;
  }
}
