import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { parseCspReports } from './csp-report';

export const CSP_REPORT_BODY_LIMIT_BYTES = 16 * 1024;
export const CSP_REPORT_LIMIT = 60;
export const CSP_REPORT_WINDOW_SECONDS = 60;

/** Receives the browser's report of a page that broke the site's Content-Security-Policy. */
@Public()
@ApiTags('Home & site')
@Controller('api/internal/csp-report')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  constructor(private readonly rateLimits: RateLimitService) {}

  /**
   * Report a Content-Security-Policy violation
   *
   * @remarks
   * Public, for browsers (the policy's `report-uri` and `report-to`). Takes a
   * legacy `application/csp-report` body or an `application/reports+json`
   * list, at most 16 KiB (413 `payload_too_large`) and at most 10 reports per
   * request. Each report is written to the server log as one line (rule,
   * blocked source, page without query, script file and line); nothing is
   * stored. Limited to 60 requests per minute per IP (429 `rate_limited`).
   * Returns 204, also for a body that holds no violation; a body that is not
   * JSON is 400.
   */
  @ApiConsumes('application/csp-report', 'application/reports+json')
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @RouteConfig({ bodyLimit: CSP_REPORT_BODY_LIMIT_BYTES })
  @HttpCode(204)
  @Post()
  async report(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.rateLimits.reserve(
      [`csp-report:ip:${request.ip}`],
      CSP_REPORT_LIMIT,
      CSP_REPORT_WINDOW_SECONDS,
    );
    for (const violation of parseCspReports(body))
      this.logger.warn(`csp-violation ${JSON.stringify(violation)}`);
  }
}
