import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { FileHandle } from 'node:fs/promises';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import {
  PACKAGE_JOB,
  PACKAGE_QUEUE,
  PACKAGE_TOO_LARGE_REASON,
  PackageCacheService,
  packageJobId,
  packageKey,
} from '@libs/problems';
import type { ProblemPackageJob } from '@libs/problems';
import { ProblemsRepository } from '../core/problems.repository';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import type { PackageStatusResponse } from './dto/package-status.response';
import {
  PACKAGE_FAIL_KEEP_SECONDS,
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
    private readonly rateLimit: RateLimitService,
    @InjectQueue(PACKAGE_QUEUE)
    private readonly queue: Queue<ProblemPackageJob>,
  ) {}

  /** The editor asks for the package of the problem as it is now: ready if cached, else one build per problem and key. Counted against the hourly budget either way. */
  async request(
    auth: AuthContext,
    code: string,
  ): Promise<PackageStatusResponse> {
    const target = await this.targetOf(auth.principal, code);
    await this.rateLimit.reserve(
      [`package:user:${auth.principal.userId}:${target.code}`],
      PACKAGE_LIMIT,
      PACKAGE_WINDOW_SECONDS,
    );
    await this.rateLimit.reserve(
      [`package:user:${auth.principal.userId}`],
      PACKAGE_USER_LIMIT,
      PACKAGE_WINDOW_SECONDS,
    );
    if (await this.packages.has(target.code, target.key))
      return { status: 'ready', key: target.key };
    await this.enqueue(target.code, target.key);
    return { status: 'building', key: target.key };
  }

  /** The cached file for the problem as it is now, or why there is none yet. */
  async locate(principal: Principal, code: string): Promise<PackageLocation> {
    const target = await this.targetOf(principal, code);
    const file = await this.packages.open(target.code, target.key);
    if (file) return { status: 'ready', file, filename: `${target.code}.zip` };
    const job = await this.queue.getJob(packageJobId(target.code, target.key));
    if (!job)
      throw new AppError('package_not_built', 404, 'Request the package first');
    if (!(await job.isFailed())) return { status: 'building' };
    this.assertNotTooLarge(job);
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
    return { code: full.code, key: packageKey(full) };
  }

  /** A pending or active build is shared; a failed one is removed so this request tries again (an over-cap one stays a 409). */
  private async enqueue(code: string, key: string): Promise<void> {
    const jobId = packageJobId(code, key);
    const previous = await this.queue.getJob(jobId);
    if (previous) {
      if (!(await previous.isFailed())) return;
      this.assertNotTooLarge(previous);
      await previous.remove();
    }
    await this.queue.add(
      PACKAGE_JOB,
      { code, key },
      {
        jobId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: PACKAGE_FAIL_KEEP_SECONDS },
      },
    );
  }

  private assertNotTooLarge(job: Job<ProblemPackageJob>): void {
    if (job.failedReason === PACKAGE_TOO_LARGE_REASON)
      throw new AppError(
        'package_too_large',
        409,
        'The package is over the size limit and cannot be built',
      );
  }
}
