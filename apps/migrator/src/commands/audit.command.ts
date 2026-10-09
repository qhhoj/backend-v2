import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { AuditService } from '../audit.service';

@Command({ name: 'audit', description: 'Check MariaDB data before import' })
export class AuditCommand extends CommandRunner {
  private readonly logger = new Logger('audit');

  constructor(private readonly audit: AuditService) {
    super();
  }

  async run() {
    const { errors, warnings } = await this.audit.run();
    warnings.forEach((warning) => this.logger.warn(warning));
    errors.forEach((error) => this.logger.error(error));
    process.exitCode = errors.length ? 1 : 0;
  }
}
