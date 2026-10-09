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
    const { checked, missing, unchecked } = await this.files.run();
    missing
      .slice(0, SHOWN)
      .forEach((label) => this.logger.error(`missing ${label}`));
    unchecked
      .slice(0, SHOWN)
      .forEach((label) =>
        this.logger.warn(`unchecked (site path outside MEDIA_URL) ${label}`),
      );
    if (unchecked.length)
      this.logger.warn(
        `${unchecked.length} site path(s) outside MEDIA_URL were not checked: verify them by hand`,
      );
    this.logger.log(`${checked} file(s) checked, ${missing.length} missing`);
    process.exitCode = missing.length ? 1 : 0;
  }
}
