import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { MigrationStateService } from '../migration-state.service';

@Command({
  name: 'finish',
  description:
    'Clear the migration marker: the worker refuses migration-recompute afterwards (run before the site goes live)',
})
export class FinishCommand extends CommandRunner {
  private readonly logger = new Logger('finish');

  constructor(private readonly state: MigrationStateService) {
    super();
  }

  async run() {
    await this.state.finish();
    this.logger.log('migration marker cleared');
  }
}
