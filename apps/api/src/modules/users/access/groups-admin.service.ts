import { Inject, Injectable } from '@nestjs/common';
import { GroupsQuerier, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, conflictIssue, isDuplicateKey, REDIS } from '@libs/common';
import type Redis from 'ioredis';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { AccessRepository } from './access.repository';
import type { GroupRow } from './access.repository';
import { assertDisjoint, assertKnownAdded } from './access-rules';
import type { CreateGroupDto, UpdateGroupDto } from './dto/access.dto';
import { GroupResponse } from './dto/access.response';
import { asCurrentSuperuser } from './superuser-lock';

const nameTaken = (error: unknown) =>
  isDuplicateKey(error)
    ? conflictIssue('name', 'group_name_taken', 'Another role has this name.')
    : error;

/** Before/after of the fields that changed; empty when nothing did. Pure. */
export function groupChanges(
  before: GroupRow | null,
  after: GroupRow,
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (before?.name !== after.name)
    changes.name = { before: before?.name ?? null, after: after.name };
  const held = before?.permissions ?? [];
  if (
    held.length !== after.permissions.length ||
    held.some((code) => !after.permissions.includes(code))
  )
    changes.permissions = { before: held, after: after.permissions };
  return changes;
}

/** Roles (legacy groups): anyone with the access screens reads them; only a superuser creates or edits one. Every write reloads the in-memory groups, so members' rights change on their next request. */
@Injectable()
export class GroupsAdminService {
  constructor(
    private readonly access: AccessRepository,
    private readonly users: UsersRepository,
    private readonly querier: GroupsQuerier,
    private readonly revisions: RevisionsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list(): Promise<GroupResponse[]> {
    const [groups, counts] = await Promise.all([
      this.access.listGroups(),
      this.access.memberCounts(),
    ]);
    return groups.map((group) =>
      GroupResponse.from(group, counts.get(group.id) ?? 0),
    );
  }

  create(principal: Principal, dto: CreateGroupDto): Promise<GroupResponse> {
    const permissions = dto.permissions ?? [];
    assertKnownAdded(permissions, []);
    return asCurrentSuperuser(this.redis, this.users, principal, async () => {
      const group = await this.access
        .createGroup(dto.name, permissions)
        .catch((error: unknown) => {
          throw nameTaken(error);
        });
      await this.settle(
        principal,
        group,
        groupChanges(null, group),
        'staff_create',
      );
      return GroupResponse.from(group, 0);
    });
  }

  update(
    principal: Principal,
    id: string,
    dto: UpdateGroupDto,
  ): Promise<GroupResponse> {
    assertDisjoint('permissions', dto.addPermissions, dto.removePermissions);
    return asCurrentSuperuser(this.redis, this.users, principal, async () => {
      const [before] = await this.access.findGroups([id]);
      if (!before) throw new AppError('not_found', 404, 'No such role');
      assertKnownAdded(dto.addPermissions ?? [], before.permissions);
      const after = await this.access
        .changeGroup(id, dto.name, {
          add: dto.addPermissions,
          remove: dto.removePermissions,
        })
        .catch((error: unknown) => {
          throw nameTaken(error);
        });
      if (!after) throw new AppError('not_found', 404, 'No such role');
      await this.settle(
        principal,
        after,
        groupChanges(before, after),
        'staff_edit',
      );
      return GroupResponse.from(after, await this.access.memberCount(after.id));
    });
  }

  /** Reloads the groups this instance serves (others follow the change stream), then audits; nothing when nothing changed. */
  private async settle(
    principal: Principal,
    group: GroupRow,
    changes: Record<string, { before: unknown; after: unknown }>,
    action: string,
  ): Promise<void> {
    if (Object.keys(changes).length === 0) return;
    await this.querier.resync();
    await this.revisions.append({
      entity: 'group',
      entityId: group.id,
      action,
      userId: principal.userId,
      changes,
      comment: '',
    });
  }
}
