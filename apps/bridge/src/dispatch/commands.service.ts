import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, unique } from '@libs/common';
import type { Env } from '@libs/common';
import { BRIDGE_COMMANDS_STREAM, parseBridgeCommand } from '@libs/judging';
import type { BridgeCommand } from '@libs/judging';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { DispatchService } from './dispatch.service';

const READ_BLOCK_MS = 5000;
const READ_BATCH = 100;
const RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

/** The wait after a failed read doubles up to a cap. */
export const nextRetryDelay = (delayMs: number): number =>
  Math.min(delayMs * 2, MAX_RETRY_DELAY_MS);

/**
 * Reads the api's command stream on a dedicated blocking connection (never the shared client) and applies each command to the dispatcher in order.
 * The connection never reconnects by itself: a dropped link or a failing read is logged, waited out with a doubling delay (`stop` cuts the wait short) and retried on a fresh connection from the last id read.
 */
@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);
  private reader: Redis | null = null;
  private reading: Promise<void> | null = null;
  private running = false;
  private wake: (() => void) | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dispatch: DispatchService,
    private readonly submissions: SubmissionsRepository,
  ) {}

  /** The newest entry id (`0-0` when empty). Taken before the queue is rebuilt from Mongo, so a command published meanwhile is still read. */
  async position(): Promise<string> {
    const [latest] = await this.connection().xrevrange(
      BRIDGE_COMMANDS_STREAM,
      '+',
      '-',
      'COUNT',
      1,
    );
    return latest?.[0] ?? '0-0';
  }

  /** A no-op while already reading (`BridgeService` starts it at boot). */
  start(fromId: string): void {
    if (this.reading) return;
    this.running = true;
    this.reading = this.readFrom(fromId);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.reader?.disconnect();
    this.reader = null;
    this.wake?.();
    await this.reading;
    this.reading = null;
  }

  /** One stream entry; malformed entries are logged and skipped. */
  async apply(raw: string | undefined): Promise<void> {
    const command = raw === undefined ? null : parseBridgeCommand(raw);
    if (!command)
      return this.logger.warn('Ignoring a malformed bridge command');
    await this.execute(command);
  }

  private connection(): Redis {
    if (!this.reader || this.reader.status === 'end') {
      const reader = new Redis(this.env.redisUrl, {
        maxRetriesPerRequest: null,
        retryStrategy: () => null,
      });
      reader.on('error', (error) =>
        this.logger.error(`Bridge command connection: ${error.message}`),
      );
      this.reader = reader;
    }
    return this.reader;
  }

  private async readFrom(fromId: string): Promise<void> {
    let lastId = fromId;
    let retryDelay = RETRY_DELAY_MS;
    while (this.running) {
      try {
        const streams = await this.connection().xread(
          'COUNT',
          READ_BATCH,
          'BLOCK',
          READ_BLOCK_MS,
          'STREAMS',
          BRIDGE_COMMANDS_STREAM,
          lastId,
        );
        for (const [, entries] of streams ?? [])
          for (const [id, fields] of entries) {
            lastId = id;
            await this.applyEntry(fields);
          }
        retryDelay = RETRY_DELAY_MS;
      } catch (error) {
        if (!this.running) return;
        this.logger.error(
          `Reading bridge commands failed: ${(error as Error).message}`,
        );
        await this.sleep(retryDelay);
        retryDelay = nextRetryDelay(retryDelay);
      }
    }
  }

  /** A command that fails to apply (Mongo down) is dropped, not retried: the next resync recovers it. */
  private async applyEntry(fields: string[]): Promise<void> {
    const at = fields.indexOf('command');
    try {
      await this.apply(at === -1 ? undefined : fields[at + 1]);
    } catch (error) {
      this.logger.error(
        `Applying a bridge command failed: ${(error as Error).message}`,
      );
    }
  }

  /** Ends early when `stop` wakes it. */
  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private async execute(command: BridgeCommand): Promise<void> {
    switch (command.type) {
      case 'judge': {
        const queued = await this.submissions.loadQueued(command.submissionIds);
        return this.dispatch.enqueue(
          queued.map((submission) => ({
            ...submission,
            judgeName: command.judgeName,
            bannedJudges: unique([
              ...submission.bannedJudges,
              ...command.bannedJudges,
            ]),
          })),
        );
      }
      case 'abort':
        return this.dispatch.abort(command.submissionId);
      case 'disconnect-judge':
        return this.dispatch.disconnect(command.judgeName, command.force);
      case 'disable-judge':
        return this.dispatch.setDisabled(command.judgeName, command.isDisabled);
    }
  }
}
