import { Injectable } from '@nestjs/common';
import { ACTIVITY_EXPORT_MAX_ROWS, csvLine } from '@libs/community';
import { activityFilter } from './activity-filter';
import { ActivityLogsRepository } from './activity-logs.repository';
import type { ActivityLogRow } from './activity-logs.repository';
import { ActivityLogsService } from './activity-logs.service';
import type { ActivityFilterDto } from './dto/activity-query.dto';

const HEADER = [
  'Timestamp',
  'User',
  'IP Address',
  'Path',
  'Method',
  'Response Code',
  'User Agent',
  'Referer',
];
const BATCH = 1000;

/** Legacy `export_logs`, streamed: a cursor in batches of 1000 rows, at most 100000 rows, every cell spreadsheet-safe (`csvLine`). */
@Injectable()
export class ActivityExportService {
  constructor(
    private readonly logs: ActivityLogsRepository,
    private readonly logsService: ActivityLogsService,
  ) {}

  async *lines(query: ActivityFilterDto): AsyncGenerator<string> {
    yield csvLine(HEADER);
    const scope = await this.logsService.scopeOf(query.user);
    if (!scope) return;
    let batch: ActivityLogRow[] = [];
    for await (const row of this.logs.cursor(
      activityFilter({ ...query, scope }),
      ACTIVITY_EXPORT_MAX_ROWS,
    )) {
      batch.push(row);
      if (batch.length === BATCH) {
        yield await this.format(batch);
        batch = [];
      }
    }
    if (batch.length) yield await this.format(batch);
  }

  private async format(rows: ActivityLogRow[]): Promise<string> {
    const names = await this.logsService.usernames(rows);
    return rows
      .map((row) =>
        csvLine([
          row.at.toISOString(),
          row.userId ? (names.get(row.userId) ?? '') : 'Anonymous',
          row.ip,
          row.path,
          row.method,
          row.statusCode,
          row.userAgent,
          row.referer,
        ]),
      )
      .join('');
  }
}
