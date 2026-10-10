import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BRIDGE_TIMINGS } from './bridge-timings';
import type { BridgeTimings } from './bridge-timings';
import { CommandsService } from './dispatch/commands.service';
import { DispatcherService } from './dispatch/dispatcher.service';
import { JudgesRepository } from './judges/judges.repository';
import { JudgeLinkServer } from './link/judge-link.server';
import { RunsService } from './submissions/runs.service';
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
    private readonly dispatch: DispatcherService,
    private readonly commands: CommandsService,
    private readonly server: JudgeLinkServer,
    private readonly judges: JudgesRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly runs: RunsService,
  ) {}

  /** The port is bound first, so a second process dies on EADDRINUSE before touching Mongo; connecting judges wait. Judges are marked offline before any is served, so the sweep never clobbers one that resumes. P/G rows are left alone: their judges resume them, and the resync requeues the rest after two ticks without spending a requeue. The stream position is read before the queue is rebuilt, so a command published meanwhile is not missed; judges are served last. */
  async onApplicationBootstrap(): Promise<void> {
    const port = await this.server.listen();
    await this.judges.setAllOffline();
    const position = await this.commands.position();
    await this.dispatch.enqueue(await this.submissions.loadQueued());
    this.commands.start(position);
    this.resyncTimer = setInterval(
      () => void this.resync(),
      this.timings.resyncMs,
    );
    this.server.acceptJudges();
    this.logger.log(`Judges connect on port ${port}`);
  }

  /** Dispatching stops first, so sessions ended by the shutdown leave their rows P/G (no grace, no requeue spent) for a resume or the next start; judges are marked offline once their sessions are gone. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.resyncTimer);
    this.dispatch.stop();
    await this.commands.stop();
    await this.server.close();
    await this.judges.setAllOffline();
  }

  /** Mongo is the truth: queued submissions no command announced (Redis failure, trimmed stream) still reach a judge, P/G rows nobody holds go back to the queue, and RETRY bans end. A tick still running when the next fires is skipped; a failure waits for the next tick. */
  private async resync(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      await this.reconcileJudges();
      await this.requeueStranded();
      await this.unpinAbsent();
      await this.dispatch.clearRetryBans();
      const rows = await this.submissions.loadQueued();
      // a queued entry may hold constraints (judge, banned judges) only a command carries: the tick never replaces it
      await this.dispatch.enqueue(
        rows.filter((row) => !this.dispatch.hasQueued(row.id)),
      );
    } catch (error) {
      this.logger.error(`Queue resync failed: ${(error as Error).message}`);
    } finally {
      this.resyncing = false;
    }
  }

  /** Queued rows pinned to a judge that stayed away past `pinFallbackMs` go to any judge; the queue entries are refreshed so the dropped pin takes effect now. */
  private async unpinAbsent(): Promise<void> {
    const ids = await this.submissions.unpinAbsent(
      this.dispatch.connectedNames(),
      new Date(Date.now() - this.timings.pinFallbackMs),
    );
    if (!ids.length) return;
    this.logger.warn(
      `Resync released ${ids.length} submissions pinned to an absent judge`,
    );
    await this.dispatch.enqueue(await this.submissions.loadQueued(ids));
  }

  /** A block, disable or key rotation whose command was lost still takes effect: connected judges are compared with their rows. */
  private async reconcileJudges(): Promise<void> {
    const names = this.dispatch.connectedNames();
    if (!names.length) return;
    const access = await this.judges.accessOf(names);
    for (const name of await this.dispatch.reconcile(access))
      this.server.revoke(name);
  }

  /** A P/G run no session and no grace holds (its judge never came back after a bridge restart, a write was lost) would never be sent again. A session frees a slot before the next row is claimed, so a run counts as stranded only when it was unheld on two consecutive ticks; `requeueCount` is not spent, the judge did not fail. */
  private async requeueStranded(): Promise<void> {
    const inFlight = await this.submissions.inFlightRuns();
    const held = new Set(this.dispatch.heldIds());
    const unheld = inFlight.filter((run) => !held.has(run.id));
    const stranded = unheld.filter((run) => this.unheldBefore.has(run.id));
    this.unheldBefore = new Set(unheld.map((run) => run.id));
    if (!stranded.length) return;
    const requeued = await this.submissions.resetStrandedRuns(stranded);
    this.runs.announceRequeued(requeued);
    await this.dispatch.enqueue(
      await this.submissions.loadQueued(
        requeued.map((job) => job.submissionId),
      ),
    );
    this.logger.warn(
      `Resync requeued ${requeued.length} submissions no judge held`,
    );
  }
}
