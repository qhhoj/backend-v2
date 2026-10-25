import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  batchMinima,
  dataPoints,
  SCORING_CONTEST_FIELDS,
} from '@libs/contests';
import type {
  ParticipationScore,
  ScoringContestField,
  ScoringRow,
} from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  Problem,
  Rating,
  Submission,
  toUuid,
  uuidStr,
} from '@libs/database';
import type {
  CaseType,
  SubmissionResult,
  SubmissionStatus,
} from '@libs/database';

export type ScoringContest = Pick<Contest, '_id' | ScoringContestField>;
const SCORING_PROJECTION = Object.fromEntries(
  SCORING_CONTEST_FIELDS.map((field) => [field, 1]),
) as Record<ScoringContestField, 1>;

interface JoinedRow {
  _id: unknown;
  problem: unknown;
  points: number;
  submission: {
    date: Date;
    result: SubmissionResult | null;
    status: SubmissionStatus;
    cases?: Array<{ points: number; batch: number | null }>;
  };
}

/** Every Mongo read and write of contest results: graded jobs (`applyContest`), participation recomputes and contest rescores, and whether a contest has ratings to redo. */
@Injectable()
export class ContestResultsRepository {
  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
  ) {}

  /** Keyed on stored ratings, not `isRated`: a contest no longer rated but still holding ratings must lose them. Through the `{contest, user}` index. */
  async hasRatings(contestId: string): Promise<boolean> {
    return (await this.ratings.exists({ contest: contestId })) !== null;
  }

  findContestSubmission(submissionId: string) {
    return this.contestSubmissions
      .findById(submissionId, { participation: 1, contest: 1, problem: 1 })
      .lean<
        Pick<ContestSubmission, '_id' | 'participation' | 'contest' | 'problem'>
      >()
      .exec();
  }

  /** A migrated contest may lack `formatConfig`: it reads as `{}`. */
  async findContest(contestId: string): Promise<ScoringContest | null> {
    const contest = await this.contests
      .findById(contestId, SCORING_PROJECTION)
      .lean<ScoringContest>()
      .exec();
    return contest && { ...contest, formatConfig: contest.formatConfig ?? {} };
  }

  async caseTotals(
    submissionIds: string[],
  ): Promise<Map<string, { casePoints: number; caseTotal: number }>> {
    const rows = await this.submissions
      .find({ _id: { $in: submissionIds } }, { casePoints: 1, caseTotal: 1 })
      .lean();
    return new Map(
      rows.map((row) => [
        uuidStr(row._id),
        { casePoints: row.casePoints, caseTotal: row.caseTotal },
      ]),
    );
  }

  async problemPartials(problemIds: string[]): Promise<Map<string, boolean>> {
    const rows = await this.problems
      .find({ _id: { $in: problemIds }, deletedAt: null }, { partial: 1 })
      .lean();
    return new Map(rows.map((row) => [uuidStr(row._id), row.partial]));
  }

  async setContestSubmissionPoints(
    submissionId: string,
    points: number,
  ): Promise<void> {
    await this.contestSubmissions
      .updateOne({ _id: submissionId }, { $set: { points } })
      .exec();
  }

  findParticipation(participationId: string) {
    return this.participations
      .findById(participationId, {
        contest: 1,
        realStart: 1,
        virtual: 1,
        isRegistered: 1,
        isDisqualified: 1,
      })
      .lean<
        Pick<
          ContestParticipation,
          | '_id'
          | 'contest'
          | 'realStart'
          | 'virtual'
          | 'isRegistered'
          | 'isDisqualified'
        >
      >()
      .exec();
  }

  /** The participation's contest submissions joined with their submission's date and verdict (and, for ioi16, its cases' batch minima); `{participation, problem}` index, one `_id` lookup per row. */
  async scoringRows(
    participationId: string,
    withBatches: boolean,
  ): Promise<ScoringRow[]> {
    const rows = await this.contestSubmissions.aggregate<JoinedRow>([
      { $match: { participation: toUuid(participationId) } },
      {
        $lookup: {
          from: this.submissions.collection.name,
          localField: '_id',
          foreignField: '_id',
          pipeline: [
            {
              $project: {
                date: 1,
                result: 1,
                status: 1,
                ...(withBatches && { 'cases.points': 1, 'cases.batch': 1 }),
              },
            },
          ],
          as: 'submission',
        },
      },
      { $unwind: '$submission' },
    ]);
    return rows.map((row) => ({
      submissionId: uuidStr(row._id),
      problemId: uuidStr(row.problem),
      date: row.submission.date,
      points: row.points,
      result: row.submission.result,
      status: row.submission.status,
      batchPoints: withBatches ? batchMinima(row.submission.cases ?? []) : null,
    }));
  }

  /** ioi16's divisor per problem, from the problem data's cases (`select: false`). */
  async dataPointsOf(problemIds: string[]): Promise<Map<string, number>> {
    const rows = await this.problems
      .find({ _id: { $in: problemIds }, deletedAt: null })
      .select('+data')
      .lean();
    return new Map(
      rows.map((row) => [
        uuidStr(row._id),
        dataPoints(
          (row.data?.cases ?? []) as Array<{
            type: CaseType;
            points: number | null;
            isPretest?: boolean;
          }>,
        ),
      ]),
    );
  }

  async setResults(
    participationId: string,
    score: ParticipationScore,
  ): Promise<void> {
    await this.participations
      .updateOne({ _id: participationId }, { $set: score })
      .exec();
  }
}
