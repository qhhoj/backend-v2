import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { problemDataLockKey } from '@libs/problems';

/** Whether a problem's data is being written right now: the api and worker hold its Redis lock for the whole change, while judges see the writing marker and wait. */
@Injectable()
export class ProblemDataWrites {
  private readonly logger = new Logger(ProblemDataWrites.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** A failed read counts as no write: the judge itself still waits for the marker before it gives up. */
  async isWriting(problemCode: string): Promise<boolean> {
    try {
      return (await this.redis.exists(problemDataLockKey(problemCode))) === 1;
    } catch (error) {
      this.logger.warn(
        `Reading the data lock of problem ${problemCode} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
