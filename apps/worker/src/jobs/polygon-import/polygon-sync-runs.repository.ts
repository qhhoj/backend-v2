import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PolygonSyncRun } from '@libs/database';
import type { PolygonSyncStep } from '@libs/database';
import type { PolygonImportJob, PolygonSource } from '@libs/problems';
import type { Model } from 'mongoose';
import type { ImportFailure } from './import-failure';

/** How a job ended: the problem it wrote, or where and why it stopped (the error as shown to the requester). */
export type RunOutcome =
  | { result: 'ok'; problemId: string }
  | { result: 'failed'; step: PolygonSyncStep; failure: ImportFailure };

type RunFields = Omit<PolygonSyncRun, '_id' | 'createdAt'>;

/** The history row of one finished Polygon job; `problem` is the QHHOJ problem id, null when none exists. */
function syncRunOf(
  jobId: string,
  job: PolygonImportJob & { polygon: PolygonSource },
  outcome: RunOutcome,
  problem: string | null,
): RunFields {
  const source = job.polygon;
  const failed = outcome.result === 'failed';
  return {
    problem,
    code: job.code,
    polygonProblemId: source.problemId,
    polygonName: source.name,
    revision: source.revision,
    packageId: source.packageId,
    packageCreatedAt: source.packageCreatedAt
      ? new Date(source.packageCreatedAt)
      : null,
    packageType: source.packageType ?? 'full',
    purpose: source.purpose,
    trigger: source.trigger ?? 'manual',
    requestedBy: job.requesterId,
    jobId,
    result: outcome.result,
    failedStep: failed ? outcome.step : null,
    error: failed ? outcome.failure.message : null,
    errorCode: failed ? outcome.failure.code : null,
    errorParams: failed ? outcome.failure.params : null,
  };
}

/** Writes the Polygon sync history; zip imports (no `polygon` source) are not recorded. */
@Injectable()
export class PolygonSyncRunsRepository {
  constructor(
    @InjectModel(PolygonSyncRun.name)
    private readonly runs: Model<PolygonSyncRun>,
  ) {}

  async record(
    jobId: string,
    job: PolygonImportJob,
    outcome: RunOutcome,
  ): Promise<void> {
    if (!job.polygon) return;
    const problem =
      outcome.result === 'ok' ? outcome.problemId : (job.problemId ?? null);
    await this.runs.create(
      syncRunOf(jobId, { ...job, polygon: job.polygon }, outcome, problem),
    );
  }
}
