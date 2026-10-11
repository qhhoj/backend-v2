import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import { OrganizationSlugParamDto } from '../../organizations/core/dto/organization-params.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { CreateProblemDto } from './dto/problem-edit.dto';
import { ProblemEditingService } from './problem-editing.service';

@ApiTags('Problem editing')
@Controller('api/internal/organizations')
export class OrganizationProblemCreationController {
  constructor(
    private readonly editing: ProblemEditingService,
    private readonly rights: OrganizationCreationRights,
  ) {}

  /**
   * Create a problem for an organization
   *
   * @remarks
   * Organization administrators (or `judge.edit_all_organization` holders)
   * who hold `judge.create_organization_problem`; no `judge.add_problem`
   * needed. The problem is private to this organization: `organizations` and
   * `isOrganizationPrivate` in the body are ignored and set by the server, and
   * `isPublic` (members only) needs no extra permission. The code must start
   * with the organization prefix — the slug's lowercase letters and digits
   * followed by `_` — else 400 `organization_code_prefix` (superusers are
   * exempt). Every other rule of `POST /problems` applies: the creator becomes
   * a curator, staff fields stay gated, and the organization's quota is
   * charged. 404 for an unknown organization, 403 `forbidden` without the
   * rights.
   */
  @Post(':slug/problems')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: CreateProblemDto,
  ): Promise<ProblemDetailResponse> {
    const target = await this.rights.problemTarget(auth.principal, slug);
    return this.editing.create(auth, body, 'create', target);
  }
}
