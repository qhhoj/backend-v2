import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { Paginated } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { SimilarityPair, SimilaritySide } from '@libs/database';
import {
  SimilarityAccessService,
  similarityNotFound,
} from '../core/similarity-access.service';
import { SimilarityRunsRepository } from '../core/similarity-runs.repository';
import type { SimilarityPairListDto } from './dto/pair-list.dto';
import { fragmentResponse } from './dto/similarity-pair-detail.response';
import type {
  SimilarityPairDetailResponse,
  SimilarityPairSourceResponse,
} from './dto/similarity-pair-detail.response';
import {
  pairFieldsResponse,
  sideResponse,
  SimilarityPairResponse,
} from './dto/similarity-pair.response';
import type { SimilaritySideResponse } from './dto/similarity-pair.response';
import { SimilarityPairsRepository } from './similarity-pairs.repository';
import type { SubmissionFacts } from './similarity-pairs.repository';

const uniqueUserIds = (pairs: SimilarityPair[]): string[] => [
  ...new Set(
    pairs.flatMap((pair) => [
      uuidStr(pair.left.user),
      uuidStr(pair.right.user),
    ]),
  ),
];

/** A deleted submission keeps its side: null facts, empty source. */
const withSource = (
  side: SimilaritySideResponse,
  facts: SubmissionFacts | undefined,
  source: string | undefined,
): SimilarityPairSourceResponse => ({
  ...side,
  date: facts?.date ?? null,
  result: facts?.result ?? null,
  points: facts?.points ?? null,
  source: source ?? '',
});

/**
 * Reads the pairs of runs the caller may view. Seeing a run is enough to see both sources: the run's scope is a problem or contest the viewer
 * edits, and `detailAccess` (`submissions/core/submission-access.ts`) grants every submission's detail to the problem's editors and to the
 * contest's editors (`ContestAccess.canEdit` implies the `contestEditor` it checks); a contest run only holds that contest's submissions.
 */
@Injectable()
export class SimilarityPairsService {
  constructor(
    private readonly access: SimilarityAccessService,
    private readonly runs: SimilarityRunsRepository,
    private readonly pairs: SimilarityPairsRepository,
  ) {}

  async list(
    principal: Principal,
    runId: string,
    query: SimilarityPairListDto,
  ): Promise<Paginated<SimilarityPairResponse>> {
    const run = await this.access.viewableRun(principal, runId);
    const { items, total } = await this.pairs.pairsPage(
      uuidStr(run._id),
      query,
      query.page,
      query.pageSize,
    );
    const problemIds = items.map((pair) => uuidStr(pair.problem));
    const [problemCodes, usernames] = await Promise.all([
      this.runs.problemCodes([...new Set(problemIds)]),
      this.pairs.usernames(uniqueUserIds(items)),
    ]);
    const responses = items.map((pair) =>
      SimilarityPairResponse.from(
        pair,
        problemCodes.get(uuidStr(pair.problem)) ?? '',
        usernames,
      ),
    );
    return new Paginated(responses, {
      page: query.page,
      pageSize: query.pageSize,
      total,
    });
  }

  async detail(
    principal: Principal,
    pairId: string,
  ): Promise<SimilarityPairDetailResponse> {
    const pair = await this.pairs.findPair(pairId);
    if (!pair) throw similarityNotFound();
    await this.access.viewableRun(principal, uuidStr(pair.run));
    const problemId = uuidStr(pair.problem);
    const submissionIds = [pair.left, pair.right].map((side) =>
      uuidStr(side.submission),
    );
    const [problemCodes, usernames, factsById, sourcesById] = await Promise.all(
      [
        this.runs.problemCodes([problemId]),
        this.pairs.usernames(uniqueUserIds([pair])),
        this.pairs.submissionFacts(submissionIds),
        this.pairs.sourcesOf(submissionIds),
      ],
    );
    const sourceSide = (side: SimilaritySide) => {
      const sideFields = sideResponse(side, usernames);
      return withSource(
        sideFields,
        factsById.get(sideFields.submissionId),
        sourcesById.get(sideFields.submissionId),
      );
    };
    return {
      ...pairFieldsResponse(pair, problemCodes.get(problemId) ?? ''),
      left: sourceSide(pair.left),
      right: sourceSide(pair.right),
      fragments: pair.fragments.map(fragmentResponse),
    };
  }
}
