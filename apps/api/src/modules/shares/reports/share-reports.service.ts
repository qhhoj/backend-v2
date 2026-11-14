import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  isDuplicateKey,
  Paginated,
  RateLimitService,
  unique,
} from '@libs/common';
import { uuidStr } from '@libs/database';
import type { ShareReport } from '@libs/database';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import type { SettledReportStatus } from '../../comments/reports/dto/report-comment.dto';
import { ShareSummaryResponse } from '../core/dto/share.response';
import { REPORT_LIMIT, REPORT_WINDOW_SECONDS } from '../core/rate-limits';
import { ShareAccessService } from '../core/share-access.service';
import { SharesRepository } from '../core/shares.repository';
import type {
  ReportShareDto,
  ShareReportResponse,
} from './dto/share-report.dto';
import { ShareReportsRepository } from './share-reports.repository';
import type { ShareReportQueue } from './share-reports.repository';

export const REPORT_QUEUE_PAGE_SIZE = 20;

/** Share reports, the comment-report pattern: a reader reports a share once; `judge.manage_share` works the queue. */
@Injectable()
export class ShareReportsService {
  constructor(
    private readonly reports: ShareReportsRepository,
    private readonly access: ShareAccessService,
    private readonly shares: SharesRepository,
    private readonly users: UsersRepository,
    private readonly rateLimits: RateLimitService,
  ) {}

  /** A share the reporter can read and did not make; once per user (409), `REPORT_LIMIT` an hour. */
  async report(
    principal: Principal,
    code: string,
    { reason, note = '' }: ReportShareDto,
  ): Promise<void> {
    const { share, isOwner } = await this.access.readable(principal, code, {
      withSource: false,
      now: new Date(),
    });
    if (isOwner)
      throw new AppError('forbidden', 403, 'You cannot report your own share');
    const release = await this.rateLimits.reserve(
      [`share-report:${principal.userId}`],
      REPORT_LIMIT,
      REPORT_WINDOW_SECONDS,
    );
    try {
      await this.reports.create({
        share: uuidStr(share._id),
        code: share.code,
        reporter: principal.userId,
        reason,
        note: note.trim(),
      });
    } catch (error) {
      await release();
      if (isDuplicateKey(error))
        throw new AppError('conflict', 409, 'You already reported this share');
      throw error;
    }
  }

  /** One page of reports, newest first, each with its share while that still exists. */
  async queue(
    page: number,
    queue: ShareReportQueue,
  ): Promise<Paginated<ShareReportResponse>> {
    const { items, total } = await this.reports.list(
      queue,
      page,
      REPORT_QUEUE_PAGE_SIZE,
    );
    const [shares, people] = await Promise.all([
      this.shares.findByIds(unique(items.map((row) => uuidStr(row.share)))),
      this.users.findByIds(unique(items.flatMap(peopleOf))),
    ]);
    const shareOf = new Map(shares.map((share) => [uuidStr(share._id), share]));
    const personOf = new Map(people.map((person) => [person._id, person]));
    const summary = (id: unknown) => {
      const person = id ? personOf.get(uuidStr(id)) : undefined;
      return person ? UserSummaryResponse.from(person) : null;
    };
    return new Paginated(
      items.map((row) => {
        const share = shareOf.get(uuidStr(row.share));
        return {
          id: uuidStr(row._id),
          code: row.code,
          share: share ? ShareSummaryResponse.from(share) : null,
          reporter: summary(row.reporter),
          reason: row.reason,
          note: row.note,
          status: row.status,
          createdAt: row.createdAt,
          settledBy: summary(row.settledBy),
          settledAt: row.settledAt,
        };
      }),
      { page, pageSize: REPORT_QUEUE_PAGE_SIZE, total },
    );
  }

  /** Resolves or dismisses every open report of the code, also once its share expired or was deleted; 404 when it has none. */
  async settle(
    principal: Principal,
    code: string,
    outcome: SettledReportStatus,
  ): Promise<void> {
    const settled = await this.reports.settle(code, outcome, {
      settledBy: principal.userId,
      now: new Date(),
    });
    if (!settled)
      throw new AppError('not_found', 404, 'No open reports on this code');
  }
}

const peopleOf = (report: ShareReport): string[] => [
  uuidStr(report.reporter),
  ...(report.settledBy ? [uuidStr(report.settledBy)] : []),
];
