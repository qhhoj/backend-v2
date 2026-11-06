import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectJob, REDIS, runCoalesced } from '@libs/common';
import type { JobProducer } from '@libs/common';
import { communityJobs, notifyOrganizationPoints } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import {
  contestJobs,
  contestSubmissionPoints,
  disqualify,
  LIVE,
  notifyReplayBuild,
  purgeRankingCache,
  replayDelayMs,
  requestContestRerate,
  scoreParticipation,
  scoringContextOf,
} from '@libs/contests';
import type {
  ContestRatingJob,
  ContestReplayJob,
  RunDivisors,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import { acceptanceRate, userPoints } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { JudgingCharges } from '@libs/problems';
import { ContestResultsRepository } from './contest-results.repository';
import type { ScoringContest } from './contest-results.repository';
import { SubmissionEffectsRepository } from './submission-effects.repository';

/** The only place a user's points, a problem's stats or a contest participation's results are recomputed (graded jobs, the sweep, rescores). Each recompute reads Mongo and `$set`s, serialised per key across processes. */
@Injectable()
export class SubmissionEffectsService {
  constructor(
    private readonly repository: SubmissionEffectsRepository,
    private readonly contestResults: ContestResultsRepository,
    private readonly judgingCharges: JudgingCharges,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectJob(communityJobs.organizationPoints)
    private readonly organizationPoints: JobProducer<OrganizationPointsJob>,
    @InjectJob(contestJobs.replay)
    private readonly replays: JobProducer<ContestReplayJob>,
    @InjectJob(contestJobs.rating)
    private readonly ratings: JobProducer<ContestRatingJob>,
  ) {}

  /** The graded job (and the sweep's repair of one that was lost): the effects, then the run's judging time is charged (once per grading attempt, also for a deleted problem; after the effects, so billing never holds back a score), then the row's `effectsDueAt` is cleared, but only the stamp read before them, so a run that finished meanwhile keeps its own and a failed charge is repaired by the sweep. */
  async apply(job: SubmissionGradedJob): Promise<void> {
    const due = await this.repository.effectsDueAt(job.submissionId);
    const isApplied = await this.applyEffects(job);
    await this.judgingCharges.chargeRun(job);
    if (due && isApplied)
      await this.repository.clearEffectsDue(job.submissionId, due);
  }

  /** Legacy `on_grading_end`: the user only when the problem counts for points, then the problem's stats. A deleted problem has nothing to update; its pending gradings finish without effects. False when the participation's recompute was left to another owner: only rows still due bring a participation back in the sweep (users and problems come back by date). */
  private async applyEffects(job: SubmissionGradedJob): Promise<boolean> {
    const problem = await this.repository.findProblem(job.problemId);
    if (!problem || problem.deletedAt) return true;
    if (problem.isPublic && !problem.isOrganizationPrivate)
      await this.recomputeUser(job.userId);
    await this.recomputeProblem(job.problemId);
    return this.applyContest(job.submissionId);
  }

  /** Legacy `update_contest`: a contest submission's points from its case totals, then its participation. A problem no longer in the contest keeps its points. False when the participation's recompute was left to another owner (`runCoalesced`). */
  async applyContest(submissionId: string): Promise<boolean> {
    const entry = await this.contestResults.findContestSubmission(submissionId);
    if (!entry) return true;
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
    if (!contest || !contestProblem || !caseTotals) return true;
    await this.contestResults.setContestSubmissionPoints(
      submissionId,
      contestSubmissionPoints(
        caseTotals,
        contestProblem,
        contest.formatName,
        partials.get(problemId) ?? false,
      ),
    );
    const isRecomputed = await this.recomputeParticipation(
      uuidStr(entry.participation),
    );
    await this.followUpAfterEnd(contest, uuidStr(entry.participation));
    return isRecomputed;
  }

  /**
   * A verdict that lands after the end (judge backlog, rejudge, reject, score override) on a live, qualified row is
   * missing from what was built from the final board: the replay (`final_submission` has none) and, when the contest
   * has ratings, the ratings. The replay request never throws (derived data); a failed re-rate request fails the job,
   * whose retry recomputes the same results and asks again.
   */
  private async followUpAfterEnd(
    contest: ScoringContest,
    participationId: string,
    now = new Date(),
  ): Promise<void> {
    if (now < contest.endTime) return;
    const participation =
      await this.contestResults.findParticipation(participationId);
    if (participation?.virtual !== LIVE || participation.isDisqualified) return;
    const contestId = uuidStr(contest._id);
    if (contest.formatName !== 'final_submission')
      await notifyReplayBuild(this.replays, contestId, {
        delayMs: replayDelayMs(contest.endTime, now),
      });
    if (await this.contestResults.hasRatings(contestId))
      await requestContestRerate(this.ratings, contestId);
  }

  /** Legacy `recompute_results` through the contest's format, then the contest's ranking cache is dropped (all four keys). */
  recomputeParticipation(participationId: string): Promise<boolean> {
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
        const [rows, divisorsOf] = await Promise.all([
          this.contestResults.scoringRows(participationId, withBatches),
          withBatches
            ? this.contestResults.divisorsOf(problemIds)
            : Promise.resolve(new Map<string, RunDivisors>()),
        ]);
        const score = scoreParticipation(
          rows.filter((row) => problemIds.includes(row.problemId)),
          { name: contest.formatName, config: contest.formatConfig },
          scoringContextOf(contest, participation, divisorsOf),
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
  recomputeUser(userId: string): Promise<boolean> {
    return runCoalesced(this.redis, `effects:user:${userId}`, async () => {
      const points = userPoints(await this.repository.problemBests(userId));
      const previous = await this.repository.setUserPoints(userId, points);
      if (previous && previous.performancePoints !== points.performancePoints)
        await notifyOrganizationPoints(
          this.organizationPoints,
          this.redis,
          previous.organizations,
        );
    });
  }

  recomputeProblem(problemId: string): Promise<boolean> {
    return runCoalesced(
      this.redis,
      `effects:problem:${problemId}`,
      async () => {
        const problem = await this.repository.findProblem(problemId);
        if (!problem) return;
        const counts = await this.repository.problemCounts(problemId);
        await this.repository.setProblemStats(problemId, {
          userCount: counts.userCount,
          acRate: acceptanceRate(counts.accepted, counts.total),
        });
      },
    );
  }
}
