import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS, runCoalesced } from '@libs/common';
import {
  notifyOrganizationPoints,
  ORGANIZATION_POINTS_QUEUE,
} from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import {
  contestSubmissionPoints,
  disqualify,
  frozenTime,
  participationStart,
  purgeRankingCache,
  scoreParticipation,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import { acceptanceRate, userPoints } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { ContestResultsRepository } from './contest-results.repository';
import { SubmissionEffectsRepository } from './submission-effects.repository';

/** The only place a user's points, a problem's stats or a contest participation's results are recomputed (graded jobs, the sweep, rescores). Each recompute reads Mongo and `$set`s, serialised per key across processes. */
@Injectable()
export class SubmissionEffectsService {
  private readonly logger = new Logger(SubmissionEffectsService.name);

  constructor(
    private readonly repository: SubmissionEffectsRepository,
    private readonly contestResults: ContestResultsRepository,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(ORGANIZATION_POINTS_QUEUE)
    private readonly organizationPoints: Queue<OrganizationPointsJob>,
  ) {}

  /** Legacy `on_grading_end`: the user only when the problem counts for points, then the problem's stats. A deleted problem has nothing to update. */
  async apply(job: SubmissionGradedJob): Promise<void> {
    const problem = await this.repository.findProblem(job.problemId);
    if (!problem) return;
    if (problem.isPublic && !problem.isOrganizationPrivate)
      await this.recomputeUser(job.userId);
    await this.recomputeProblem(job.problemId);
    await this.applyContest(job.submissionId);
  }

  /** Legacy `update_contest`: a contest submission's points from its case totals, then its participation. A problem no longer in the contest keeps its points. */
  async applyContest(submissionId: string): Promise<void> {
    const entry = await this.contestResults.findContestSubmission(submissionId);
    if (!entry) return;
    const problemId = uuidStr(entry.problem);
    const [contest, totals, partials] = await Promise.all([
      this.contestResults.findContest(uuidStr(entry.contest)),
      this.contestResults.caseTotals([submissionId]),
      this.contestResults.problemPartials([problemId]),
    ]);
    const contestProblem = contest?.problems.find(
      (candidate) => uuidStr(candidate.problem) === problemId,
    );
    const caseTotals = totals.get(submissionId);
    if (!contest || !contestProblem || !caseTotals) return;
    await this.contestResults.setContestSubmissionPoints(
      submissionId,
      contestSubmissionPoints(
        caseTotals,
        contestProblem,
        contest.formatName,
        partials.get(problemId) ?? false,
      ),
    );
    await this.recomputeParticipation(uuidStr(entry.participation));
  }

  /** Legacy `recompute_results` through the contest's format, then the contest's ranking cache is dropped (all four keys). */
  recomputeParticipation(participationId: string): Promise<void> {
    return runCoalesced(
      this.redis,
      `effects:participation:${participationId}`,
      async () => {
        const participation =
          await this.contestResults.findParticipation(participationId);
        const contest =
          participation &&
          (await this.contestResults.findContest(
            uuidStr(participation.contest),
          ));
        if (!participation || !contest) return;
        const problemIds = contest.problems.map((entry) =>
          uuidStr(entry.problem),
        );
        const withBatches = contest.formatName === 'ioi16';
        const [rows, dataPointsOf] = await Promise.all([
          this.contestResults.scoringRows(participationId, withBatches),
          withBatches
            ? this.contestResults.dataPointsOf(problemIds)
            : Promise.resolve(new Map<string, number>()),
        ]);
        const score = scoreParticipation(
          rows.filter((row) => problemIds.includes(row.problemId)),
          { name: contest.formatName, config: contest.formatConfig },
          {
            start: participationStart(contest, participation),
            contestStart: contest.startTime,
            frozenTime: frozenTime(contest),
            pointsPrecision: contest.pointsPrecision,
            problems: contest.problems.map((entry) => ({
              problemId: uuidStr(entry.problem),
              points: entry.points,
              dataPoints: dataPointsOf.get(uuidStr(entry.problem)) ?? null,
            })),
          },
        );
        await this.contestResults.setResults(
          participationId,
          participation.isDisqualified ? disqualify(score) : score,
        );
        await purgeRankingCache(this.redis, uuidStr(participation.contest));
      },
    );
  }

  /** Legacy `Profile.calculate_points`, which also recomputed the user's organizations when the PP moved. */
  recomputeUser(userId: string): Promise<void> {
    return runCoalesced(this.redis, `effects:user:${userId}`, async () => {
      const points = userPoints(await this.repository.problemBests(userId));
      const previous = await this.repository.setUserPoints(userId, points);
      if (previous && previous.performancePoints !== points.performancePoints)
        await notifyOrganizationPoints(
          this.organizationPoints,
          previous.organizations,
          this.logger,
        );
    });
  }

  recomputeProblem(problemId: string): Promise<void> {
    return runCoalesced(
      this.redis,
      `effects:problem:${problemId}`,
      async () => {
        const problem = await this.repository.findProblem(problemId);
        if (!problem) return;
        const counts = await this.repository.problemCounts(
          problemId,
          problem.points,
        );
        await this.repository.setProblemStats(problemId, {
          userCount: counts.userCount,
          acRate: acceptanceRate(counts.accepted, counts.total),
        });
      },
    );
  }
}
