import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import { newId } from '@libs/database';
import { PolygonClient, syncJobOf } from '@libs/problems';
import type { ReadyPackage } from '@libs/problems';
import { maxTestcasesFor } from '../core/dto/limits';
import { ImportJobStartedResponse } from '../imports/dto/import-job-started.response';
import { ProblemImportsService } from '../imports/problem-imports.service';
import { PolygonLinkImportDto } from './dto/polygon-problems.dto';
import { askPolygon } from './polygon-errors';
import { linkedProblem } from './polygon-link.service';
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
    assertMaySync(auth, body.autoSync);
    const job = await this.imports.prepare(auth, body);
    const { problem, latest } = await this.resolver.resolve(
      auth,
      link,
      body.code,
    );
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

  /** Re-applies the newest READY package (full or standard; even the one already synced: a manual sync is also a repair) with the link's options. */
  async sync(
    auth: AuthContext,
    code: string,
  ): Promise<ImportJobStartedResponse> {
    const problem = linkedProblem(
      await this.imports.importableProblem(auth.principal, code),
    );
    const latest = await this.latestReadyOf(problem.polygonLink.problemId);
    await this.imports.reserveImport(auth);
    const jobId = newId();
    await this.imports.enqueue(
      auth,
      jobId,
      syncJobOf(problem, latest, {
        userId: auth.principal.userId,
        maxCases: maxTestcasesFor(auth.principal),
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

/** Auto-sync runs as the linking user and needs `judge.import_polygon_package` on every run (the worker re-checks it), so an organization creator without it may not turn it on. */
function assertMaySync(auth: AuthContext, autoSync: boolean): void {
  if (
    autoSync &&
    !hasPermission(auth.principal, 'judge.import_polygon_package')
  )
    throw new AppError(
      'forbidden',
      403,
      'Auto-sync requires judge.import_polygon_package',
    );
}
