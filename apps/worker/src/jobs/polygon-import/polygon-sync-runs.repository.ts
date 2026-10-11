import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PolygonSyncRun, Problem } from '@libs/database';
import type { PolygonSyncStep } from '@libs/database';
import type { PolygonImportJob, PolygonSource } from '@libs/problems';
import type { Model } from 'mongoose';

/** How a job ended: the problem it wrote, or where and why it stopped (the error as shown to the requester). */
export type RunOutcome =
  | { result: 'ok'; problemId: string }
  | { result: 'failed'; step: PolygonSyncStep; error: string };

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
    error: failed ? outcome.error : null,
  };
}

/** Writes the Polygon sync history; zip imports (no `polygon` source) are not recorded. */
@Injectable()
export class PolygonSyncRunsRepository {
  constructor(
    @InjectModel(PolygonSyncRun.name)
    private readonly runs: Model<PolygonSyncRun>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  async record(
    jobId: string,
    job: PolygonImportJob,
    outcome: RunOutcome,
  ): Promise<void> {
    if (!job.polygon) return;
    const problem =
      outcome.result === 'ok'
        ? outcome.problemId
        : await this.problemIdOf(job.code);
    await this.runs.create(
      syncRunOf(jobId, { ...job, polygon: job.polygon }, outcome, problem),
    );
  }

  /** Deliberately S: a failed sync of a problem deleted meanwhile still belongs to its history. */
  private async problemIdOf(code: string): Promise<string | null> {
    const row = await this.problems.findOne({ code }, { _id: 1 }).lean().exec();
    return row?._id ?? null;
  }
}
