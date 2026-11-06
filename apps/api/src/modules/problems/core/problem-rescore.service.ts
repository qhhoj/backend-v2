import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectJob, JobProducer } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import { ProblemEvents } from './problem.events';

/** Points, partial and organisation privacy (`pointsChanged`) and publicity (`publicityChanged`) decide what every submission and user is worth; the worker rescores. */
@Injectable()
export class ProblemRescoreEnqueuerService implements OnModuleInit {
  constructor(
    private readonly events: ProblemEvents,
    @InjectJob(judgingJobs.problemRescore)
    private readonly rescores: JobProducer<ProblemRescoreJob>,
  ) {}

  onModuleInit(): void {
    const rescore = (problemId: string) =>
      void this.rescores.enqueue({ problemId });
    this.events.on('pointsChanged', rescore);
    this.events.on('publicityChanged', rescore);
  }
}
