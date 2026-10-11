import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationRequestQueueQueryDto } from './dto/organization-request.dto';
import { OrganizationRequestResponse } from './dto/organization-request.response';
import { OrganizationRequestQueueService } from './organization-request-queue.service';

@RequirePermission('judge.edit_all_organization')
@ApiTags('Organizations')
@Controller('api/internal/admin/organization-requests')
export class OrganizationRequestQueueController {
  constructor(private readonly queue: OrganizationRequestQueueService) {}

  /**
   * List join requests across organizations
   *
   * @remarks
   * Requires `judge.edit_all_organization`. Returns the staff queue of join
   * requests over all organizations, one `state` at a time (`P` by default),
   * newest first, 50 per page. `search` keeps requests whose requester
   * username, or whose organization name, short name or slug, contains the
   * text (any case).
   */
  @ApiPaginatedResponse(OrganizationRequestResponse)
  @Get()
  list(
    @Query() query: OrganizationRequestQueueQueryDto,
  ): Promise<Paginated<OrganizationRequestResponse>> {
    return this.queue.list(query);
  }
}
