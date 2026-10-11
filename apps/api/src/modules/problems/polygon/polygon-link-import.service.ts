import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { newId } from '@libs/database';
import { PolygonClient, syncJobOf } from '@libs/problems';
import { maxTestcasesFor } from '../core/dto/limits';
import { ImportJobStartedResponse } from '../imports/dto/import-job-started.response';
import { ProblemImportsService } from '../imports/problem-imports.service';
import { PolygonLinkImportDto } from './dto/polygon-problems.dto';
import { askPolygon } from './polygon-errors';
import { linkedProblem } from './polygon-link.service';
import {
  PolygonLinkResolver,
  readyFullPackage,
} from './polygon-link-resolver.service';
import type { ReadyPackage } from './polygon-link-resolver.service';

/** Starts the zip import's job on a package the worker downloads from Polygon: a first import (link) or a sync. */
@Injectable()
export class PolygonLinkImportService {
  constructor(
    private readonly polygon: PolygonClient,
    private readonly imports: ProblemImportsService,
    private readonly resolver: PolygonLinkResolver,
  ) {}

  /** The zip import's checks first (permission, code, references), then the link's (see `PolygonLinkResolver.resolve`). The problem is created private, with the importer as curator. */
  async importProblem(
    auth: AuthContext,
    { link, ...body }: PolygonLinkImportDto,
  ): Promise<ImportJobStartedResponse> {
    const job = await this.imports.prepare(auth, body);
    const { problem, latest } = await this.resolver.resolve(
      auth,
      link,
      body.code,
    );
    await this.imports.reserveImport(auth);
    const jobId = newId();
    await this.imports.enqueue(jobId, {
      ...job,
      polygon: {
        problemId: problem.id,
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

  private async readyPackage(polygonId: number): Promise<ReadyPackage> {
    return readyFullPackage(
      polygonId,
      await askPolygon(() => this.polygon.packages(polygonId)),
    );
  }
}
