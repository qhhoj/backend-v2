import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { AuditFeedService } from './audit-feed.service';
import { AuditEntryResponse, AuditFeedQueryDto } from './dto/audit-feed.dto';

@RequirePermission('judge.change_settings')
@ApiTags('Admin: site & settings')
@Controller('api/internal/admin/audit')
export class AuditFeedController {
  constructor(private readonly feed: AuditFeedService) {}

  /**
   * List recent changes across the site
   *
   * @remarks
   * Requires `judge.change_settings`. Every recorded change (problems,
   * contests, posts, pages, users, comments, config, ...), newest first, 50
   * per page: what changed, its name where known, who did it, and the names
   * of the changed fields (never their values). Filter by `entity` kind and by
   * `actor` username (an unknown name matches nothing).
   */
  @ApiPaginatedResponse(AuditEntryResponse)
  @Get()
  list(
    @Query() query: AuditFeedQueryDto,
  ): Promise<Paginated<AuditEntryResponse>> {
    return this.feed.list(query);
  }
}
