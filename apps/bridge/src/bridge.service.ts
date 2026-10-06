import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BRIDGE_TIMINGS } from './bridge-timings';
import type { BridgeTimings } from './bridge-timings';
import { CommandsService } from './dispatch/commands.service';
import { DispatchService } from './dispatch/dispatch.service';
import { JudgeServerService } from './judges/judge-server.service';
import { JudgesRepository } from './judges/judges.repository';
import { SubmissionsRepository } from './submissions/submissions.repository';

/** Start and stop order of the bridge, in one place. Mongo is the queue's truth: a start rebuilds the in-memory queue from it and a resync keeps reading it. */
@Injectable()
export class BridgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BridgeService.name);
  private resyncTimer?: NodeJS.Timeout;
  private resyncing = false;
  private unheldBefore = new Set<string>();

  constructor(
    @Inject(BRIDGE_TIMINGS) private readonly timings: BridgeTimings,
    private readonly dispatch: DispatchService,
    private readonly commands: CommandsService,
    private readonly server: JudgeServerService,
    private readonly judges: JudgesRepository,
    private readonly submissions: SubmissionsRepository,
  ) {}

  /** The port is bound first, so a second process dies on EADDRINUSE before touching Mongo; connecting judges wait. Then judges offline and P/G back to QU; the stream position is read before the queue is rebuilt, so a command published meanwhile is not missed; judges are served last. */
  async onApplicationBootstrap(): Promise<void> {
    const port = await this.server.listen();
    await this.judges.setAllOffline();
    const requeued = await this.submissions.resetInFlight();
    const position = await this.commands.position();
    await this.dispatch.enqueue(await this.submissions.loadQueued());
    this.commands.start(position);
    this.resyncTimer = setInterval(
      () => void this.resync(),
      this.timings.resyncMs,
    );
    this.server.acceptJudges();
    this.logger.log(
      `Judges connect on port ${port}; ${requeued} interrupted submissions requeued`,
    );
  }

  /** Dispatching stops first, so judges dropped by the shutdown leave their submissions P/G for the next start instead of spending their requeue. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.resyncTimer);
    this.dispatch.stop();
    await this.commands.stop();
    await this.server.close();
  }

  /** Mongo is the truth: queued submissions no command announced (Redis failure, trimmed stream) still reach a judge, and P/G rows no judge works on go back to the queue. `enqueue` skips queued and running ids and `claim` is a compare-and-set, so a tick racing a dispatch changes nothing. A tick still running when the next fires is skipped; a failure waits for the next tick. */
  private async resync(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      await this.requeueStranded();
      await this.dispatch.enqueue(await this.submissions.loadQueued());
    } catch (error) {
      this.logger.error(`Queue resync failed: ${(error as Error).message}`);
    } finally {
      this.resyncing = false;
    }
  }

  /** A P/G row no judge works on (a lost judge's requeue failed, a write was lost) would never be sent again. A judge frees itself before its result write lands, so a row counts as stranded only when it was unheld on two consecutive ticks; `requeueCount` is not spent, the judge did not fail. */
  private async requeueStranded(): Promise<void> {
    const inFlight = await this.submissions.inFlightClaims();
    const held = new Set(this.dispatch.heldIds());
    const unheld = inFlight.filter((claim) => !held.has(claim.id));
    const stranded = unheld.filter((claim) => this.unheldBefore.has(claim.id));
    this.unheldBefore = new Set(unheld.map((claim) => claim.id));
    if (!stranded.length) return;
    const count = await this.submissions.resetStranded(stranded);
    this.logger.warn(`Resync requeued ${count} submissions no judge held`);
  }
}
