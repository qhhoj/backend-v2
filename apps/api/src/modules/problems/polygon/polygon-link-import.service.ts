import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import { newId } from '@libs/database';
import {
  latestPackageOf,
  packageNotReadyReason,
  PolygonClient,
  syncJobOf,
} from '@libs/problems';
import type { LatestPackage, PolygonProblem } from '@libs/problems';
import { maxTestcasesFor } from '../core/dto/limits';
import { ImportJobStartedResponse } from '../imports/dto/import-job-started.response';
import { ProblemImportsService } from '../imports/problem-imports.service';
import { PolygonLinkImportDto } from './dto/polygon-problems.dto';
import { askPolygon, packageNotReady } from './polygon-errors';
import { PolygonLinksRepository } from './polygon-links.repository';
import { linkedProblem } from './polygon-link.service';

type ReadyPackage = LatestPackage & { id: number; revision: number };

/** Starts the zip import's job on a package the worker downloads from Polygon: a first import (link) or a sync. */
@Injectable()
export class PolygonLinkImportService {
  constructor(
    private readonly polygon: PolygonClient,
    private readonly imports: ProblemImportsService,
    private readonly links: PolygonLinksRepository,
  ) {}

  /** The zip import's checks first (permission, code, references), then Polygon's: shared, not linked yet, newest full package READY. */
  async importProblem(
    auth: AuthContext,
    polygonId: number,
    body: PolygonLinkImportDto,
  ): Promise<ImportJobStartedResponse> {
    const job = await this.imports.prepare(auth, body);
    const problem = await this.sharedProblem(polygonId);
    await this.assertNotLinked(polygonId, body.code);
    const latest = await this.readyPackage(polygonId);
    await this.imports.reserveImport(auth);
    const jobId = newId();
    await this.imports.enqueue(jobId, {
      ...job,
      polygon: {
        problemId: polygonId,
        name: problem.name,
        owner: problem.owner,
        revision: latest.revision,
        packageId: latest.id,
        packageCreatedAt: latest.createdAt,
        purpose: 'link',
        autoSync: body.autoSync,
        trigger: 'manual',
      },
    });
    return { jobId };
  }

  /** Re-applies the newest READY full package (even the one already synced: a manual sync is also a repair) with the link's options. */
  async sync(
    auth: AuthContext,
    code: string,
  ): Promise<ImportJobStartedResponse> {
    const problem = linkedProblem(
      await this.imports.importableProblem(auth.principal, code),
    );
    const latest = await this.readyPackage(problem.polygonLink.problemId);
    await this.imports.reserveImport(auth);
    const jobId = newId();
    await this.imports.enqueue(
      jobId,
      syncJobOf(problem, latest, {
        userId: auth.principal.userId,
        maxCases: maxTestcasesFor(auth.principal),
        trigger: 'manual',
      }),
    );
    return { jobId };
  }

  private async sharedProblem(polygonId: number): Promise<PolygonProblem> {
    const problem = await askPolygon(() => this.polygon.problem(polygonId));
    if (!problem || problem.deleted)
      throw new AppError(
        'not_found',
        404,
        'No such Polygon problem shared with the QHHOJ account',
      );
    return problem;
  }

  /** One QHHOJ problem per Polygon problem; re-linking the same problem (an update import) is allowed. */
  private async assertNotLinked(
    polygonId: number,
    code: string,
  ): Promise<void> {
    const linkedCode = (await this.links.codesByPolygonId([polygonId])).get(
      polygonId,
    );
    if (linkedCode !== undefined && linkedCode !== code)
      throw new AppError(
        'polygon_already_linked',
        409,
        `Polygon problem ${polygonId} is already linked to ${linkedCode}`,
      );
  }

  private async readyPackage(polygonId: number): Promise<ReadyPackage> {
    const packages = await askPolygon(() => this.polygon.packages(polygonId));
    const latest = latestPackageOf(packages);
    if (
      latest.state !== 'READY' ||
      latest.id === null ||
      latest.revision === null
    )
      throw packageNotReady(polygonId, packageNotReadyReason(packages));
    return latest as ReadyPackage;
  }
}
