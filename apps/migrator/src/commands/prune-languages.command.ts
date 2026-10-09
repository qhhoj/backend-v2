import { Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Command, CommandRunner, Option } from 'nest-commander';
import { parseKeep, pruneLanguages } from '../language-pruner';

interface PruneCliOptions {
  keep?: string[];
  dryRun?: boolean;
}

@Command({
  name: 'prune-languages',
  description:
    'Remove every language the judge fleet does not run from all problems and disable it (judge-v2 cutover, before the switch)',
})
export class PruneLanguagesCommand extends CommandRunner {
  private readonly logger = new Logger('prune-languages');

  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  async run(_args: string[], options: PruneCliOptions) {
    if (!options.keep)
      throw new Error(
        '--keep KEY,KEY is required (the fleet list, RUNBOOK "Judge hosts" step 10, plus OUTPUT)',
      );
    const dryRun = Boolean(options.dryRun);
    const summary = await pruneLanguages(this.connection, {
      keep: options.keep,
      dryRun,
    });
    this.logger.log(JSON.stringify({ dryRun, ...summary }));
  }

  @Option({
    flags: '--keep <keys>',
    description: 'comma-separated language keys the judge fleet runs',
  })
  parseKeepOption(value: string) {
    return parseKeep(value);
  }

  @Option({ flags: '--dry-run', description: 'count only' })
  parseDryRun() {
    return true;
  }
}
