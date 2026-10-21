import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import type { PolygonImportOptions, PolygonLink } from '@libs/database';
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
  languageMapOf,
  languagePairsOf,
} from '../imports/statement-language-pairs';
import { UpdatePolygonLinkDto } from './dto/polygon-link.dto';
import {
  PolygonLinkOptionsResponse,
  PolygonLinkResponse,
  PolygonLinkStateResponse,
} from './dto/polygon-link.response';
import { PolygonLinksRepository } from './polygon-links.repository';
import { assertOptionsFit } from './polygon-options-fit';

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

  /** Saves the fields the body names; switching auto-sync on makes the caller the user it runs as, so the worker re-checks their rights. Changed statement or test options are checked against Polygon first, as a sync would check them. Nothing changed writes nothing. */
  async update(
    auth: AuthContext,
    code: string,
    body: UpdatePolygonLinkDto,
  ): Promise<PolygonLinkResponse> {
    const problem = await this.problemOf(auth, code);
    const { polygonLink } = linkedProblem(problem);
    const next = nextLinkOf(polygonLink, body, auth.principal.userId);
    const changes = linkChangesOf(polygonLink, next);
    const paths = Object.keys(changes);
    if (paths.length === 0) return linkView(polygonLink);
    if (paths.some((path) => path.startsWith(OPTIONS_PATH)))
      await assertOptionsFit(this.polygon, polygonLink.problemId, next.options);
    const fields = Object.fromEntries(
      paths.map((path) => [path, changes[path].after]),
    );
    if (!(await this.links.update(problem._id, polygonLink.problemId, fields)))
      throw linkChanged();
    await this.audit(auth, problem, changes);
    return linkView(next);
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
    changes: Changes,
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

type Changes = Record<string, { before: unknown; after: unknown }>;
const OPTIONS_PATH = 'polygonLink.options.';

/** The link as the body leaves it; an omitted (undefined) field keeps its value. */
function nextLinkOf(
  link: PolygonLink,
  body: UpdatePolygonLinkDto,
  userId: string,
): PolygonLink {
  const { autoSync, statementLanguages, ...options } = body;
  const given = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  );
  return {
    ...link,
    autoSync: autoSync ?? link.autoSync,
    linkedBy: autoSync && !link.autoSync ? userId : link.linkedBy,
    options: {
      ...link.options,
      ...given,
      ...(statementLanguages && {
        statementLanguages: languageMapOf(statementLanguages),
      }),
    },
  };
}

/** The `polygonLink.*` paths whose value differs, with both values, for the update and its revision. */
function linkChangesOf(before: PolygonLink, after: PolygonLink): Changes {
  const options = Object.keys(after.options) as (keyof PolygonImportOptions)[];
  const compared: [string, unknown, unknown][] = [
    ['polygonLink.autoSync', before.autoSync, after.autoSync],
    ['polygonLink.linkedBy', before.linkedBy, after.linkedBy],
    ...options.map((key): [string, unknown, unknown] => [
      `${OPTIONS_PATH}${key}`,
      before.options[key],
      after.options[key],
    ]),
  ];
  return Object.fromEntries(
    compared
      .filter(([, old, value]) => !isDeepStrictEqual(old, value))
      .map(([path, old, value]) => [path, { before: old, after: value }]),
  );
}

const optionsView = ({
  statementLanguages,
  ...options
}: PolygonImportOptions): PolygonLinkOptionsResponse => ({
  mainStatementLanguage: options.mainStatementLanguage ?? null,
  statementLanguages: languagePairsOf(statementLanguages ?? {}),
  tutorialLanguage: options.tutorialLanguage ?? null,
  ignoreZeroPointBatches: options.ignoreZeroPointBatches,
  ignoreZeroPointCases: options.ignoreZeroPointCases,
  appendMainSolution: options.appendMainSolution,
  maxCases: options.maxCases,
});

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
  options: optionsView(link.options),
});
