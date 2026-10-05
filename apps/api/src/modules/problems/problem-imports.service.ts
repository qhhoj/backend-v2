import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import { rm } from 'node:fs/promises';
import { hasPermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { newId } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import {
  listZipEntries,
  POLYGON_ERROR_PREFIX,
  POLYGON_QUEUE,
  ProblemDataFilesService,
  ZipError,
} from '@libs/problems';
import type { PolygonImportJob, PolygonImportResult } from '@libs/problems';
import { maxTestcasesFor } from './dto/limits';
import { ImportJobResponse } from './dto/import-job.response';
import { PolygonImportQueryDto } from './dto/problem-import.dto';
import { rejectFile, saveMultipartFile } from './multipart';
import { ProblemDataService } from './problem-data.service';
import { ProblemEditingService, unique } from './problem-editing.service';
import { ProblemsRepository } from './problems.repository';
import { IMPORT_LIMIT, IMPORT_WINDOW_SECONDS } from './rate-limits';

export const POLYGON_PACKAGE_MAX_BYTES = 512 * 1024 * 1024;
const JOB_RETENTION = { age: 24 * 60 * 60 };
/** Longest import error shown; worker messages can echo problem.xml text. */
const MAX_SHOWN_REASON = 1000;
const GENERIC_FAILURE = 'Import failed';

@Injectable()
export class ProblemImportsService {
  constructor(
    private readonly editing: ProblemEditingService,
    private readonly data: ProblemDataService,
    private readonly repository: ProblemsRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly rateLimit: RateLimitService,
    @InjectQueue(POLYGON_QUEUE)
    private readonly queue: Queue<PolygonImportJob, PolygonImportResult>,
  ) {}

  /** Authorises and resolves everything the worker needs, streams the package to the data volume, checks it is a zip with problem.xml, then enqueues. The worker removes the package when the job ends; here any failure before that does. */
  async start(
    auth: AuthContext,
    query: PolygonImportQueryDto,
    request: FastifyRequest,
  ): Promise<{ jobId: string }> {
    const job = await this.resolveJob(auth, query);
    await this.editing.assertReferences(query);
    await this.rateLimit.reserve(
      [`import:user:${auth.principal.userId}`],
      IMPORT_LIMIT,
      IMPORT_WINDOW_SECONDS,
    );
    const jobId = newId();
    const packagePath = await this.dataFiles.importPackagePath(jobId);
    try {
      await saveMultipartFile(request, POLYGON_PACKAGE_MAX_BYTES, packagePath);
      await this.assertPackage(packagePath);
      await this.queue.add('import', job, {
        jobId,
        removeOnComplete: JOB_RETENTION,
        removeOnFail: JOB_RETENTION,
      });
    } catch (error) {
      await rm(packagePath, { force: true });
      throw error;
    }
    return { jobId };
  }

  /** Only the requester (or a superuser) can see a job; anyone else gets the same 404 as an unknown id. */
  async status(auth: AuthContext, jobId: string): Promise<ImportJobResponse> {
    const job = await this.queue.getJob(jobId);
    const { principal } = auth;
    if (
      !job ||
      (job.data.requesterId !== principal.userId && !principal.isSuperuser)
    )
      throw new AppError('not_found', 404, 'No such import');
    return {
      id: jobId,
      state: await job.getState(),
      result: job.returnvalue ?? null,
      error: job.failedReason ? shownReason(job.failedReason) : null,
    };
  }

  /** Only the options the user gave are forwarded; the worker applies the defaults of a create and keeps the current value of an update. */
  private async resolveJob(
    auth: AuthContext,
    query: PolygonImportQueryDto,
  ): Promise<PolygonImportJob> {
    const { principal } = auth;
    const options = {
      requesterId: principal.userId,
      code: query.code,
      mode: query.mode,
      authors: query.authors && unique(query.authors),
      groupId: query.groupId,
      typeIds: query.typeIds && unique(query.typeIds),
      points: query.points,
      mainStatementLanguage: query.mainStatementLanguage ?? null,
      statementLanguages: Object.fromEntries(
        (query.statementLanguages ?? []).map(
          (pair) => pair.split('=') as [string, StatementLanguage],
        ),
      ),
      tutorialLanguage: query.tutorialLanguage ?? null,
      ignoreZeroPointBatches: query.ignoreZeroPointBatches,
      ignoreZeroPointCases: query.ignoreZeroPointCases,
      appendMainSolution: query.appendMainSolution,
      maxCases: maxTestcasesFor(principal),
    };
    if (query.mode === 'update') {
      const problem = await this.data.writableProblem(principal, query.code);
      if (
        problem.isFullMarkup &&
        !hasPermission(principal, 'judge.problem_full_markup')
      )
        throw new AppError(
          'forbidden',
          403,
          'Full markup requires judge.problem_full_markup',
        );
      return {
        ...options,
        curators: query.curators && unique(query.curators),
        isFullMarkup: problem.isFullMarkup,
        expectedDataVersion: problem.dataVersion ?? 0,
      };
    }
    if (!hasPermission(principal, 'judge.add_problem'))
      throw new AppError(
        'forbidden',
        403,
        'Creating a problem requires judge.add_problem',
      );
    if (
      (await this.repository.findByCode(query.code)) ||
      (await this.dataFiles.exists(query.code))
    )
      throw new AppError('validation_failed', 400, 'Problem code is taken', {
        code: ['Problem code is taken.'],
      });
    return {
      ...options,
      curators: unique([...(query.curators ?? []), principal.userId]),
      isFullMarkup: false,
    };
  }

  private async assertPackage(packagePath: string): Promise<void> {
    try {
      if (!(await listZipEntries(packagePath)).includes('problem.xml'))
        throw rejectFile('The package has no problem.xml at its root.');
    } catch (error) {
      throw error instanceof ZipError ? rejectFile(error.message) : error;
    }
  }
}

/** Only a failure the worker wrote for the requester is shown; the rest may carry paths and driver details. */
const shownReason = (reason: string): string =>
  reason.startsWith(POLYGON_ERROR_PREFIX)
    ? reason.slice(
        POLYGON_ERROR_PREFIX.length,
        POLYGON_ERROR_PREFIX.length + MAX_SHOWN_REASON,
      )
    : GENERIC_FAILURE;
