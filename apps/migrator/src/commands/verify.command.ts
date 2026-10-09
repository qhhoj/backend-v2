import { Command, CommandRunner, Option } from 'nest-commander';
import { MigrationService } from '../migration.service';
import { setSkipLegacySecrets } from '../rehearsal';

@Command({
  name: 'verify',
  arguments: '[jobs...]',
  description: 'Compare MongoDB against MariaDB (all jobs, or the named ones)',
})
export class VerifyCommand extends CommandRunner {
  constructor(private readonly migration: MigrationService) {
    super();
  }

  async run(jobs: string[], options: { skipLegacySecrets?: boolean } = {}) {
    setSkipLegacySecrets(options.skipLegacySecrets === true);
    process.exitCode = (await this.migration.verify(jobs)) ? 1 : 0;
  }

  @Option({
    flags: '--skip-legacy-secrets',
    description:
      'Rehearsal only (needs MIGRATION_REHEARSAL=1): verify a backfill run with the same flag',
  })
  parseSkipLegacySecrets() {
    return true;
  }
}
