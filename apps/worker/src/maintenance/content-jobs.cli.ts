import { NestFactory } from '@nestjs/core';
import { nestLogLevels, StorageService, workerConfig } from '@libs/common';
import type { ContentJob } from './content-job';
import { ContentJobsModule } from './content-jobs.module';
import { parseJobOptions } from './job-options';
import { RehostHackmdImagesJob } from './rehost-hackmd-images/rehost-hackmd-images.job';
import { RerenderContentJob } from './rerender-content/rerender-content.job';
import { printReport, runContentJob } from './run-content-job';

type JobClass = typeof RehostHackmdImagesJob | typeof RerenderContentJob;

/** `worker <step> [--dry-run | --apply --backup <file>] [--include-imgur]`: one manual run of a content job. Not a deploy step. */
export function contentJobStep(jobClass: JobClass) {
  return async (args: string[]): Promise<void> => {
    const options = parseJobOptions(args);
    const { logLevel } = workerConfig.load();
    const app = await NestFactory.createApplicationContext(
      ContentJobsModule.withRehostOptions({
        includeImgur: options.includeImgur,
      }),
      { logger: nestLogLevels(logLevel) },
    );
    try {
      const job: ContentJob = app.get(jobClass);
      const report = await runContentJob(job, options, app.get(StorageService));
      printReport(job.name, options, report);
    } finally {
      await app.close();
    }
  };
}
