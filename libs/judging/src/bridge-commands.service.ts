import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import {
  BRIDGE_COMMANDS_MAX_LENGTH,
  BRIDGE_COMMANDS_STREAM,
  JUDGE_COMMAND_BATCH,
} from './bridge-commands';
import type { BridgeCommand } from './bridge-commands';

/** Longest a request waits for a command to reach Redis. */
export const PUBLISH_TIMEOUT_MS = 1000;

@Injectable()
export class BridgeCommandsService {
  private readonly logger = new Logger(BridgeCommandsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Fire-and-forget: Mongo already holds the state, a lost command only waits for the bridge's next resync, so a Redis failure never fails the request. */
  async publish(command: BridgeCommand): Promise<void> {
    try {
      await this.withinTimeout(
        this.redis.xadd(
          BRIDGE_COMMANDS_STREAM,
          'MAXLEN',
          '~',
          BRIDGE_COMMANDS_MAX_LENGTH,
          '*',
          'command',
          JSON.stringify(command),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Bridge command ${command.type} not sent: ${(error as Error).message}`,
      );
    }
  }

  /** The shared client queues commands and retries while Redis is down; cap the wait so a Redis outage costs requests at most this long. */
  private withinTimeout<T>(pending: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${PUBLISH_TIMEOUT_MS} ms`)),
        PUBLISH_TIMEOUT_MS,
      );
    });
    return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
  }

  async judge(
    submissionIds: string[],
    judgeName: string | null = null,
  ): Promise<void> {
    for (
      let start = 0;
      start < submissionIds.length;
      start += JUDGE_COMMAND_BATCH
    )
      await this.publish({
        type: 'judge',
        submissionIds: submissionIds.slice(start, start + JUDGE_COMMAND_BATCH),
        judgeName,
        bannedJudges: [],
      });
  }
}
