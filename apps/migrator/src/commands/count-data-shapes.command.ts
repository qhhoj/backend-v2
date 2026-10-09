import { Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Problem, ProblemSchema } from '@libs/database';
import type { Connection } from 'mongoose';
import { Command, CommandRunner } from 'nest-commander';
import { countDataShapes, type ShapeRow } from '../legacy-data-shapes';

@Command({
  name: 'count-data-shapes',
  description:
    'Count bridged checkers by language and nested case names (judge-v2 cutover pre-check)',
})
export class CountDataShapesCommand extends CommandRunner {
  private readonly logger = new Logger('count-data-shapes');

  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  async run() {
    const counts = await countDataShapes(this.problems());
    this.logger.log(JSON.stringify(counts));
    process.exitCode = counts.bridgedNeedingTestlib.length ? 1 : 0;
  }

  private async *problems(): AsyncIterable<ShapeRow> {
    const model = this.connection.model<Problem>(Problem.name, ProblemSchema);
    const projection = {
      code: 1,
      'data.checker': 1,
      'data.customChecker': 1,
      'data.cases.input': 1,
      'data.cases.output': 1,
    };
    for await (const doc of model.find({}, projection).lean().cursor())
      yield doc;
  }
}
