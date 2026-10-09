import { Command, CommandRunner, Option } from 'nest-commander';
import { MigrationStateService } from '../migration-state.service';
import { MigrationService } from '../migration.service';

@Command({
  name: 'backfill',
  arguments: '[jobs...]',
  description: 'Backfill MongoDB from MariaDB (all jobs, or the named ones)',
})
export class BackfillCommand extends CommandRunner {
  constructor(
    private readonly migration: MigrationService,
    private readonly state: MigrationStateService,
  ) {
    super();
  }

  async run(jobs: string[], options: { fresh?: boolean }) {
    await this.state.begin();
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
