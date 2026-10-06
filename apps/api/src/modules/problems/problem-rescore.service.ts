import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { notifyRescore, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import { ProblemEvents } from './problem.events';

/** Points, partial and organisation privacy (`pointsChanged`) and publicity (`publicityChanged`) decide what every submission and user is worth; the worker rescores. */
@Injectable()
export class ProblemRescoreService implements OnModuleInit {
  private readonly logger = new Logger(ProblemRescoreService.name);

  constructor(
    private readonly events: ProblemEvents,
    @InjectQueue(PROBLEM_RESCORE_QUEUE)
    private readonly queue: Queue<ProblemRescoreJob>,
  ) {}

  onModuleInit(): void {
    const rescore = (problemId: string) =>
      void notifyRescore(this.queue, problemId, this.logger);
    this.events.on('pointsChanged', rescore);
    this.events.on('publicityChanged', rescore);
  }
}
