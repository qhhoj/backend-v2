import { Inject, Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
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
import { OrganizationRequestsRepository } from '../core/organization-requests.repository';
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

const conflict = (message: string) => new AppError('conflict', 409, message);
const DUPLICATE_MESSAGE =
  'You already have a pending request to join this organization';
const DECIDED_MESSAGE = 'This request has already been decided';
const PAGE_SIZE = 50;

@Injectable()
export class OrganizationRequestsService {
  private readonly logger = new Logger(OrganizationRequestsService.name);

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
      throw conflict('This organization is open; join it directly');
    if (await this.members.isMember(principal.userId, organization._id))
      throw conflict('You are already in this organization');
    if (await this.requests.pendingIdOf(organization._id, principal.userId))
      throw conflict(DUPLICATE_MESSAGE);
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
      throw conflict(DUPLICATE_MESSAGE);
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
      PAGE_SIZE,
    );
    const usernames = new Map(
      (await this.users.findByIds(items.map((row) => uuidStr(row.user)))).map(
        (user) => [uuidStr(user._id), user.username],
      ),
    );
    return new Paginated(
      items.map((row) =>
        OrganizationRequestResponse.from(
          row,
          organization.slug,
          usernames.get(uuidStr(row.user)) ?? '',
        ),
      ),
      { page, pageSize: PAGE_SIZE, total },
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
    slug: string,
    id: string,
    { state }: DecideOrganizationRequestDto,
    now = new Date(),
  ): Promise<OrganizationRequestResponse> {
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
        `organization-requests:${organization._id}`,
        APPROVAL_LOCK_SECONDS,
        'Another decision is being made; try again',
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
      throw conflict(DECIDED_MESSAGE);
    if (!(await this.members.isMember(userId, organization._id))) {
      if (
        organization.slots !== null &&
        (await this.members.countMembers(organization._id)) >=
          organization.slots
      )
        throw conflict('The organization is full');
      await this.members.addMembers([userId], organization._id);
    }
    await this.finish(id, 'A', principal.userId, now);
    try {
      await this.points.refresh([organization._id]);
    } catch (error) {
      this.logger.error(
        `Points refresh of ${organization._id} failed: ${(error as Error).message}`,
      );
    }
  }

  private async finish(
    id: string,
    state: 'A' | 'R',
    decidedBy: string,
    decidedAt: Date,
  ): Promise<void> {
    if (!(await this.requests.decide(id, state, decidedBy, decidedAt)))
      throw conflict(DECIDED_MESSAGE);
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
