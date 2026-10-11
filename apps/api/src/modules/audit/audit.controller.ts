import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@libs/auth';
import { AuditFeedService } from './audit-feed.service';
import { AuditFeedResponse } from './dto/audit-entry.response';
import { AuditQueryDto } from './dto/audit-query.dto';

@RequirePermission('judge.change_settings')
@ApiTags('Admin: site & settings')
@Controller('api/internal/admin/audit')
export class AuditController {
  constructor(private readonly feed: AuditFeedService) {}

  /**
   * List recorded changes across the site
   *
   * @remarks
   * Requires `judge.change_settings`. The global change log: every write that already leaves a record (the `revisions` rows of problems, contests, users, organizations, posts, comments, pages, catalogs, submission locks and batch rejudges, and setting changes), newest first, 50 per page (`limit` 1-50). Each entry names the actor, the action, the object (with a label and whether it still exists) and the changed field names; values are never returned. Filters: `actor` (exact username; unknown gives an empty page), `type`, and a `from`/`to` time range. Page with `before` = the previous page's `nextBefore`. Reads are not logged.
   */
  @Get()
  list(@Query() query: AuditQueryDto): Promise<AuditFeedResponse> {
    return this.feed.list(query);
  }
}
