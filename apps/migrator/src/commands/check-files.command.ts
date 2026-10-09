import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { FileCheckService } from '../file-check.service';

const SHOWN = 50;

@Command({
  name: 'check-files',
  description: 'Check that every file a migrated document names was copied',
})
export class CheckFilesCommand extends CommandRunner {
  private readonly logger = new Logger('check-files');

  constructor(private readonly files: FileCheckService) {
    super();
  }

  async run() {
    const { checked, missing } = await this.files.run();
    missing
      .slice(0, SHOWN)
      .forEach((label) => this.logger.error(`missing ${label}`));
    this.logger.log(`${checked} file(s) checked, ${missing.length} missing`);
    process.exitCode = missing.length ? 1 : 0;
  }
}
