import { Controller, Get, UseFilters } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { ApiV2ExceptionFilter } from '../core/api-v2-exception.filter';
import { ApiV2Query, lenientQueryPipe } from '../core/api-v2-query';
import { legacyEnvelope } from '../core/legacy-envelope';
import { ApiV2OrganizationsService } from './api-v2-organizations.service';
import { ApiV2OrganizationListDto } from './dto/api-v2-organization-list.dto';

@Public()
@RawResponse()
@UseFilters(ApiV2ExceptionFilter)
@Controller('api/v2')
export class ApiV2OrganizationsController {
  constructor(private readonly organizations: ApiV2OrganizationsService) {}

  @Get('organizations')
  async list(
    @ApiV2Query(lenientQueryPipe) query: ApiV2OrganizationListDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope(
      'get',
      await this.organizations.list(optionalPrincipal(auth), query),
    );
  }
}
