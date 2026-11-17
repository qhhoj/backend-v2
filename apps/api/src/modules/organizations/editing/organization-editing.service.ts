import { Inject, Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  invalidField,
  isDuplicateKey,
  RateLimitService,
  REDIS,
  unique,
  withRedisLock,
  issueError,
} from '@libs/common';
import { ORGANIZATION_ADMIN_LIMIT, SHORT_NAME_LENGTH } from '@libs/community';
import type { Organization } from '@libs/database';
import { SettingsService } from '@libs/settings';
import type Redis from 'ioredis';
import { renderField } from '../../problems/editing/problem-markup';
import { withMemberSlotsLock } from '../core/member-slots-lock';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import { OrganizationPointsService } from '../core/organization-points.service';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationsService } from '../core/organizations.service';
import {
  ORGANIZATION_ABOUT_LIMIT,
  ORGANIZATION_ABOUT_WINDOW_SECONDS,
  ORGANIZATION_ADMIN_LOCK_SECONDS,
} from '../core/rate-limits';
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
  return issueError('forbidden', 403, {
    field: 'adminIds',
    code: ADMIN_CAP,
    message,
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
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly rateLimits: RateLimitService,
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
    const organization = await this.withAdminCap(
      principal,
      adminIds,
      null,
      () =>
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
    await this.grantAdminRole(
      hasPermission(principal, 'judge.edit_all_organization')
        ? adminIds
        : [principal.userId],
    );
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
    let added: string[] = [];
    let removed: string[] = [];
    if (requestedAdmins !== undefined) {
      const adminIds = unique(requestedAdmins);
      if (!adminIds.length)
        throw invalid('adminIds', 'An organization needs at least one admin.');
      const current = OrganizationAccess.accessView(organization).adminIds;
      added = adminIds.filter((id) => !current.includes(id));
      removed = current.filter((id) => !adminIds.includes(id));
      changes.adminIds = adminIds;
    }
    Object.assign(
      changes,
      await this.aboutChange(principal, organization.about, about),
    );
    const write = () =>
      withSlugTaken(() => this.organizations.update(organization._id, changes));
    if (added.length)
      await this.withAdminCap(principal, added, organization._id, () =>
        this.writeWithinSlots(organization._id, changes, added, write),
      );
    else await write();
    await this.dropAdminRole(removed);
    // Only the sent fields can differ, so a concurrent edit to another field is never attributed to this one.
    await this.history.recordChange(principal, organization._id, {
      action: 'edit',
      before: organization,
      after: { ...organization.toObject(), ...changes },
    });
    return this.organizationsService.detail(principal, dto.slug ?? slug);
  }

  /** `about` with its rendered HTML when it differs from the stored text, rate limited per user before the render; a body the renderer refuses spends its hit too. */
  private async aboutChange(
    principal: Principal,
    storedAbout: string,
    about: string | undefined,
  ): Promise<Partial<Organization>> {
    if (about === undefined || about === storedAbout) return {};
    await this.rateLimits.reserve(
      [`organization-about:${principal.userId}`],
      ORGANIZATION_ABOUT_LIMIT,
      ORGANIZATION_ABOUT_WINDOW_SECONDS,
    );
    return { about, aboutHtml: renderField(about, 'user', 'about') };
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
    organizationId: string | null,
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
        await this.checkNewAdmins(principal, newAdminIds, organizationId);
        return write();
      },
    );
  }

  /** New admins exist, and are members of the organization already unless the acting user has `judge.edit_all_organization` (an admin is named by consent: the user joins first). They also hold fewer than three admin roles, unless the acting user has `judge.spam_organization` (legacy checked only the creator, and its permission typo made it superuser-only). */
  private async checkNewAdmins(
    principal: Principal,
    adminIds: readonly string[],
    organizationId: string | null,
  ): Promise<void> {
    if ((await this.users.findByIds([...adminIds])).length !== adminIds.length)
      throw invalid('adminIds', 'Unknown user.');
    await this.checkMembership(principal, adminIds, organizationId);
    if (hasPermission(principal, 'judge.spam_organization')) return;
    for (const adminId of adminIds)
      if (
        (await this.organizations.countAdminRoles(adminId)) >=
        ORGANIZATION_ADMIN_LIMIT
      )
        throw adminId === principal.userId ? ownAdminCap() : otherAdminCap();
  }

  private async checkMembership(
    principal: Principal,
    adminIds: readonly string[],
    organizationId: string | null,
  ): Promise<void> {
    if (hasPermission(principal, 'judge.edit_all_organization')) return;
    for (const adminId of adminIds) {
      const isCreator = organizationId === null && adminId === principal.userId;
      if (
        !isCreator &&
        !(
          organizationId &&
          (await this.members.isMember(adminId, organizationId))
        )
      )
        throw issueError('not_a_member', 422, {
          field: 'adminIds',
          code: 'not_a_member',
          message: 'A new admin must already be a member of the organization.',
        });
    }
  }

  /** New admins become members, so the ones from outside take slots: checked, written and admitted under the organization's member lock, like a join (`withMemberSlotsLock`). `slots` is re-read, or taken from this same edit. */
  private writeWithinSlots(
    organizationId: string,
    changes: Partial<Organization>,
    newAdminIds: readonly string[],
    write: () => Promise<void>,
  ): Promise<void> {
    return withMemberSlotsLock(this.redis, organizationId, async () => {
      const slots = await this.slotsAfter(organizationId, changes);
      if (await this.members.lacksSlotsFor(newAdminIds, organizationId, slots))
        throw conflictIssue(
          'organization',
          'organization_full',
          'The organization is full',
        );
      await write();
      await this.admitAdmins(newAdminIds, organizationId);
    });
  }

  private async slotsAfter(
    organizationId: string,
    changes: Partial<Organization>,
  ): Promise<number | null> {
    if (changes.slots !== undefined) return changes.slots;
    const [current] = await this.organizations.findByIds([organizationId]);
    return current?.slots ?? null;
  }

  private async admitAdmins(
    adminIds: readonly string[],
    organizationId: string,
  ): Promise<void> {
    if (!adminIds.length) return;
    await this.members.addMembers(adminIds, organizationId);
    await this.points.refresh([organizationId]);
  }

  /** The creators of an organization get the admin role (skipped when it does not exist). */
  private async grantAdminRole(adminIds: readonly string[]): Promise<void> {
    const roleId = await this.adminRoleId();
    if (roleId) await this.members.grantGroup(adminIds, roleId);
  }

  /** A demoted admin loses the admin role unless they still administer another organization. */
  private async dropAdminRole(demotedIds: readonly string[]): Promise<void> {
    const roleId = await this.adminRoleId();
    if (!roleId) return;
    const idle: string[] = [];
    for (const id of demotedIds)
      if ((await this.organizations.countAdminRoles(id)) === 0) idle.push(id);
    await this.members.revokeGroup(idle, roleId);
  }

  private adminRoleId(): Promise<string | null> {
    return this.members.findAdminRoleId(
      this.settings.get('organization.adminRoleId'),
    );
  }
}
