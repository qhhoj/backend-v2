import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AuthContext } from '@libs/auth';
import { RateLimitService, REDIS } from '@libs/common';
import {
  latestPackageOf,
  PolygonClient,
  statementTitleOf,
} from '@libs/problems';
import type { PolygonProblem } from '@libs/problems';
import { PolygonProblemsQueryDto } from './dto/polygon-problems.dto';
import { PolygonProblemResponse } from './dto/polygon-problem.response';
import { askPolygon } from './polygon-errors';
import { PolygonLinksRepository } from './polygon-links.repository';

type CatalogProblem = Omit<PolygonProblemResponse, 'linkedProblemCode'>;

const LIST_KEY = 'polygon:problems';
/** problems.list and the packages behind it are asked at most once a minute for everyone. */
const LIST_TTL_SECONDS = 60;
/** A title is fixed per revision, so it is asked once a day per revision. */
const TITLE_TTL_SECONDS = 24 * 60 * 60;
const titleKey = (problem: PolygonProblem) =>
  `polygon:title:${problem.id}:${problem.revision}`;
/** Polygon calls in flight while the list is built. */
const CONCURRENCY = 4;
export const REFRESH_LIMIT = 6;
export const REFRESH_WINDOW_SECONDS = 60;

/** The Polygon problems the account can read, with their newest package and title, marked when already linked. */
@Injectable()
export class PolygonCatalogService {
  constructor(
    private readonly polygon: PolygonClient,
    private readonly links: PolygonLinksRepository,
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list(
    auth: AuthContext,
    query: PolygonProblemsQueryDto,
  ): Promise<PolygonProblemResponse[]> {
    if (query.refresh)
      await this.rateLimit.reserve(
        [`polygon-refresh:user:${auth.principal.userId}`],
        REFRESH_LIMIT,
        REFRESH_WINDOW_SECONDS,
      );
    const problems = (await this.cachedProblems(query.refresh)).filter(
      matches(query),
    );
    const linked = await this.links.codesByPolygonId(
      problems.map((problem) => problem.id),
    );
    return problems.map((problem) => ({
      ...problem,
      linkedProblemCode: linked.get(problem.id) ?? null,
    }));
  }

  /** Answers whether the credentials work: one problems.list call. */
  async testConnection(): Promise<{ ok: boolean; problemCount: number }> {
    const problems = await askPolygon(() => this.polygon.problems());
    return { ok: true, problemCount: problems.length };
  }

  private async cachedProblems(refresh: boolean): Promise<CatalogProblem[]> {
    const cached = refresh ? null : await this.redis.get(LIST_KEY);
    if (cached) return JSON.parse(cached) as CatalogProblem[];
    const fresh = await askPolygon(() => this.fetchProblems());
    await this.redis.set(
      LIST_KEY,
      JSON.stringify(fresh),
      'EX',
      LIST_TTL_SECONDS,
    );
    return fresh;
  }

  private async fetchProblems(): Promise<CatalogProblem[]> {
    const problems = (await this.polygon.problems()).filter(
      (problem) => !problem.deleted,
    );
    const described: CatalogProblem[] = [];
    for (let start = 0; start < problems.length; start += CONCURRENCY)
      described.push(
        ...(await Promise.all(
          problems
            .slice(start, start + CONCURRENCY)
            .map((problem) => this.describe(problem)),
        )),
      );
    return described;
  }

  private async describe(problem: PolygonProblem): Promise<CatalogProblem> {
    const [packages, title] = await Promise.all([
      this.polygon.packages(problem.id),
      this.title(problem),
    ]);
    return {
      id: problem.id,
      name: problem.name,
      title,
      owner: problem.owner,
      revision: problem.revision,
      modified: Boolean(problem.modified),
      latestPackage: latestPackageOf(packages),
    };
  }

  /** Cached as '' when no statement is named, so an unnamed problem is not asked again. */
  private async title(problem: PolygonProblem): Promise<string | null> {
    const cached = await this.redis.get(titleKey(problem));
    if (cached !== null) return cached || null;
    const title = statementTitleOf(await this.polygon.statements(problem.id));
    await this.redis.set(
      titleKey(problem),
      title ?? '',
      'EX',
      TITLE_TTL_SECONDS,
    );
    return title;
  }
}

const matches =
  ({ search, state }: PolygonProblemsQueryDto) =>
  (problem: CatalogProblem): boolean => {
    if (state && problem.latestPackage.state !== state) return false;
    const needle = search?.trim().toLowerCase();
    return (
      !needle ||
      [
        String(problem.id),
        problem.name,
        problem.title ?? '',
        problem.owner,
      ].some((text) => text.toLowerCase().includes(needle))
    );
  };
