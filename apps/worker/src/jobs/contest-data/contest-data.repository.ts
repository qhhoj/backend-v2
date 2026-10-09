import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { LIVE } from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  Language,
  Problem,
  Submission,
  SubmissionSource,
  User,
  uuidStr,
} from '@libs/database';
import type { SubmissionResult } from '@libs/database';
import type { DataRow } from './data-zip';

/** Ids per `$in` query. */
const ID_CHUNK = 1000;

export interface DataContest {
  _id: string;
  problems: Array<{ id: string; code: string }>;
}

const chunksOf = <Item>(items: Item[]): Item[][] =>
  Array.from({ length: Math.ceil(items.length / ID_CHUNK) }, (_unused, chunk) =>
    items.slice(chunk * ID_CHUNK, (chunk + 1) * ID_CHUNK),
  );

@Injectable()
export class ContestDataRepository {
  constructor(
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
    private readonly sourceRows: Model<SubmissionSource>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async findContest(contestId: string): Promise<DataContest | null> {
    const contest = await this.contests
      .findById(contestId, { problems: 1 })
      .lean()
      .exec();
    if (!contest) return null;
    const codes = new Map(
      (
        await this.problems
          .find(
            {
              _id: {
                $in: contest.problems.map((entry) => uuidStr(entry.problem)),
              },
              deletedAt: null,
            },
            { code: 1 },
          )
          .lean()
          .exec()
      ).map((problem) => [uuidStr(problem._id), problem.code]),
    );
    return {
      _id: uuidStr(contest._id),
      problems: contest.problems.map((entry) => ({
        id: uuidStr(entry.problem),
        code: codes.get(uuidStr(entry.problem)) ?? '',
      })),
    };
  }

  /** Live rows of the chosen problems through `{contest, problem}`; submission fields in id chunks; best first. An empty `results` keeps every result. */
  async liveSubmissionRows(
    contestId: string,
    problemIds: string[],
    results: SubmissionResult[],
  ): Promise<DataRow[]> {
    if (!problemIds.length) return [];
    const live = new Set(
      (
        await this.participations
          .find({ contest: contestId, virtual: LIVE }, { _id: 1 })
          .lean()
          .exec()
      ).map((row) => uuidStr(row._id)),
    );
    const contestRows = (
      await this.contestSubmissions
        .find(
          { contest: contestId, problem: { $in: problemIds } },
          { participation: 1, problem: 1, points: 1 },
        )
        .lean()
        .exec()
    ).filter((row) => live.has(uuidStr(row.participation)));
    const submissions = new Map<string, { user: string; language: string }>();
    for (const chunk of chunksOf(contestRows))
      for (const row of await this.submissions
        .find(
          {
            _id: { $in: chunk.map((contestRow) => uuidStr(contestRow._id)) },
            ...(results.length ? { result: { $in: results } } : {}),
          },
          { user: 1, language: 1 },
        )
        .lean()
        .exec())
        submissions.set(uuidStr(row._id), {
          user: uuidStr(row.user),
          language: uuidStr(row.language),
        });
    const kept = contestRows
      .filter((row) => submissions.has(uuidStr(row._id)))
      .sort(
        (left, right) =>
          right.points - left.points ||
          uuidStr(left._id).localeCompare(uuidStr(right._id)),
      );
    const [usernames, extensions, codes] = await Promise.all([
      this.usernames([
        ...new Set([...submissions.values()].map(({ user }) => user)),
      ]),
      this.extensions([
        ...new Set([...submissions.values()].map(({ language }) => language)),
      ]),
      this.codes(problemIds),
    ]);
    return kept.map((row) => {
      const submission = submissions.get(uuidStr(row._id))!;
      return {
        submissionId: uuidStr(row._id),
        userId: submission.user,
        username: usernames.get(submission.user) ?? submission.user,
        code: codes.get(uuidStr(row.problem)) ?? 'problem',
        extension: extensions.get(submission.language) ?? 'txt',
      };
    });
  }

  async sources(ids: string[]): Promise<Map<string, string>> {
    return new Map(
      (
        await this.sourceRows
          .find({ _id: { $in: ids } })
          .lean()
          .exec()
      ).map((row) => [uuidStr(row._id), row.source]),
    );
  }

  private async usernames(ids: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const chunk of chunksOf(ids))
      for (const user of await this.users
        .find({ _id: { $in: chunk } }, { username: 1 })
        .lean()
        .exec())
        found.set(uuidStr(user._id), user.username);
    return found;
  }

  private async extensions(ids: string[]): Promise<Map<string, string>> {
    return new Map(
      (
        await this.languages
          .find({ _id: { $in: ids } }, { extension: 1 })
          .lean()
          .exec()
      ).map((language) => [uuidStr(language._id), language.extension]),
    );
  }

  private async codes(ids: string[]): Promise<Map<string, string>> {
    return new Map(
      (
        await this.problems
          .find({ _id: { $in: ids }, deletedAt: null }, { code: 1 })
          .lean()
          .exec()
      ).map((problem) => [uuidStr(problem._id), problem.code]),
    );
  }
}
