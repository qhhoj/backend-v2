import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Query,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import { MANAGE_SHARE } from '../core/share-access.service';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ShareCodeParamDto } from '../core/dto/share-params.dto';
import {
  ReportShareDto,
  SettleShareReportsDto,
  ShareReportQueueQueryDto,
  ShareReportResponse,
} from './dto/share-report.dto';
import { ShareReportsService } from './share-reports.service';

@ApiTags('Shares')
@Controller('api/internal/shares')
export class ShareReportsController {
  constructor(private readonly reports: ShareReportsService) {}

  /**
   * Report a share
   *
   * @remarks
   * Signed-in callers who can read the link (its read errors apply). Flags it for staff with a `reason` (`spam`, `abuse`, `contest`: leaks a running contest's solution, `other`) and an optional `note` (up to 500 characters). Each user reports a share once (409 `conflict`); reporting one's own is 403 `forbidden`. Counts against the read limit before the code is looked up, so unknown codes cost as much as known ones; then 10 reports per hour per user (429 `rate_limited`). Returns 204.
   */
  @Post(':code/reports')
  @HttpCode(204)
  report(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ShareCodeParamDto,
    @Body() body: ReportShareDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.reports.report(auth.principal, { code, ip: request.ip }, body);
  }

  /**
   * List share reports
   *
   * @remarks
   * Requires `judge.manage_share`. 20 per page, newest first: `status=open` (the default) or `settled`. Each carries its share's code, and the share while it still exists (`share` is null once it expired or was deleted).
   */
  @RequirePermission(MANAGE_SHARE)
  @ApiPaginatedResponse(ShareReportResponse)
  @Get('reports')
  queue(
    @Query() { page, status }: ShareReportQueueQueryDto,
  ): Promise<Paginated<ShareReportResponse>> {
    return this.reports.queue(page, status);
  }

  /**
   * Settle the reports of a share
   *
   * @remarks
   * Requires `judge.manage_share`. Marks every open report of the code `resolved` or `dismissed`, also once its share expired or was deleted; taking it down is a separate call. 404 `not_found` when the code has no open reports. Returns 204.
   */
  @RequirePermission(MANAGE_SHARE)
  @Post(':code/reports/settle')
  @HttpCode(204)
  settle(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ShareCodeParamDto,
    @Body() { outcome }: SettleShareReportsDto,
  ): Promise<void> {
    return this.reports.settle(auth.principal, code, outcome);
  }
}
