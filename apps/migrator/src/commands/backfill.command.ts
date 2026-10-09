import { Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { MigrationStateService } from '../migration-state.service';
import { MigrationService } from '../migration.service';
import { writeReportFile } from '../report-file';

@Command({
  name: 'backfill',
  arguments: '[jobs...]',
  description: 'Backfill MongoDB from MariaDB (all jobs, or the named ones)',
})
export class BackfillCommand extends CommandRunner {
  private readonly logger = new Logger('backfill');

  constructor(
    private readonly migration: MigrationService,
    private readonly state: MigrationStateService,
  ) {
    super();
  }

  async run(jobs: string[], options: { fresh?: boolean; report?: string }) {
    await this.state.begin();
    const reports = await this.migration.backfill(jobs, options.fresh);
    const path =
      options.report ??
      `migration-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    await writeReportFile(path, reports);
    this.logger.log(`full report: ${path}`);
  }

  @Option({
    flags: '--fresh',
    description: 'Empty each selected job collection before writing',
  })
  parseFresh() {
    return true;
  }

  @Option({
    flags: '--report <path>',
    description:
      'Where to save every report line (default ./migration-report-<time>.txt)',
  })
  parseReport(path: string) {
    return path;
  }
}
