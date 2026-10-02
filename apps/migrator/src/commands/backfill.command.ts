import { Command, CommandRunner, Option } from 'nest-commander';
import { MigrationService } from '../migration.service';

@Command({
  name: 'backfill',
  arguments: '[jobs...]',
  description: 'Backfill MongoDB from MariaDB (all jobs, or the named ones)',
})
export class BackfillCommand extends CommandRunner {
  constructor(private readonly migration: MigrationService) {
    super();
  }

  async run(jobs: string[], options: { fresh?: boolean }) {
    await this.migration.backfill(jobs, options.fresh);
  }

  @Option({
    flags: '--fresh',
    description: 'Empty each selected job collection before writing',
  })
  parseFresh() {
    return true;
  }
}
