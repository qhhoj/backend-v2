import { Command, CommandRunner } from 'nest-commander';
import { MigrationService } from '../migration.service';

@Command({
  name: 'verify',
  arguments: '[jobs...]',
  description: 'Compare MongoDB against MariaDB (all jobs, or the named ones)',
})
export class VerifyCommand extends CommandRunner {
  constructor(private readonly migration: MigrationService) {
    super();
  }

  async run(jobs: string[]) {
    process.exitCode = (await this.migration.verify(jobs)) ? 1 : 0;
  }
}
