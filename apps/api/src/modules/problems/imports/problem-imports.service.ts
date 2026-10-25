import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { rm, stat } from 'node:fs/promises';
import { hasPermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, RateLimitService, unique } from '@libs/common';
import { newId } from '@libs/database';
import {
  listZipEntries,
  POLYGON_JOB_RETRY,
  POLYGON_PACKAGE_MAX_BYTES,
  POLYGON_SYNC_PERMISSION,
  POLYGON_QUEUE,
  ProblemDataFilesService,
  ZipError,
} from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import type { CreationTarget } from '../../organizations/creation/organization-creation-rights.service';
import { QuotaService } from '../../organizations/quota/quota.service';
import { maxTestcasesFor } from '../core/dto/limits';
import { assertOrganizationCodePrefix } from '../editing/organization-code-prefix';
import { organizationPeopleWaiver } from '../editing/organization-people';
import { ImportJobResponse } from './dto/import-job.response';
import { importJobView } from './import-job-view';
import {
  unfinishedJob,
  jobsOf,
  queuePositionsOf,
  removeDelayedAutoSync,
  removeFinished,
  unfinishedJobOf,
} from './import-queue';
import type { ImportJob, ImportQueue } from './import-queue';
import { meteredOrganizationOf } from './import-charge';
import { PolygonImportQueryDto } from './dto/problem-import.dto';
import { languageMapOf } from './statement-language-pairs';
import { codeTakenError } from '../editing/problem-edit-fields';
import { rejectFile, saveMultipartFile } from '../core/multipart';
import { ProblemDataStore } from '../data/problem-data.store';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import { ProblemsRepository } from '../core/problems.repository';
import type { ProblemDocument } from '../core/problems.repository';
import { ProblemStorageQuota } from '../quota/problem-storage-quota.service';
import { IMPORT_LIMIT, IMPORT_WINDOW_SECONDS } from '../core/rate-limits';

/** A finished import job stays readable for a day, so the staff member can see its outcome. */
const IMPORT_JOB_KEEP_SECONDS = 24 * 60 * 60;
const IMPORT_JOB_KEEP = { age: IMPORT_JOB_KEEP_SECONDS };

@Injectable()
export class ProblemImportsService {
  constructor(
    private readonly policy: ProblemEditPolicyService,
    private readonly store: ProblemDataStore,
    private readonly repository: ProblemsRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly rateLimit: RateLimitService,
    private readonly storage: ProblemStorageQuota,
    private readonly quota: QuotaService,
    private readonly rights: OrganizationCreationRights,
    @InjectQueue(POLYGON_QUEUE)
    private readonly queue: ImportQueue,
  ) {}

  /** Authorises and resolves everything the worker needs, streams the package to the data volume, checks it is a zip with problem.xml, then enqueues. The worker removes the package when the job ends; here any failure before that does. */
  async start(
    auth: AuthContext,
    query: PolygonImportQueryDto,
    request: FastifyRequest,
  ): Promise<{ jobId: string }> {
    const job = await this.prepare(auth, query);
    await this.reserveImport(auth);
    const jobId = newId();
    const packagePath = await this.dataFiles.importPackagePath(jobId);
    try {
      await saveMultipartFile(request, POLYGON_PACKAGE_MAX_BYTES, packagePath);
      await this.assertPackage(packagePath);
      await this.assertStorage(auth, job, packagePath);
      await this.enqueue(auth, jobId, job);
    } catch (error) {
      await rm(packagePath, { force: true });
      throw error;
    }
    return { jobId };
  }

  /** The checks every import shares (creation rights or a writable problem, free code, references) and the job they resolve; also used by the Polygon import. The caller reserves the rate limit once its own checks passed. */
  async prepare(
    auth: AuthContext,
    query: PolygonImportQueryDto,
  ): Promise<PolygonImportJob> {
    const job = await this.resolveJob(auth, query);
    await this.policy.assertReferences(query);
    return job;
  }

  /** Who may check Polygon links: anyone who may create a problem somewhere, on the site (`judge.add_problem`) or for an organization (the session's `problemCreation`), or link and sync existing ones (`judge.sync_polygon_problem`). */
  async assertMayUsePolygon(
    principal: AuthContext['principal'],
  ): Promise<void> {
    if (
      hasPermission(principal, 'judge.add_problem') ||
      hasPermission(principal, POLYGON_SYNC_PERMISSION) ||
      (await this.rights.createsOrganizationProblems(principal))
    )
      return;
    throw new AppError('forbidden', 403, 'Permission denied');
  }

