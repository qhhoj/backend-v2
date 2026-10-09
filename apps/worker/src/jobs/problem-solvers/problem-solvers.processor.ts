import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PROBLEM_SOLVERS_QUEUE } from '@libs/problems';
import type { ProblemSolversJob } from '@libs/problems';
import { ProblemSolversService } from './problem-solvers.service';

@Processor(PROBLEM_SOLVERS_QUEUE, { concurrency: 1 })
export class ProblemSolversProcessor extends WorkerHost {
  private readonly logger = new Logger(ProblemSolversProcessor.name);

  constructor(private readonly solvers: ProblemSolversService) {
    super();
  }

  process(job: Job<ProblemSolversJob>): Promise<number> {
    return this.solvers.recompute(job.data.problemId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProblemSolversJob> | undefined, error: Error): void {
    this.logger.error(
      `Recompute for the solvers of problem ${job?.data.problemId} (${job?.data.reason}) failed: ${error.message}`,
    );
  }
}
