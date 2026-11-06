import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import { SimilarityService } from './similarity.service';

@Injectable()
export class SimilarityProcessor extends JobProcessor<SimilarityJob, void>(
  judgingJobs.similarity,
) {
  constructor(private readonly similarity: SimilarityService) {
    super();
  }

  /** `run` records every failure on the run itself, a shutdown included (the run is marked failed and the job completes); the job fails only if that recording does. */
  run({ runId }: SimilarityJob): Promise<void> {
    return this.similarity.run(runId);
  }

  /** Catches a job that died around `run` (stalled past its lock), which would otherwise leave the scope active until the api's stale-run release. */
  protected async onFailure({ runId }: SimilarityJob): Promise<void> {
    try {
      await this.similarity.markFailed(runId, 'internal_error');
    } catch (markError) {
      const { name, message } = markError as Error;
      this.logger.error(
        `Could not mark similarity run ${runId} failed (${name}): ${message}`,
      );
    }
  }
}
