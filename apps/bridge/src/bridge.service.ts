import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CommandsService } from './dispatch/commands.service';
import { DispatchService } from './dispatch/dispatch.service';
import { JudgeServerService } from './judges/judge-server.service';
import { SubmissionsRepository } from './submissions/submissions.repository';

/** Start and stop order of the bridge, in one place. */
@Injectable()
export class BridgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BridgeService.name);

  constructor(
    private readonly dispatch: DispatchService,
    private readonly commands: CommandsService,
    private readonly server: JudgeServerService,
    private readonly submissions: SubmissionsRepository,
  ) {}

  /** The stream position is read before the queue is rebuilt from Mongo, so a command published meanwhile is not missed; judges connect last. */
  async onApplicationBootstrap(): Promise<void> {
    const position = await this.commands.position();
    await this.dispatch.enqueue(await this.submissions.loadQueued());
    this.commands.start(position);
    this.logger.log(`Judges connect on port ${await this.server.listen()}`);
  }

  /** Dispatching stops first, so judges dropped by the shutdown leave their submissions P/G for the next start instead of spending their requeue. */
  async onModuleDestroy(): Promise<void> {
    this.dispatch.stop();
    await this.commands.stop();
    await this.server.close();
  }
}
