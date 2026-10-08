import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { OrganizationRequestListQueryDto } from './dto/organization-request.dto';
import { OrganizationRequestResponse } from './dto/organization-request.response';
import { OrganizationRequestQueueService } from './organization-request-queue.service';

@RequirePermission('judge.edit_all_organization')
@Controller('api/internal/admin/organization-requests')
export class OrganizationRequestQueueController {
  constructor(private readonly queue: OrganizationRequestQueueService) {}

  @ApiPaginatedResponse(OrganizationRequestResponse)
  @Get()
  list(
    @Query() query: OrganizationRequestListQueryDto,
  ): Promise<Paginated<OrganizationRequestResponse>> {
    return this.queue.list(query);
  }
}
