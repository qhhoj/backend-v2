import { Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Problem, ProblemSchema } from '@libs/database';
import type { Connection } from 'mongoose';
import { Command, CommandRunner, Option } from 'nest-commander';
import {
  dataVersionFiles,
  stampDataVersions,
  type ProblemVersion,
} from '../data-version-stamper';

interface StampCliOptions {
  root?: string;
  dryRun?: boolean;
}

@Command({
  name: 'stamp-data-versions',
  description:
    'Write <root>/<code>/.data-version for every problem (judge-v2 cutover; run after the last rsync)',
})
export class StampDataVersionsCommand extends CommandRunner {
  private readonly logger = new Logger('stamp-data-versions');

  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  async run(_args: string[], options: StampCliOptions) {
    const root = options.root ?? process.env.PROBLEM_DATA_ROOT;
    if (!root) throw new Error('--root or PROBLEM_DATA_ROOT is required');
    const dryRun = Boolean(options.dryRun);
    const summary = await stampDataVersions(this.problems(), {
      files: dataVersionFiles(root),
      dryRun,
    });
    this.logger.log(JSON.stringify({ root, dryRun, ...summary }));
  }

  private async *problems(): AsyncIterable<ProblemVersion> {
    const model = this.connection.model<Problem>(Problem.name, ProblemSchema);
    for await (const doc of model
      .find({}, { code: 1, dataVersion: 1 })
      .lean()
      .cursor())
      yield { code: doc.code, dataVersion: doc.dataVersion ?? 0 };
  }

  @Option({
    flags: '--root <dir>',
    description: 'problem data root (default PROBLEM_DATA_ROOT)',
  })
  parseRoot(value: string) {
    return value;
  }

  @Option({ flags: '--dry-run', description: 'count only' })
  parseDryRun() {
    return true;
  }
}
