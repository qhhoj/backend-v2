import { Inject, Injectable } from '@nestjs/common';
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
const PAGE_SIZE = 50;

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
      throw conflict('This organization is open; join it directly');
    if (await this.members.isMember(principal.userId, organization._id))
      throw conflict('You are already in this organization');
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
      throw conflict(
        'You already have a pending request to join this organization',
      );
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

  /** Legacy approval formset, one request at a time: approvals check membership and `slots` against the live count under the organization's lock. */
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
    return withRedisLock(
      this.redis,
      `organization-requests:${organization._id}`,
      APPROVAL_LOCK_SECONDS,
      'Another decision is being made; try again',
      async () => {
        const userId = uuidStr(request.user);
        if (state === 'A') {
          if (await this.members.isMember(userId, organization._id))
            throw conflict('That user is already a member');
          if (
            organization.slots !== null &&
            (await this.members.countMembers(organization._id)) >=
              organization.slots
          )
            throw conflict('The organization is full');
          // Pending check before membership: a decided request never adds a member.
          if ((await this.requests.findById(id))?.state !== 'P')
            throw conflict('This request has already been decided');
          await this.members.addMembers([userId], organization._id);
        }
        if (!(await this.requests.decide(id, state, principal.userId, now)))
          throw conflict('This request has already been decided');
        if (state === 'A') await this.points.refresh([organization._id]);
        return this.respond(
          (await this.requests.findById(id))!,
          organization.slug,
        );
      },
    );
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
