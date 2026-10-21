import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import { newId } from '@libs/database';
import {
  POLYGON_SYNC_PERMISSION,
  PolygonClient,
  syncJobId,
  syncJobOf,
} from '@libs/problems';
import type { ReadyPackage } from '@libs/problems';
import { ImportJobStartedResponse } from '../imports/dto/import-job-started.response';
import { ProblemImportsService } from '../imports/problem-imports.service';
import { PolygonLinkImportDto } from './dto/polygon-problems.dto';
import { askPolygon } from './polygon-errors';
import { linkedProblem } from './polygon-link.service';
import { assertOptionsFit } from './polygon-options-fit';
import {
  PolygonLinkResolver,
  readyPackage,
} from './polygon-link-resolver.service';

/** Starts the zip import's job on a package the worker downloads from Polygon: a first import (link) or a sync. */
@Injectable()
export class PolygonLinkImportService {
  constructor(
    private readonly polygon: PolygonClient,
    private readonly imports: ProblemImportsService,
    private readonly resolver: PolygonLinkResolver,
  ) {}

  /** The zip import's checks first (permission, code, references), then the link's (see `PolygonLinkResolver.resolve`). The problem is created private, with the importer as curator (and private to the organization the body names). */
  async importProblem(
    auth: AuthContext,
    { link, ...body }: PolygonLinkImportDto,
  ): Promise<ImportJobStartedResponse> {
    assertMayChangeLink(auth, body.autoSync || body.mode === 'update');
    const job = await this.imports.prepare(auth, body);
    const { problem, latest } = await this.resolver.resolve(
      auth,
      link,
      body.code,
    );
    await assertOptionsFit(this.polygon, problem.id, job);
    await this.imports.reserveImport(auth);
    const jobId = newId();
    await this.imports.enqueue(auth, jobId, {
      ...job,
      polygon: {
        problemId: problem.id,
        name: problem.name,
        owner: problem.owner,
        revision: latest.revision,
        packageId: latest.id,
        packageType: latest.type,
        packageCreatedAt: latest.createdAt,
        purpose: 'link',
        autoSync: body.autoSync,
        trigger: 'manual',
      },
    });
    return { jobId };
  }

  /** Re-applies the newest READY package (full or standard; even the one already synced: a manual sync is also a repair) with the link's options. A sync of that package already queued or running (manual or automatic) is answered with its job instead of a second one, and spends nothing. */
  async sync(
    auth: AuthContext,
    code: string,
  ): Promise<ImportJobStartedResponse> {
    const document = await this.imports.importableProblem(auth.principal, code);
    const problem = linkedProblem(document);
    const latest = await this.latestReadyOf(problem.polygonLink.problemId);
    const jobId = syncJobId(document._id, latest.id);
    if (await this.imports.isUnfinished(jobId)) return { jobId };
    await assertOptionsFit(
      this.polygon,
      problem.polygonLink.problemId,
      problem.polygonLink.options,
    );
    await this.imports.reserveImport(auth);
    await this.imports.enqueue(
      auth,
      jobId,
      syncJobOf(problem, latest, {
        userId: auth.principal.userId,
        trigger: 'manual',
      }),
    );
    return { jobId };
  }

  private async latestReadyOf(polygonId: number): Promise<ReadyPackage> {
    return readyPackage(
      polygonId,
      await askPolygon(() => this.polygon.packages(polygonId)),
    );
  }
}

/** Auto-sync runs as the linking user and needs the sync permission on every run (the worker re-checks it), and an update replaces the problem's link, so both need it; an importer without it creates a linked problem with `autoSync` false. */
function assertMayChangeLink(auth: AuthContext, changesLink: boolean): void {
  if (changesLink && !hasPermission(auth.principal, POLYGON_SYNC_PERMISSION))
    throw new AppError(
      'forbidden',
      403,
      `Auto-sync and linking an existing problem require ${POLYGON_SYNC_PERMISSION}`,
    );
}
