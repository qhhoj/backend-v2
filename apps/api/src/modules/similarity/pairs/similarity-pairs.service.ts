import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { SimilarityPair, SimilaritySide } from '@libs/database';
import { SubmissionsService } from '../../submissions/core/submissions.service';
import {
  SimilarityAccessService,
  similarityNotFound,
} from '../core/similarity-access.service';
import { SimilarityRunsRepository } from '../core/similarity-runs.repository';
import type { SimilarityPairListDto } from './dto/pair-list.dto';
import {
  fragmentResponse,
  sourceSideResponse,
} from './dto/similarity-pair-detail.response';
import type { SimilarityPairDetailResponse } from './dto/similarity-pair-detail.response';
import {
  pairFieldsResponse,
  pairResponse,
  sideResponse,
} from './dto/similarity-pair.response';
import type { SimilarityPairResponse } from './dto/similarity-pair.response';
import { SimilarityPairsRepository } from './similarity-pairs.repository';
import type { PairFilter } from './similarity-pairs.repository';

const uniqueUserIds = (pairs: SimilarityPair[]): string[] => [
  ...new Set(
    pairs.flatMap((pair) => [
      uuidStr(pair.left.user),
      uuidStr(pair.right.user),
    ]),
  ),
];

/**
 * Reads the pairs of runs the caller may view. Seeing the run is not enough: a
 * contest editor may not see every problem of the contest. The list leaves out
 * pairs on problems the viewer cannot see, and the detail shows its sources
 * only when the source route (`SubmissionsService.viewable`) would show both.
 */
@Injectable()
export class SimilarityPairsService {
  constructor(
    private readonly access: SimilarityAccessService,
    private readonly runs: SimilarityRunsRepository,
    private readonly pairs: SimilarityPairsRepository,
    private readonly submissions: SubmissionsService,
  ) {}

  async list(
    principal: Principal,
    runId: string,
    query: SimilarityPairListDto,
  ): Promise<Paginated<SimilarityPairResponse>> {
    const run = await this.access.viewableRun(principal, runId);
    const meta = { page: query.page, pageSize: query.pageSize };
    const filter = await this.visibleFilter(principal, uuidStr(run._id), query);
    if (!filter) return new Paginated([], { ...meta, total: 0 });
    const { items, total } = await this.pairs.pairsPage(
      uuidStr(run._id),
      filter,
      query.page,
      query.pageSize,
    );
    const problemIds = items.map((pair) => uuidStr(pair.problem));
    const [problemCodes, usernames] = await Promise.all([
      this.runs.problemCodes([...new Set(problemIds)]),
      this.pairs.usernames(uniqueUserIds(items)),
    ]);
    const responses = items.map((pair) =>
      pairResponse(
        pair,
        problemCodes.get(uuidStr(pair.problem)) ?? '',
        usernames,
      ),
    );
    return new Paginated(responses, { ...meta, total });
  }

  async detail(
    principal: Principal,
    pairId: string,
  ): Promise<SimilarityPairDetailResponse> {
    const pair = await this.pairs.findPair(pairId);
    if (!pair) throw similarityNotFound();
    await this.access.viewableRun(principal, uuidStr(pair.run));
    const submissionIds = [pair.left, pair.right].map((side) =>
      uuidStr(side.submission),
    );
    const factsById = await this.pairs.submissionFacts(submissionIds);
    await this.requireViewableSources(principal, pair, [...factsById.keys()]);
    const problemId = uuidStr(pair.problem);
    const [problemCodes, usernames, sourcesById] = await Promise.all([
      this.runs.problemCodes([problemId]),
      this.pairs.usernames(uniqueUserIds([pair])),
      this.pairs.sourcesOf([...factsById.keys()]),
    ]);
    const sourceSide = (side: SimilaritySide) => {
      const sideFields = sideResponse(side, usernames);
      const submissionId = sideFields.submissionId;
      return sourceSideResponse(
        sideFields,
        factsById.get(submissionId),
        sourcesById.get(submissionId),
      );
    };
    return {
      ...pairFieldsResponse(pair, problemCodes.get(problemId) ?? ''),
      left: sourceSide(pair.left),
      right: sourceSide(pair.right),
      fragments: pair.fragments.map(fragmentResponse),
    };
  }

  /**
   * The list query limited to the problems the viewer can see; null when that
   * leaves none. When every problem of the run is visible, the filter is left
   * as asked, so the index plans do not change.
   */
  private async visibleFilter(
    principal: Principal,
    runId: string,
    query: SimilarityPairListDto,
  ): Promise<PairFilter | null> {
    const runProblemIds = await this.pairs.problemIdsOf(runId);
    const visibleIds = await this.access.visibleProblemIds(
      principal,
      runProblemIds,
      await this.submissions.viewerScope(principal),
    );
    const askedIds = query.problemId ? [query.problemId] : runProblemIds;
    const problemIds = askedIds.filter((problemId) =>
      visibleIds.has(problemId),
    );
    if (!problemIds.length) return null;
    const isNarrowed =
      query.problemId !== undefined || problemIds.length < runProblemIds.length;
    return {
      problemIds: isNarrowed ? problemIds : undefined,
      language: query.language,
      minSimilarity: query.minSimilarity,
    };
  }

  /**
   * 404 unless the viewer may see the pair's problem and, through the source
   * route's own rules, each side that still exists. A side whose submission is
   * gone shows no source, so it needs no check.
   */
  private async requireViewableSources(
    principal: Principal,
    pair: SimilarityPair,
    existingSubmissionIds: string[],
  ): Promise<void> {
    const scope = await this.submissions.viewerScope(principal);
    const problemId = uuidStr(pair.problem);
    const visibleIds = await this.access.visibleProblemIds(
      principal,
      [problemId],
      scope,
    );
    if (!visibleIds.has(problemId)) throw similarityNotFound();
    try {
      await Promise.all(
        existingSubmissionIds.map((submissionId) =>
          this.submissions.viewable(principal, submissionId, scope),
        ),
      );
    } catch (error) {
      if (error instanceof AppError) throw similarityNotFound();
      throw error;
    }
  }
}
