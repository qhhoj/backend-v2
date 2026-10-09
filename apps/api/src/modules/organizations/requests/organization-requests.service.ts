import { Inject, Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  isDuplicateKey,
  Paginated,
  RateLimitService,
  REDIS,
  withRedisLock,
} from '@libs/common';
import { uuidStr } from '@libs/database';
import type { OrganizationRequest } from '@libs/database';
import type Redis from 'ioredis';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import { OrganizationPointsService } from '../core/organization-points.service';
import {
  OrganizationRequestsRepository,
  ORGANIZATION_REQUEST_PAGE_SIZE,
} from '../core/organization-requests.repository';
import { OrganizationsService } from '../core/organizations.service';
import {
  APPROVAL_LOCK_SECONDS,
  JOIN_REQUEST_LIMIT,
  JOIN_REQUEST_WINDOW_SECONDS,
} from '../core/rate-limits';
import {
  CreateOrganizationRequestDto,
  DecideOrganizationRequestDto,
  OrganizationRequestListQueryDto,
} from './dto/organization-request.dto';
import { OrganizationRequestResponse } from './dto/organization-request.response';
import { usernamesById } from './request-usernames';

/** A 409 with a stable issue code (documented in docs/decisions.md). */
const conflict = (message: string, field: string, code: string) =>
  conflictIssue(field, code, message);
const duplicateRequest = () =>
  conflict(
    'You already have a pending request to join this organization',
    'request',
    'request_pending',
  );
const alreadyDecided = () =>
  conflict(
    'This request has already been decided',
    'state',
    'request_already_decided',
  );

@Injectable()
export class OrganizationRequestsService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly requests: OrganizationRequestsRepository,
    private readonly members: OrganizationMembersRepository,
    private readonly users: UsersRepository,
    private readonly points: OrganizationPointsService,
    private readonly rateLimits: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Legacy `RequestJoinOrganization`. */
  async create(
    principal: Principal,
    slug: string,
    { reason }: CreateOrganizationRequestDto,
  ): Promise<OrganizationRequestResponse> {
    const organization = await this.organizationsService.bySlug(slug);
    if (organization.isOpen)
      throw conflict(
        'This organization is open; join it directly',
        'organization',
        'organization_open',
      );
    if (await this.members.isMember(principal.userId, organization._id))
      throw conflict(
        'You are already in this organization',
        'user',
        'already_member',
      );
    if (await this.requests.pendingIdOf(organization._id, principal.userId))
      throw duplicateRequest();
    const release = await this.rateLimits.reserve(
      [`organization-request:user:${principal.userId}`],
      JOIN_REQUEST_LIMIT,
      JOIN_REQUEST_WINDOW_SECONDS,
    );
    try {
      const request = await this.requests.create(
        organization._id,
        principal.userId,
        reason,
      );
      return OrganizationRequestResponse.from(
        request,
        organization.slug,
        principal.username,
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      await release();
      throw duplicateRequest();
    }
  }

  /** Legacy `OrganizationRequestView`/`OrganizationRequestLog`: administrators, one state at a time. */
  async list(
    principal: Principal,
    slug: string,
    { state, page }: OrganizationRequestListQueryDto,
  ): Promise<Paginated<OrganizationRequestResponse>> {
    const organization = await this.organizationsService.administered(
      principal,
      slug,
    );
    const { items, total } = await this.requests.list(
      organization._id,
      state,
      page,
      ORGANIZATION_REQUEST_PAGE_SIZE,
    );
    const usernames = await usernamesById(
      this.users,
      items.map((row) => uuidStr(row.user)),
    );
    return new Paginated(
      items.map((row) =>
        OrganizationRequestResponse.from(
          row,
          organization.slug,
          usernames.get(uuidStr(row.user)) ?? '',
        ),
      ),
      { page, pageSize: ORGANIZATION_REQUEST_PAGE_SIZE, total },
    );
  }

  /** Legacy `OrganizationRequestDetail`: the requester or an administrator. */
  async detail(
    principal: Principal,
    slug: string,
    id: string,
  ): Promise<OrganizationRequestResponse> {
    const { organization, request } = await this.requestOf(slug, id);
    if (
      uuidStr(request.user) !== principal.userId &&
      !OrganizationAccess.canAdminister(
        principal,
        OrganizationAccess.accessView(organization),
      )
    )
      throw new AppError('forbidden', 403, 'Not your request');
    return this.respond(request, organization.slug);
  }

  /** Legacy approval formset, one request at a time. A rejection is a compare-and-set; an approval runs under the organization's lock. */
  async decide(
    principal: Principal,
    target: { slug: string; requestId: string },
    { state }: DecideOrganizationRequestDto,
    now = new Date(),
  ): Promise<OrganizationRequestResponse> {
    const { slug, requestId: id } = target;
    const organization = await this.organizationsService.administered(
      principal,
      slug,
    );
    const { request } = await this.requestOf(slug, id);
    if (state === 'R') {
      await this.finish(id, 'R', principal.userId, now);
    } else {
      await withRedisLock(
        this.redis,
        {
          key: `organization-requests:${organization._id}`,
          ttlSeconds: APPROVAL_LOCK_SECONDS,
          busyMessage: 'Another decision is being made; try again',
        },
        () => this.approve(principal, slug, request, now),
      );
    }
    return this.respond((await this.requests.findById(id))!, organization.slug);
  }

  /** Checks membership and `slots` (re-read, so a concurrent edit counts) against the live count. A member whose request is still pending is a retry of a half-done approval: only the decision is recorded. */
  private async approve(
    principal: Principal,
    slug: string,
    request: OrganizationRequest,
    now: Date,
  ): Promise<void> {
    const id = uuidStr(request._id);
    const userId = uuidStr(request.user);
    const organization = await this.organizationsService.bySlug(slug);
    // A decided request never adds a member.
    if ((await this.requests.findById(id))?.state !== 'P')
      throw alreadyDecided();
    if (!(await this.members.isMember(userId, organization._id))) {
      if (
        organization.slots !== null &&
        (await this.members.countMembers(organization._id)) >=
          organization.slots
      )
        throw conflict(
          'The organization is full',
          'organization',
          'organization_full',
        );
      await this.members.addMembers([userId], organization._id);
    }
    await this.finish(id, 'A', principal.userId, now);
    await this.points.refresh([organization._id]);
  }

  private async finish(
    id: string,
    state: 'A' | 'R',
    decidedBy: string,
    decidedAt: Date,
  ): Promise<void> {
    if (!(await this.requests.decide(id, state, decidedBy, decidedAt)))
      throw alreadyDecided();
  }

  private async requestOf(slug: string, id: string) {
    const organization = await this.organizationsService.bySlug(slug);
    const request = await this.requests.findById(id);
    if (!request || uuidStr(request.organization) !== organization._id)
      throw new AppError('not_found', 404, 'No such request');
    return { organization, request };
  }

  private async respond(
    request: OrganizationRequest,
    slug: string,
  ): Promise<OrganizationRequestResponse> {
    const user = await this.users.findById(uuidStr(request.user));
    return OrganizationRequestResponse.from(
      request,
      slug,
      user?.username ?? '',
    );
  }
}
