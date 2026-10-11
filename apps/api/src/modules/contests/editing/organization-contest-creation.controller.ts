import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import { OrganizationSlugParamDto } from '../../organizations/core/dto/organization-params.dto';
import { ContestDetailResponse } from '../core/dto/contest-detail.response';
import { ContestEditingService } from './contest-editing.service';
import { CreateContestDto } from './dto/contest-edit.dto';

@ApiTags('Contest editing')
@Controller('api/internal/organizations')
export class OrganizationContestCreationController {
  constructor(
    private readonly editing: ContestEditingService,
    private readonly rights: OrganizationCreationRights,
  ) {}

  /**
   * Create a contest for an organization
   *
   * @remarks
   * Organization administrators (or `judge.edit_all_organization` holders)
   * who hold `judge.create_private_contest`; no `judge.add_contest` needed.
   * The contest is private to this organization: `organizations` and
   * `isOrganizationPrivate` in the body are ignored and set by the server.
   * Every other rule of `POST /contests` applies: the creator becomes an
   * author, gated fields stay gated, and the organization's quota is charged.
   * 404 for an unknown organization, 403 `forbidden` without the rights.
   */
  @Post(':slug/contests')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: CreateContestDto,
  ): Promise<ContestDetailResponse> {
    const target = await this.rights.contestTarget(auth.principal, slug);
    return this.editing.create(auth.principal, {
      ...body,
      organizations: [target.id],
      isOrganizationPrivate: true,
    });
  }
}