  /** One import of the user's hourly budget; a Polygon sync spends it too. */
  async reserveImport(auth: AuthContext): Promise<void> {
    await this.rateLimit.reserve(
      [`import:user:${auth.principal.userId}`],
      IMPORT_LIMIT,
      IMPORT_WINDOW_SECONDS,
    );
  }

  /** A create for an organization spends the problem's credits here: refunded here when queueing fails, by the worker (`charge` in the job) when the import fails before it committed. A finished job kept under the same id (a sync of the same package) is replaced. */
  async enqueue(
    auth: AuthContext,
    jobId: string,
    job: PolygonImportJob,
  ): Promise<void> {
    await removeFinished(this.queue, jobId);
    await this.quota.charged(
      job.meteredOrganizationId ?? null,
      { kind: 'problem', userId: auth.principal.userId, ref: job.code },
      (spent) =>
        this.queue.add('import', spent ? { ...job, charge: spent } : job, {
          ...POLYGON_JOB_RETRY,
          jobId,
          removeOnComplete: IMPORT_JOB_KEEP,
          removeOnFail: IMPORT_JOB_KEEP,
        }),
    );
  }

  /** The queued or running sync a manual sync of the same package joins; a delayed automatic one is removed instead, so the manual one never waits for a contest. */
  async joinableSync(jobId: string): Promise<ImportJob | null> {
    const job = await unfinishedJob(this.queue, jobId);
    return job && !(await removeDelayedAutoSync(job)) ? job : null;
  }

  /** The id of the queued or running import (a sync too) into the problem; null when none. */
  async unfinishedJobIdOf(problemId: string): Promise<string | null> {
    return (await unfinishedJobOf(this.queue, problemId))?.id ?? null;
  }

  /** A job the caller may not read gets the same 404 as an unknown id. */
  async status(auth: AuthContext, jobId: string): Promise<ImportJobResponse> {
    const job = await this.queue.getJob(jobId);
    if (!job || !(await this.mayRead(auth.principal, job)))
      throw new AppError('not_found', 404, 'No such import');
    const [state, positions] = await Promise.all([
      job.getState(),
      queuePositionsOf(this.queue),
    ]);
    return importJobView(job, state, positions.get(jobId) ?? null);
  }

  /** The caller's imports and syncs of the last day, running and finished, newest first. */
  async mine(auth: AuthContext): Promise<ImportJobResponse[]> {
    const [jobs, positions] = await Promise.all([
      jobsOf(this.queue, auth.principal.userId),
      queuePositionsOf(this.queue),
    ]);
    return Promise.all(
      jobs.map(async (job) =>
        importJobView(
          job,
          await job.getState(),
          positions.get(job.id ?? '') ?? null,
        ),
      ),
    );
  }

  /** The requester or a superuser; an update (a sync too) also anyone who may import into its problem (found by id, so a code reused after a rename never matches), so the problem's page can follow a sync someone else started. */
  private async mayRead(
    principal: AuthContext['principal'],
    job: ImportJob,
  ): Promise<boolean> {
    if (job.data.requesterId === principal.userId || principal.isSuperuser)
      return true;
    const { mode, problemId } = job.data;
    if (mode !== 'update' || !problemId) return false;
    const problem = await this.repository.findById(problemId);
    if (!problem) return false;
    return this.importableProblem(principal, problem.code).then(
      () => true,
      () => false,
    );
  }

  /** Only the options the user gave are forwarded; the worker applies the defaults of a create and keeps the current value of an update. */
  private async resolveJob(
    auth: AuthContext,
    query: PolygonImportQueryDto,
  ): Promise<PolygonImportJob> {
    const { principal } = auth;
    const options = requestedOptions(principal, query);
    if (query.mode === 'update') {
      const problem = await this.importableProblem(principal, query.code);
      this.assertPeopleGates(principal, query, problem.toJSON());
      return {
        ...options,
        curators: uniqueIfAny(query.curators),
        problemId: problem._id,
        isFullMarkup: problem.isFullMarkup,
        expectedDataVersion: problem.dataVersion ?? 0,
      };
    }
    const target = await this.creationTarget(principal, query);
    this.assertPeopleGates(
      principal,
      query,
      { authors: [], curators: [principal.userId] },
      target,
    );
    if (await this.isCodeTaken(query.code)) throw codeTakenError();
    const organizationId = target?.id ?? null;
    const metered = meteredOrganizationOf(principal, organizationId);
    return {
      ...options,
      ...(organizationId && { organizationId }),
      ...(metered && { meteredOrganizationId: metered }),
      curators: unique([...(query.curators ?? []), principal.userId]),
      isFullMarkup: false,
    };
  }

