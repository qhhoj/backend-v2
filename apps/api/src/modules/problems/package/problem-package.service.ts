import { Injectable } from '@nestjs/common';
import type { FileHandle } from 'node:fs/promises';
import type { AuthContext, Principal } from '@libs/auth';
import {
  AppError,
  InjectJob,
  onDemandState,
  RateLimitService,
} from '@libs/common';
import type { JobProducer, OnDemandState } from '@libs/common';
import {
  PACKAGE_TOO_LARGE,
  PackageCacheService,
  PdfCacheService,
  packageKey,
  problemJobs,
} from '@libs/problems';
import type { ProblemPackageJob } from '@libs/problems';
import { ProblemsRepository } from '../core/problems.repository';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import type { PackageStatusResponse } from './dto/package-status.response';
import {
  PACKAGE_LIMIT,
  PACKAGE_USER_LIMIT,
  PACKAGE_WINDOW_SECONDS,
} from './package-rate-limits';

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
    private readonly rateLimit: RateLimitService,
    @InjectJob(problemJobs.package)
    private readonly builds: JobProducer<ProblemPackageJob>,
  ) {}

  /** The editor asks for the package of the problem as it is now: ready if cached, else one build per problem and key. Counted against the hourly budget either way. */
  async request(
    auth: AuthContext,
    code: string,
  ): Promise<PackageStatusResponse> {
    const target = await this.targetOf(auth.principal, code);
    await this.reserveBudget(auth.principal.userId, target.code);
    if (await this.packages.has(target.code, target.key))
      return { status: 'ready', key: target.key };
    await this.enqueue(target);
    return { status: 'building', key: target.key };
  }

  /** The per-user budget first, then the per-problem one; a refusal by either leaves the other budget as it was, so a refused request costs the editor nothing but the counter that refused it. */
  private async reserveBudget(userId: string, code: string): Promise<void> {
    const releaseUser = await this.rateLimit.reserve(
      [`package:user:${userId}`],
      PACKAGE_USER_LIMIT,
      PACKAGE_WINDOW_SECONDS,
    );
    try {
      await this.rateLimit.reserve(
        [`package:user:${userId}:${code}`],
        PACKAGE_LIMIT,
        PACKAGE_WINDOW_SECONDS,
      );
    } catch (error) {
      await releaseUser();
      throw error;
    }
  }

  /** The cached file for the problem as it is now, or why there is none yet. */
  async locate(principal: Principal, code: string): Promise<PackageLocation> {
    const target = await this.targetOf(principal, code);
    const file = await this.packages.open(target.code, target.key);
    if (file) return { status: 'ready', file, filename: `${target.code}.zip` };
    const state = await onDemandState(this.builds, target);
    if (state.status === 'none')
      throw new AppError('package_not_built', 404, 'Request the package first');
    if (state.status === 'building') return { status: 'building' };
    assertNotTooLarge(state);
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
  ): Promise<{ code: string; key: string }> {
    const visible = await this.policy.editableProblem(principal, code);
    const full =
      (await this.problems.findByCodeWithData(visible.code)) ?? visible;
    return {
      code: full.code,
      key: packageKey(full, await this.pdfCache.listing(full.code)),
    };
  }

  /** A pending or active build is shared; a failed one is replaced so this request tries again (an over-cap one stays a 409). */
  private async enqueue(build: ProblemPackageJob): Promise<void> {
    const state = await onDemandState(this.builds, build);
    if (state.status === 'building') return;
    assertNotTooLarge(state);
    await this.builds.addReplacingFailed(build);
  }
}

function assertNotTooLarge(state: OnDemandState): void {
  if (state.status === 'failed' && state.failure === PACKAGE_TOO_LARGE)
    throw new AppError(
      'package_too_large',
      409,
      'The package is over the size limit and cannot be built',
    );
}
