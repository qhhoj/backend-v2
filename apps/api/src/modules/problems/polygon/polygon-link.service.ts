import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import type { PolygonLink } from '@libs/database';
import { latestPackageOf, PolygonClient } from '@libs/problems';
import type {
  ImportErrorParams,
  LinkedProblem,
  PolygonImportErrorCode,
} from '@libs/problems';
import type { ProblemDocument } from '../core/problems.repository';
import { RevisionsRepository } from '../core/revisions.repository';
import { ProblemImportsService } from '../imports/problem-imports.service';
import {
  PolygonLinkResponse,
  PolygonLinkStateResponse,
} from './dto/polygon-link.response';
import { PolygonLinksRepository } from './polygon-links.repository';

/** The problem as a plain object with its link (a subdocument cannot be spread into a job), or 404 `polygon_not_linked`. */
export function linkedProblem(problem: ProblemDocument): LinkedProblem {
  const plain = problem.toObject({ getters: true });
  if (!plain.polygonLink)
    throw new AppError(
      'polygon_not_linked',
      404,
      'The problem is not linked to Polygon',
    );
  return plain as LinkedProblem;
}

const linkChanged = () =>
  new AppError('conflict', 409, 'The Polygon link changed meanwhile');

/** Reads and edits the link of a problem; the problem's content is never touched here. */
@Injectable()
export class PolygonLinkService {
  constructor(
    private readonly imports: ProblemImportsService,
    private readonly links: PolygonLinksRepository,
    private readonly revisions: RevisionsRepository,
    private readonly polygon: PolygonClient,
  ) {}

  /** The link, Polygon's newest package and the import or sync running on the problem; a Polygon failure only blanks the package, the panel still shows the link. */
  async state(
    auth: AuthContext,
    code: string,
  ): Promise<PolygonLinkStateResponse> {
    const { polygonLink } = linkedProblem(await this.problemOf(auth, code));
    const [latestPackage, runningJobId] = await Promise.all([
      this.polygon
        .packages(polygonLink.problemId)
        .then(latestPackageOf)
        .catch(() => null),
      this.imports.unfinishedJobIdOf(code),
    ]);
    return { link: linkView(polygonLink), latestPackage, runningJobId };
  }

  /** Switching auto-sync on makes the caller the user it runs as, so the worker re-checks their rights; a repeated switch changes nothing. */
  async setAutoSync(
    auth: AuthContext,
    code: string,
    autoSync: boolean,
  ): Promise<PolygonLinkResponse> {
    const problem = await this.problemOf(auth, code);
    const { polygonLink } = linkedProblem(problem);
    const runAs =
      autoSync && !polygonLink.autoSync ? auth.principal.userId : undefined;
    if (
      !(await this.links.setAutoSync(
        problem._id,
        polygonLink.problemId,
        autoSync,
        runAs,
      ))
    )
      throw linkChanged();
    await this.audit(auth, problem, {
      'polygonLink.autoSync': { before: polygonLink.autoSync, after: autoSync },
      ...(runAs && {
        'polygonLink.linkedBy': { before: polygonLink.linkedBy, after: runAs },
      }),
    });
    return linkView({ ...polygonLink, autoSync });
  }

  /** Removes the link only: statement, tests and every other field stay as the last sync left them. */
  async unlink(auth: AuthContext, code: string): Promise<void> {
    const problem = await this.problemOf(auth, code);
    const { polygonLink } = linkedProblem(problem);
    if (!(await this.links.unlink(problem._id, polygonLink.problemId)))
      throw linkChanged();
    await this.audit(auth, problem, {
      polygonLink: {
        before: {
          problemId: polygonLink.problemId,
          revision: polygonLink.revision,
        },
        after: null,
      },
    });
  }

  /** Link routes need the same access as an import over the problem; the controller adds `judge.sync_polygon_problem` where the route changes something. */
  private problemOf(auth: AuthContext, code: string): Promise<ProblemDocument> {
    return this.imports.importableProblem(auth.principal, code);
  }

  private async audit(
    auth: AuthContext,
    problem: ProblemDocument,
    changes: Record<string, { before: unknown; after: unknown }>,
  ): Promise<void> {
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: 'polygon_link',
      userId: auth.principal.userId,
      changes,
      comment: '',
    });
  }
}

const linkView = (link: PolygonLink): PolygonLinkResponse => ({
  problemId: link.problemId,
  name: link.name,
  owner: link.owner,
  revision: link.revision,
  packageId: link.packageId,
  packageCreatedAt: link.packageCreatedAt ?? null,
  title: link.title ?? null,
  linkedAt: link.linkedAt,
  lastSyncAt: link.lastSyncAt,
  lastSyncResult: link.lastSyncResult,
  lastSyncError: link.lastSyncError,
  lastSyncErrorCode: (link.lastSyncErrorCode ??
    null) as PolygonImportErrorCode | null,
  // An empty object is not stored (Mongoose minimizes it).
  lastSyncErrorParams: link.lastSyncErrorCode
    ? ((link.lastSyncErrorParams ?? {}) as ImportErrorParams)
    : null,
  autoSync: link.autoSync,
});
