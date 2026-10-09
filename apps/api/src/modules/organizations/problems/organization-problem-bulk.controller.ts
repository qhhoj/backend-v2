import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { OrganizationSlugParamDto } from '../core/dto/organization-params.dto';
import { BulkProblemsDto } from './dto/bulk.dto';
import { BulkProblemsResponse } from './dto/bulk.response';
import { OrganizationProblemBulkService } from './organization-problem-bulk.service';

@Controller('api/internal/organizations')
export class OrganizationProblemBulkController {
  constructor(private readonly bulk: OrganizationProblemBulkService) {}

  @Post(':slug/problems/bulk')
  run(
    @CurrentAuth() auth: AuthContext,
    @Param() { slug }: OrganizationSlugParamDto,
    @Body() body: BulkProblemsDto,
  ): Promise<BulkProblemsResponse> {
    return this.bulk.run(auth.principal, slug, body);
  }
}
