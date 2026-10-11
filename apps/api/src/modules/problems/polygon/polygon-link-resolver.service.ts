import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type Redis from 'ioredis';
import type { AuthContext } from '@libs/auth';
import { RateLimitService, REDIS } from '@libs/common';
import { newId } from '@libs/database';
import {
  latestPackageOf,
  linkTokenOfPackage,
  newestReadyPackageId,
  packageNotReadyReason,
  parsePolygonLink,
  POLYGON_PACKAGE_MAX_BYTES,
  PolygonClient,
  ProblemDataFilesService,
  statementTitleOf,
  XmlError,
  ZipError,
} from '@libs/problems';
import type {
  LatestPackage,
  PolygonPackageInfo,
  PolygonProblem,
} from '@libs/problems';
import { ProblemAccess } from '../core/problem-access';
import {
  POLYGON_LINK_LIMIT,
  POLYGON_LINK_WINDOW_SECONDS,
} from '../core/rate-limits';
import { PolygonProblemResponse } from './dto/polygon-problem.response';
import {
  alreadyLinked,
  askPolygon,
  linkInvalid,
  linkRefused,
  noPackage,
  packageNotReady,
} from './polygon-errors';
import { PolygonLinksRepository } from './polygon-links.repository';

export type ReadyPackage = LatestPackage & { id: number; revision: number };
/** A pasted link that passed every check: the problem and the full package an import takes. */
export interface ResolvedLink {
  problem: PolygonProblem;
  latest: ReadyPackage;
}

/** The token of a problem never changes, so the one read from its package is kept a week (as a digest, never the token). */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const tokenKey = (polygonId: number) => `polygon:link-token:${polygonId}`;
const digestOf = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Turns a pasted problem link into a Polygon problem the user may import. The link's `p…` token is the permission:
 * Polygon's API never returns it, but every package's problem.xml records it in `<problem url>`.
 */
@Injectable()
export class PolygonLinkResolver {
  constructor(
    private readonly polygon: PolygonClient,
    private readonly links: PolygonLinksRepository,
    private readonly rateLimit: RateLimitService,
    private readonly dataFiles: ProblemDataFilesService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** The import wizard's preview: the checks of `resolve` plus the statement title. */
  async preview(
    auth: AuthContext,
    text: string,
  ): Promise<PolygonProblemResponse> {
    const { problem, latest } = await this.resolve(auth, text, null);
    const title = statementTitleOf(
      await askPolygon(() => this.polygon.statements(problem.id)),
    );
    return {
      id: problem.id,
      name: problem.name,
      owner: problem.owner,
      title,
      revision: problem.revision,
      modified: Boolean(problem.modified),
      latestPackage: latest,
    };
  }

  /**
   * Malformed (400) → per-user limit → shared with the account and token matches (one 404 for both) → not linked to
   * another problem than `code` → newest full package READY. The link is never logged or stored.
   */
  async resolve(
    auth: AuthContext,
    text: string,
    code: string | null,
  ): Promise<ResolvedLink> {
    const link = parsePolygonLink(text);
    if (!link) throw linkInvalid();
    await this.rateLimit.reserve(
      [`polygon-link:user:${auth.principal.userId}`],
      POLYGON_LINK_LIMIT,
      POLYGON_LINK_WINDOW_SECONDS,
    );
    const problem = await askPolygon(() =>
      this.polygon.problemNamed(link.owner, link.name),
    );
    if (!problem) throw linkRefused();
    const packages = await askPolygon(() => this.polygon.packages(problem.id));
    await this.verifyToken(problem.id, link.token, packages);
    await this.assertNotLinked(auth, problem.id, code);
    return { problem, latest: readyFullPackage(problem.id, packages) };
  }

  /** The digest of the token read once per problem is cached, so a later check (or a wrong guess) downloads nothing. */
  private async verifyToken(
    polygonId: number,
    token: string,
    packages: PolygonPackageInfo[],
  ): Promise<void> {
    let known = await this.redis.get(tokenKey(polygonId));
    if (known === null) {
      const packageId = newestReadyPackageId(packages);
      if (packageId === null) throw noPackage();
      const actual = await this.tokenInPackage(polygonId, packageId);
      if (actual === null) throw linkRefused();
      known = digestOf(actual);
      await this.redis.set(tokenKey(polygonId), known, 'EX', TOKEN_TTL_SECONDS);
    }
    if (known !== digestOf(token)) throw linkRefused();
  }

  /** The standard variant exists for every package; only problem.xml is read, and the zip is removed at once. */
  private async tokenInPackage(
    problemId: number,
    packageId: number,
  ): Promise<string | null> {
    const path = await this.dataFiles.importPackagePath(`link-${newId()}`);
    try {
      await askPolygon(() =>
        this.polygon.downloadPackage({ problemId, packageId }, path, {
          maxBytes: POLYGON_PACKAGE_MAX_BYTES,
          type: 'standard',
        }),
      );
      return await linkTokenOfPackage(path);
    } catch (error) {
      if (error instanceof ZipError || error instanceof XmlError) return null;
      throw error;
    } finally {
      await rm(path, { force: true });
    }
  }

  /** One QHHOJ problem per Polygon problem; re-linking the same problem (an update import into `code`) is allowed. */
  private async assertNotLinked(
    auth: AuthContext,
    polygonId: number,
    code: string | null,
  ): Promise<void> {
    const linked = await this.links.linkedTo(polygonId);
    if (!linked || linked.code === code) return;
    const canEdit = ProblemAccess.canEdit(
      auth.principal,
      ProblemAccess.accessView(linked),
    );
    throw alreadyLinked(polygonId, canEdit ? linked.code : null);
  }
}

/** The newest package must be a READY full one (be#47): a newer build still running or failed is never skipped. */
export function readyFullPackage(
  polygonId: number,
  packages: PolygonPackageInfo[],
): ReadyPackage {
  const latest = latestPackageOf(packages);
  if (
    latest.state !== 'READY' ||
    latest.id === null ||
    latest.revision === null
  )
    throw packageNotReady(polygonId, packageNotReadyReason(packages));
  return latest as ReadyPackage;
}
