import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { IntegrityCheckService } from '../integrity-check.service';

const SHOWN = 50;

@Command({
  name: 'check-integrity',
  description:
    'Check cross-collection invariants and rating coverage after a backfill and recompute',
})
export class CheckIntegrityCommand extends CommandRunner {
  private readonly logger = new Logger('check-integrity');

  constructor(private readonly integrity: IntegrityCheckService) {
    super();
  }

  async run() {
    const lines = await this.integrity.run();
    lines.slice(0, SHOWN).forEach((line) => this.logger.error(line));
    this.logger.log(`${lines.length} broken invariant(s)`);
    process.exitCode = lines.length ? 1 : 0;
  }
}
