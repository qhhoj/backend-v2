import { Logger } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { GrantPermissionsService } from '../grant-permissions.service';

@Command({
  name: 'grant-permissions',
  description:
    'Give each v2-only permission codename to the groups and users that hold its anchor permission (idempotent)',
})
export class GrantPermissionsCommand extends CommandRunner {
  private readonly logger = new Logger(GrantPermissionsCommand.name);

  constructor(private readonly service: GrantPermissionsService) {
    super();
  }

  async run(): Promise<void> {
    this.logger.log(JSON.stringify(await this.service.grant()));
  }
}
