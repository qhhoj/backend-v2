import { Injectable } from '@nestjs/common';
import type { FileHandle } from 'node:fs/promises';
import type { AuthContext, Principal } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  InjectJob,
  onDemandState,
} from '@libs/common';
import type { JobProducer, OnDemandState } from '@libs/common';
import {
  PACKAGE_DATA_UNSAVED,
  PACKAGE_DATA_WRITING,
  PACKAGE_TOO_LARGE,
  PackageCacheService,
  PdfCacheService,
  packageKey,
  ProblemDataFilesService,
  problemJobs,
} from '@libs/problems';
import type { ProblemPackageJob } from '@libs/problems';
import { ProblemsRepository } from '../core/problems.repository';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import type { PackageStatusResponse } from './dto/package-status.response';
import { PackageBudget } from './package-budget';

/** Builds refused for the test data's state, not for the request: the requests spent on them are given back. */
const DATA_FAILURES: ReadonlyArray<string | null> = [
  PACKAGE_DATA_WRITING,
  PACKAGE_DATA_UNSAVED,
];
const UNSAVED_MESSAGE =
  'The last test-data save did not finish; save the test data again.';

/** The problem's package target (`code`, content `key`) and the `dataVersion` the key was computed from. */
interface PackageTarget extends ProblemPackageJob {
  dataVersion: number;
}

/** `file` is open and owned by the caller. */
export type PackageLocation =
  | { status: 'ready'; file: FileHandle; filename: string }
  | { status: 'building' };

const RETRY_AFTER_SECONDS = '30';

@Injectable()
export class ProblemPackageService {
  constructor(
    private readonly policy: ProblemEditPolicyService,
    private readonly problems: ProblemsRepository,
    private readonly packages: PackageCacheService,
    private readonly pdfCache: PdfCacheService,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly budget: PackageBudget,
    @InjectJob(problemJobs.package)
    private readonly builds: JobProducer<ProblemPackageJob>,
  ) {}

  /** The editor asks for the package of the problem as it is now: ready if cached, else one build per problem and key. Counted against the hourly budget either way, except an unfinished data save (409 `conflict`, issue `data_save_unfinished`), refused before spending; a build later refused for the data's state gives the request back. */
  async request(
    auth: AuthContext,
    code: string,
  ): Promise<PackageStatusResponse> {
    const target = await this.targetOf(auth.principal, code);
    if (
      (await this.dataFiles.dataState(target.code, target.dataVersion)) ===
      'unsaved'
    )
      throw conflictIssue('data', 'data_save_unfinished', UNSAVED_MESSAGE);
    await this.budget.spend(auth.principal.userId, target.code);
    if (await this.packages.has(target.code, target.key))
      return { status: 'ready', key: target.key };
    await this.enqueue(target);
    await this.budget.recordSpender(buildOf(target), auth.principal.userId);
    return { status: 'building', key: target.key };
  }

  /** The cached file for the problem as it is now, or why there is none yet. */
  async locate(principal: Principal, code: string): Promise<PackageLocation> {
    const target = await this.targetOf(principal, code);
    const file = await this.packages.open(target.code, target.key);
    if (file) return { status: 'ready', file, filename: `${target.code}.zip` };
    const state = await onDemandState(this.builds, buildOf(target));
    if (state.status === 'none')
      throw new AppError('package_not_built', 404, 'Request the package first');
    if (state.status === 'building') return { status: 'building' };
    assertNotTooLarge(state);
    await this.refundDataFailure(target, state);
    if (state.failure === PACKAGE_DATA_UNSAVED)
      throw new AppError('package_data_unsaved', 409, UNSAVED_MESSAGE);
    throw new AppError(
      'package_unavailable',
      503,
      'The package could not be built; try again later',
      undefined,
      { 'Retry-After': RETRY_AFTER_SECONDS, 'Cache-Control': 'no-store' },
    );
  }

  /** The editor's problem and the content key of what it is now. The key covers the test cases, which `select: false` keeps out of the usual read, so the data is loaded for it. */
  private async targetOf(
    principal: Principal,
    code: string,
  ): Promise<PackageTarget> {
    const visible = await this.policy.editableProblem(principal, code);
    const full =
      (await this.problems.findByCodeWithData(visible.code)) ?? visible;
    return {
      code: full.code,
      key: packageKey(full, await this.pdfCache.listing(full.code)),
      dataVersion: full.dataVersion ?? 0,
    };
  }

  /** A pending or active build is shared; a failed one is replaced so this request tries again (an over-cap one stays a 409). */
  private async enqueue(target: PackageTarget): Promise<void> {
    const build = buildOf(target);
    const state = await onDemandState(this.builds, build);
    if (state.status === 'building') return;
    assertNotTooLarge(state);
    await this.refundDataFailure(target, state);
    await this.builds.addReplacingFailed(build);
  }

  /** A build refused for the test data's state gives back the requests spent on it (once: the record goes with the refund). */
  private async refundDataFailure(
    target: PackageTarget,
    state: OnDemandState,
  ): Promise<void> {
    if (state.status === 'failed' && DATA_FAILURES.includes(state.failure))
      await this.budget.refund(buildOf(target));
  }
}

const buildOf = ({ code, key }: PackageTarget): ProblemPackageJob => ({
  code,
  key,
});

function assertNotTooLarge(state: OnDemandState): void {
  if (state.status === 'failed' && state.failure === PACKAGE_TOO_LARGE)
    throw new AppError(
      'package_too_large',
      409,
      'The package is over the size limit and cannot be built',
    );
}