  /** Authors and curators are staff fields (`judge.edit_all_problem`), as in the editor: without it a request may only repeat their `current` value (the stored problem, or a new problem's requester-only curators), or, creating for an `organization`, name its administrators (`organizationPeopleWaiver`). */
  private assertPeopleGates(
    principal: AuthContext['principal'],
    query: PolygonImportQueryDto,
    current: Record<string, unknown>,
    organization: CreationTarget | null = null,
  ): void {
    const people = {
      authors: uniqueIfAny(query.authors),
      curators: uniqueIfAny(query.curators),
    };
    const waived = organization
      ? organizationPeopleWaiver(principal, organization, people)
      : [];
    this.policy.assertFieldGates(principal, people, people, {
      baseline: current,
      waived,
    });
  }

  /** Who may create, as `POST /problems` or `POST /organizations/{slug}/problems`: the organization (its rights and code prefix checked), or null for a site problem (`judge.add_problem`). */
  private async creationTarget(
    principal: AuthContext['principal'],
    query: PolygonImportQueryDto,
  ): Promise<CreationTarget | null> {
    if (query.organization !== undefined) {
      const target = await this.rights.problemTarget(
        principal,
        query.organization,
      );
      assertOrganizationCodePrefix(principal, query.code, target.codePrefix);
      return target;
    }
    if (!hasPermission(principal, 'judge.add_problem'))
      throw new AppError(
        'forbidden',
        403,
        'Creating a problem requires judge.add_problem',
      );
    return null;
  }

  /** An existing problem an import may overwrite: writable test data, and statement text on a full-markup problem needs `judge.problem_full_markup`. */
  async importableProblem(
    principal: AuthContext['principal'],
    code: string,
  ): Promise<ProblemDocument> {
    const problem = await this.store.writableProblem(principal, code);
    if (
      problem.isFullMarkup &&
      !hasPermission(principal, 'judge.problem_full_markup')
    )
      throw new AppError(
        'forbidden',
        403,
        'Full markup requires judge.problem_full_markup',
      );
    return problem;
  }

  /** Live, deleted (restorable) and purged codes are all taken; a purge removes the data directory, so the tombstone row is what blocks the code. */
  private async isCodeTaken(code: string): Promise<boolean> {
    return Boolean(
      (await this.repository.findByCode(code)) ||
      (await this.repository.findDeletedByCode(code)) ||
      (await this.dataFiles.exists(code)),
    );
  }

  /** An import into an organization problem must fit its organization's storage: the package size against what the problem holds now (nothing for a create). The zip is compressed, so its size is a lower bound of the extracted data and the check can under-count. Data costs no credits here (a create pays the problem price in `enqueue`) because the job's outcome is unknown. No storage warning follows an import either: the worker has no quota service, and the next API upload warns. */
  private async assertStorage(
    auth: AuthContext,
    job: PolygonImportJob,
    packagePath: string,
  ): Promise<void> {
    const packageBytes = (await stat(packagePath)).size;
    if (job.mode === 'create') {
      await this.storage.assertFits(job.meteredOrganizationId ?? null, {
        addedBytes: packageBytes,
      });
      return;
    }
    const problem = await this.store.writableProblem(auth.principal, job.code);
    await this.storage.assertFits(
      this.storage.organizationOf(auth.principal, problem),
      { addedBytes: packageBytes - problem.dataBytes },
    );
  }

  private async assertPackage(packagePath: string): Promise<void> {
    try {
      if (!(await listZipEntries(packagePath)).includes('problem.xml'))
        throw rejectFile(
          'The package has no problem.xml at its root.',
          'no_problem_xml',
        );
    } catch (error) {
      throw error instanceof ZipError
        ? rejectFile(error.message, error.code)
        : error;
    }
  }
}

/** An empty list means "not given" (the link import sends `[]` for untouched pickers), so an update keeps the current value. */
const uniqueIfAny = (ids?: string[]) => (ids?.length ? unique(ids) : undefined);

/** The options every import job carries, as the user gave them. */
const requestedOptions = (
  principal: AuthContext['principal'],
  query: PolygonImportQueryDto,
) => ({
  requesterId: principal.userId,
  code: query.code,
  mode: query.mode,
  authors: uniqueIfAny(query.authors),
  groupId: query.groupId,
  typeIds: uniqueIfAny(query.typeIds),
  points: query.points,
  mainStatementLanguage: query.mainStatementLanguage ?? null,
  statementLanguages: languageMapOf(query.statementLanguages ?? []),
  tutorialLanguage: query.tutorialLanguage ?? null,
  ignoreZeroPointBatches: query.ignoreZeroPointBatches,
  ignoreZeroPointCases: query.ignoreZeroPointCases,
  appendMainSolution: query.appendMainSolution,
  importTutorial: query.importTutorial,
  maxCases: maxTestcasesFor(principal),
});
