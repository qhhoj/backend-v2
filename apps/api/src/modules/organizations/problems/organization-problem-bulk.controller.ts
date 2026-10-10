import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import { BulkProblemsDto } from './dto/bulk.dto';
import { BulkProblemsResponse } from './dto/bulk.response';
import { OrganizationProblemBulkService } from './organization-problem-bulk.service';

@ApiTags('Organizations')
@Controller('api/internal/organizations')
export class OrganizationProblemBulkController {
  constructor(private readonly bulk: OrganizationProblemBulkService) {}

  /**
   * Apply a bulk action to organization problems
   *
   * @remarks
   * Organization administrators only. Applies `archive`, `unarchive`, `add-
   * tag` or `remove-tag` (the last two need `tagId`) to up to 100 problem
   * `codes`. Codes that are not live problems of the organization are reported
   * as `skipped` with reason `not_found` rather than failing the request.
   * Limited to 20 requests per hour per user (429 `rate_limited`).
   */
  @Post(':slug/problems/bulk')
  run(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: BulkProblemsDto,
  ): Promise<BulkProblemsResponse> {
    return this.bulk.run(auth.principal, slug, body);
  }
}
