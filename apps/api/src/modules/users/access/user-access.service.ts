import { Inject, Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import { AppError, REDIS, ValidationFailedError } from '@libs/common';
import { uuidStr } from '@libs/database';
import type Redis from 'ioredis';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { editableTarget } from '../editing/editable-target';
import { AccessRepository } from './access.repository';
import type { GroupRow } from './access.repository';
import {
  assertDisjoint,
  assertKnownAdded,
  effectivePermissions,
} from './access-rules';
import type { ChangeUserAccessDto } from './dto/access.dto';
import { UserAccessResponse } from './dto/access.response';
import { asCurrentSuperuser } from './superuser-lock';

type AccessFields = Pick<
  UserDocument,
  '_id' | 'groups' | 'permissions' | 'isStaff' | 'isSuperuser'
>;
const accessOf = (user: AccessFields) => ({
  groups: user.groups.map(uuidStr),
  permissions: [...user.permissions],
  isStaff: user.isStaff,
  isSuperuser: user.isSuperuser,
});

/** A user's groups, direct permissions and staff/superuser flags. The principal is rebuilt from the user row on every request, so a change applies to the user's next request without a new sign-in. */
@Injectable()
export class UserAccessService {
  constructor(
    private readonly users: UsersRepository,
    private readonly access: AccessRepository,
    private readonly revisions: RevisionsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async get(
    principal: Principal,
    username: string,
  ): Promise<UserAccessResponse> {
    const user = await editableTarget(this.users, principal, username);
    const groups = await this.access.findGroups(user.groups.map(uuidStr));
    return this.responseOf(principal, user, groups);
  }

  change(
    principal: Principal,
    username: string,
    dto: ChangeUserAccessDto,
  ): Promise<UserAccessResponse> {
    assertDisjoint('groups', dto.addGroups, dto.removeGroups);
    assertDisjoint('permissions', dto.addPermissions, dto.removePermissions);
    return asCurrentSuperuser(this.redis, this.users, principal, async () => {
      const before = await editableTarget(this.users, principal, username, {
        notSelf: true,
      });
      assertKnownAdded(dto.addPermissions ?? [], before.permissions);
      await this.assertGroupsExist(dto.addGroups ?? []);
      await this.access.changeUser(
        before._id,
        {
          groups: { add: dto.addGroups, remove: dto.removeGroups },
          permissions: {
            add: dto.addPermissions,
            remove: dto.removePermissions,
          },
        },
        { isStaff: dto.isStaff, isSuperuser: dto.isSuperuser },
      );
      const after = await this.users.findById(before._id);
      if (!after) throw new AppError('not_found', 404, 'No such user');
      await this.audit(principal, before, after);
      const groups = await this.access.findGroups(after.groups.map(uuidStr));
      return this.responseOf(principal, after, groups);
    });
  }

  private async assertGroupsExist(ids: string[]): Promise<void> {
    if ((await this.access.findGroups(ids)).length !== ids.length)
      throw new ValidationFailedError('Unknown role', [
        {
          field: 'groups',
          code: 'group_unknown',
          message: 'Choose existing roles.',
        },
      ]);
  }

  /** Before/after of the access fields, or nothing when the request changed nothing. */
  private async audit(
    principal: Principal,
    before: AccessFields,
    after: AccessFields,
  ): Promise<void> {
    const [was, now] = [accessOf(before), accessOf(after)];
    const changes = Object.fromEntries(
      (Object.keys(was) as (keyof typeof was)[])
        .filter((key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]))
        .map((key) => [key, { before: was[key], after: now[key] }]),
    );
    if (Object.keys(changes).length === 0) return;
    await this.revisions.append({
      entity: 'user',
      entityId: uuidStr(after._id),
      action: 'staff_set_access',
      userId: principal.userId,
      changes,
      comment: '',
    });
  }

  private responseOf(
    principal: Principal,
    user: AccessFields,
    groups: GroupRow[],
  ): UserAccessResponse {
    return {
      isStaff: user.isStaff,
      isSuperuser: user.isSuperuser,
      groups: groups.map(({ id, name }) => ({ id, name })),
      permissions: [...user.permissions].sort(),
      effective: effectivePermissions(user.permissions, groups),
      canEdit: principal.isSuperuser && user._id !== principal.userId,
    };
  }
}
