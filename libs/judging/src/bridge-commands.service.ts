import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import {
  BRIDGE_COMMANDS_MAX_LENGTH,
  BRIDGE_COMMANDS_STREAM,
  JUDGE_COMMAND_BATCH,
} from './bridge-commands';
import type { BridgeCommand } from './bridge-commands';

@Injectable()
export class BridgeCommandsService {
  private readonly logger = new Logger(BridgeCommandsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Fire-and-forget: Mongo already holds the state, a lost command only waits for the bridge's next resync, so a Redis failure never fails the request. */
  async publish(command: BridgeCommand): Promise<void> {
    try {
      await this.redis.xadd(
        BRIDGE_COMMANDS_STREAM,
        'MAXLEN',
        '~',
        BRIDGE_COMMANDS_MAX_LENGTH,
        '*',
        'command',
        JSON.stringify(command),
      );
    } catch (error) {
      this.logger.error(
        `Bridge command ${command.type} not sent: ${(error as Error).message}`,
      );
    }
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
