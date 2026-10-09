import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { RecomputeService } from '../recompute.service';

@Command({
  name: 'recompute',
  description:
    'Recompute points, stats, scores and caches, and re-rate every rated contest, in the worker after a backfill, and wait',
})
export class RecomputeCommand extends CommandRunner {
  private readonly logger = new Logger('recompute');

  constructor(private readonly recompute: RecomputeService) {
    super();
  }

  async run() {
    this.logger.log(JSON.stringify(await this.recompute.run()));
  }
}
