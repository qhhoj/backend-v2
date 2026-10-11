import { Inject, Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  invalidField,
  isDuplicateKey,
  REDIS,
  unique,
  withRedisLock,
} from '@libs/common';
import {
  ORGANIZATION_ADMIN_GROUP,
  ORGANIZATION_ADMIN_LIMIT,
  SHORT_NAME_LENGTH,
} from '@libs/community';
import type { Organization } from '@libs/database';
import type Redis from 'ioredis';
import { renderField } from '../../problems/editing/problem-markup';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import { OrganizationPointsService } from '../core/organization-points.service';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationsService } from '../core/organizations.service';
import { ORGANIZATION_ADMIN_LOCK_SECONDS } from '../core/rate-limits';
import type { OrganizationDetailResponse } from '../core/dto/organization.response';
import type {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization-edit.dto';
import { OrganizationRevisionsService } from './organization-revisions.service';

const STAFF_FIELDS = ['isUnlisted', 'slots', 'shortName'] as const;
const invalid = (field: string, message: string) =>
  new AppError('validation_failed', 400, message, { [field]: [message] });
/** Issue code of both admin-cap refusals: the actor's own (403) and another user's (400 on `adminIds`). */
const ADMIN_CAP = 'admin_cap';
const ownAdminCap = () => {
  const message = `You may administer at most ${ORGANIZATION_ADMIN_LIMIT} organizations`;
  return new AppError('forbidden', 403, message, undefined, undefined, {
    issues: [{ field: 'adminIds', code: ADMIN_CAP, message }],
  });
};
const otherAdminCap = () =>
  invalidField(
    'adminIds',
    `A user may administer at most ${ORGANIZATION_ADMIN_LIMIT} organizations.`,
    ADMIN_CAP,
  );

async function withSlugTaken<Result>(
  write: () => Promise<Result>,
): Promise<Result> {
  try {
    return await write();
  } catch (error) {
    throw isDuplicateKey(error, 'slug')
      ? invalid('slug', 'Slug is taken.')
      : error;
  }
}

@Injectable()
export class OrganizationEditingService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly organizations: OrganizationsRepository,
    private readonly members: OrganizationMembersRepository,
    private readonly users: UsersRepository,
    private readonly points: OrganizationPointsService,
    private readonly history: OrganizationRevisionsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Legacy `CreateOrganization`: `short_name = slug[:20]`, unlisted until staff lists it, the creator always an admin. */
  async create(
    principal: Principal,
    dto: CreateOrganizationDto,
  ): Promise<OrganizationDetailResponse> {
    this.checkStaffFields(principal, dto);
    const adminIds = unique([principal.userId, ...(dto.adminIds ?? [])]);
    const about = dto.about ?? '';
    const aboutHtml = renderField(about, 'user', 'about');
    const organization = await this.withAdminCap(principal, adminIds, () =>
      withSlugTaken(() =>
        this.organizations.create({
          name: dto.name,
          slug: dto.slug,
          shortName: dto.shortName ?? dto.slug.slice(0, SHORT_NAME_LENGTH),
          about,
          aboutHtml,
          adminIds,
          isOpen: dto.isOpen ?? false,
          isUnlisted: dto.isUnlisted ?? true,
          slots: dto.slots ?? null,
          logoOverrideImage: dto.logoOverrideImage ?? '',
        }),
      ),
    );
    await this.admitAdmins(adminIds, organization._id);
    await this.history.recordChange(principal, organization._id, {
      action: 'create',
      before: {},
      after: organization,
    });
    // The principal was built before the creator became a member.
    return this.organizationsService.detail(
      {
        ...principal,
        organizationIds: [...principal.organizationIds, organization._id],
      },
      organization,
    );
  }

  /** Legacy `EditOrganization`. */
  async update(
    principal: Principal,
    slug: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationDetailResponse> {
    const organization = await this.organizationsService.administered(
      principal,
      slug,
    );
    this.checkStaffFields(principal, dto);
    const { adminIds: requestedAdmins, about, ...fields } = dto;
    const changes: Partial<Organization> = { ...fields };
    if (about !== undefined)
      Object.assign(changes, {
        about,
        aboutHtml: renderField(about, 'user', 'about'),
      });
    let added: string[] = [];
    if (requestedAdmins !== undefined) {
      const adminIds = unique(requestedAdmins);
      if (!adminIds.length)
        throw invalid('adminIds', 'An organization needs at least one admin.');
      const current = OrganizationAccess.accessView(organization).adminIds;
      added = adminIds.filter((id) => !current.includes(id));
      changes.adminIds = adminIds;
    }
    const write = () =>
      withSlugTaken(() => this.organizations.update(organization._id, changes));
    if (added.length) await this.withAdminCap(principal, added, write);
    else await write();
    await this.admitAdmins(added, organization._id);
    // Only the sent fields can differ, so a concurrent edit to another field is never attributed to this one.
    await this.history.recordChange(principal, organization._id, {
      action: 'edit',
      before: organization,
      after: { ...organization.toObject(), ...changes },
    });
    return this.organizationsService.detail(principal, dto.slug ?? slug);
  }

  private checkStaffFields(
    principal: Principal,
    dto: UpdateOrganizationDto,
  ): void {
    if (
      STAFF_FIELDS.some((field) => dto[field] !== undefined) &&
      !hasPermission(principal, 'judge.edit_all_organization')
    )
      throw new AppError(
        'forbidden',
        403,
        'Only staff may change isUnlisted, slots and shortName',
      );
  }

  /** Checks the cap and writes under one lock, so parallel changes cannot give a user a fourth role. */
  private withAdminCap<Result>(
    principal: Principal,
    newAdminIds: readonly string[],
    write: () => Promise<Result>,
  ): Promise<Result> {
    return withRedisLock(
      this.redis,
      {
        key: 'organization-admins',
        ttlSeconds: ORGANIZATION_ADMIN_LOCK_SECONDS,
        busyMessage: 'Another admin change is in progress; try again',
      },
      async () => {
        await this.checkNewAdmins(principal, newAdminIds);
        return write();
      },
    );
  }

  /** New admins exist and hold fewer than three admin roles, unless the acting user has `judge.spam_organization` (legacy checked only the creator, and its permission typo made it superuser-only). */
  private async checkNewAdmins(
    principal: Principal,
    adminIds: readonly string[],
  ): Promise<void> {
    if ((await this.users.findByIds([...adminIds])).length !== adminIds.length)
      throw invalid('adminIds', 'Unknown user.');
    if (hasPermission(principal, 'judge.spam_organization')) return;
    for (const adminId of adminIds)
      if (
        (await this.organizations.countAdminRoles(adminId)) >=
        ORGANIZATION_ADMIN_LIMIT
      )
        throw adminId === principal.userId ? ownAdminCap() : otherAdminCap();
  }

  private async admitAdmins(
    adminIds: readonly string[],
    organizationId: string,
  ): Promise<void> {
    if (!adminIds.length) return;
    await this.members.addMembers(adminIds, organizationId);
    await this.members.grantGroup(adminIds, ORGANIZATION_ADMIN_GROUP);
    await this.points.refresh([organizationId]);
  }
}
