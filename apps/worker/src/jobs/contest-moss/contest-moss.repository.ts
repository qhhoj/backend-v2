import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { LIVE, SPECTATE } from '@libs/contests';
import {
  Contest,
  ContestMoss,
  ContestParticipation,
  ContestSubmission,
  Language,
  MOSS_LANGUAGES,
  Problem,
  Submission,
  SubmissionSource,
  User,
  uuidStr,
} from '@libs/database';
import type { MossLanguage, SubmissionResult } from '@libs/database';

/** Legacy `MOSS_IGNORE`. */
const MOSS_IGNORED_RESULTS: SubmissionResult[] = ['CE', 'IE', 'AB', 'RJ'];

export interface MossContest {
  _id: string;
  key: string;
  /** In contest order. */
  problems: Array<{ id: string; code: string }>;
}
export interface MossSource {
  submissionId: string;
  username: string;
  source: string;
}

@Injectable()
export class ContestMossRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sources: Model<SubmissionSource>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(ContestMoss.name)
    private readonly mossRows: Model<ContestMoss>,
  ) {}

  async findContest(contestId: string): Promise<MossContest | null> {
    const contest = await this.contests
      .findById(contestId, { key: 1, problems: 1 })
      .lean()
      .exec();
    if (!contest) return null;
    const ordered = [...contest.problems].sort(
      (left, right) => left.order - right.order,
    );
    const codes = new Map(
      (
        await this.problems
          .find(
            { _id: { $in: ordered.map((entry) => uuidStr(entry.problem)) } },
            { code: 1 },
          )
          .lean()
          .exec()
      ).map((problem) => [uuidStr(problem._id), problem.code]),
    );
    return {
      _id: uuidStr(contest._id),
      key: contest.key,
      problems: ordered.map((entry) => ({
        id: uuidStr(entry.problem),
        code: codes.get(uuidStr(entry.problem)) ?? '',
      })),
    };
  }

  /** The ids of every language row sharing each MOSS language's common name. */
  async languageIds(): Promise<Map<MossLanguage, string[]>> {
    const names = MOSS_LANGUAGES.map(([name]) => name);
    const rows = await this.languages
      .find({ commonName: { $in: names } }, { commonName: 1 })
      .lean()
      .exec();
    return new Map(
      names.map((name) => [
        name,
        rows
          .filter((row) => row.commonName === name)
          .map((row) => uuidStr(row._id)),
      ]),
    );
  }

  /** Live and spectating rows only; best points first, one per user (legacy loop). */
  async bestSources(
    contestId: string,
    problemId: string,
    languageIds: string[],
  ): Promise<MossSource[]> {
    if (!languageIds.length) return [];
    const participations = await this.participations
      .find(
        { contest: contestId, virtual: { $in: [LIVE, SPECTATE] } },
        { _id: 1 },
      )
      .lean()
      .exec();
    const contestRows = await this.contestSubmissions
      .find(
        {
          contest: contestId,
          problem: problemId,
          participation: { $in: participations.map((row) => uuidStr(row._id)) },
        },
        { _id: 1 },
      )
      .lean()
      .exec();
    const graded = await this.submissions
      .find(
        {
          _id: { $in: contestRows.map((row) => uuidStr(row._id)) },
          language: { $in: languageIds },
          result: { $nin: MOSS_IGNORED_RESULTS },
          casePoints: { $gt: 0 },
        },
        { user: 1 },
      )
      .sort({ points: -1, _id: 1 })
      .lean()
      .exec();
    const best = new Map<string, string>();
    for (const row of graded)
      if (!best.has(uuidStr(row.user)))
        best.set(uuidStr(row.user), uuidStr(row._id));
    const [users, sources] = await Promise.all([
      this.users
        .find({ _id: { $in: [...best.keys()] } }, { username: 1 })
        .lean()
        .exec(),
      this.sources
        .find({ _id: { $in: [...best.values()] } })
        .lean()
        .exec(),
    ]);
    const usernames = new Map(
      users.map((user) => [uuidStr(user._id), user.username]),
    );
    const sourceOf = new Map(
      sources.map((row) => [uuidStr(row._id), row.source]),
    );
    return [...best].map(([userId, submissionId]) => ({
      submissionId,
      username: usernames.get(userId) ?? userId,
      source: sourceOf.get(submissionId) ?? '',
    }));
  }

  /** All or nothing: a failed run never reaches this, so earlier results survive it. */
  async replaceResults(
    contestId: string,
    rows: Array<Omit<ContestMoss, '_id'>>,
  ): Promise<void> {
    await this.connection.transaction(async (session) => {
      await this.mossRows
        .deleteMany({ contest: contestId }, { session })
        .exec();
      await this.mossRows.insertMany(rows, { session });
    });
  }
}
