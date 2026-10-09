import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { LIVE, participationStart } from '@libs/contests';
import type { ContestFormatName } from '@libs/database';
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
import type { ExportRow } from './export-csv';

/** Ids per `$in` query. */
const ID_CHUNK = 1000;
const idChunks = <Item>(items: Item[]): Item[][] =>
  Array.from({ length: Math.ceil(items.length / ID_CHUNK) }, (_unused, chunk) =>
    items.slice(chunk * ID_CHUNK, (chunk + 1) * ID_CHUNK),
  );

export interface ExportContest {
  _id: string;
  startTime: Date;
  endTime: Date;
  timeLimit: number | null;
  frozenLastMinutes: number;
  formatName: ContestFormatName;
  /** Problem id to code. */
  codes: Map<string, string>;
}

interface SubmissionDetail {
  date: Date;
  status: string;
  result: string | null;
  language: string;
}

interface RowParts {
  row: Pick<ContestSubmission, 'problem' | 'points'> & { _id: string };
  participation: Pick<
    ContestParticipation,
    'user' | 'realStart' | 'virtual' | 'isRegistered' | 'isDisqualified'
  > & { _id: string };
  detail: SubmissionDetail;
}

function toExportRow(
  contest: ExportContest,
  { row, participation, detail }: RowParts,
  names: {
    username: string | undefined;
    language: { name: string; extension: string } | undefined;
  },
  deletedProblems: ReadonlySet<string>,
): ExportRow {
  const start = participationStart(contest, participation);
  return {
    submissionId: uuidStr(row._id),
    participationId: uuidStr(participation._id),
    username: names.username ?? uuidStr(participation.user),
    problem: contest.codes.get(uuidStr(row.problem)) ?? 'problem',
    language: names.language?.name ?? '',
    submittedAt: detail.date,
    contestSeconds: (detail.date.getTime() - start.getTime()) / 1000,
    status: detail.status,
    result: detail.result,
    points: row.points,
    isDisqualified: participation.isDisqualified,
    extension: names.language?.extension ?? 'txt',
    hasSource: !deletedProblems.has(uuidStr(row.problem)),
  };
}

@Injectable()
export class ContestExportRepository {
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

  async findContest(contestId: string): Promise<ExportContest | null> {
    const contest = await this.contests
      .findById(contestId, {
        startTime: 1,
        endTime: 1,
        timeLimit: 1,
        frozenLastMinutes: 1,
        formatName: 1,
        problems: 1,
      })
      .lean()
      .exec();
    if (!contest) return null;
    const ids = contest.problems.map((entry) => uuidStr(entry.problem));
    const rows = await this.problems
      .find({ _id: { $in: ids } }, { code: 1 })
      .lean()
      .exec();
    return {
      _id: uuidStr(contest._id),
      startTime: contest.startTime,
      endTime: contest.endTime,
      timeLimit: contest.timeLimit,
      frozenLastMinutes: contest.frozenLastMinutes,
      formatName: contest.formatName,
      codes: new Map(rows.map((row) => [uuidStr(row._id), row.code])),
    };
  }

  /** Counted before anything is loaded (an upper bound: virtual and spectating rows are counted too), so a huge contest is refused without filling the worker's memory. Through `{contest, problem}`. */
  countSubmissions(contestId: string): Promise<number> {
    return this.contestSubmissions
      .countDocuments({ contest: contestId })
      .exec();
  }

  /** Live participations (disqualified ones included, flagged), through `{contest, virtual}`; their contest submissions through `{contest, problem}`; submission fields in id chunks. Oldest first. */
  async rows(contest: ExportContest): Promise<ExportRow[]> {
    const live = await this.liveParticipations(contest._id);
    const contestRows = await this.liveContestRows(contest._id, live);
    const details = await this.submissionDetails(
      contestRows.map((row) => uuidStr(row._id)),
    );
    const [usernames, languages, deletedProblems] = await Promise.all([
      this.usernames([
        ...new Set([...live.values()].map((row) => uuidStr(row.user))),
      ]),
      this.languageRows([
        ...new Set([...details.values()].map((row) => row.language)),
      ]),
      this.deletedProblems([
        ...new Set(contestRows.map((row) => uuidStr(row.problem))),
      ]),
    ]);
    return contestRows
      .filter((row) => details.has(uuidStr(row._id)))
      .map((row) => {
        const participation = live.get(uuidStr(row.participation))!;
        const detail = details.get(uuidStr(row._id))!;
        return toExportRow(
          contest,
          { row, participation, detail },
          {
            username: usernames.get(uuidStr(participation.user)),
            language: languages.get(detail.language),
          },
          deletedProblems,
        );
      })
      .sort(
        (left, right) =>
          left.submittedAt.getTime() - right.submittedAt.getTime() ||
          left.submissionId.localeCompare(right.submissionId),
      );
  }

  private async liveParticipations(contestId: string) {
    const rows = await this.participations
      .find(
        { contest: contestId, virtual: LIVE },
        {
          user: 1,
          realStart: 1,
          virtual: 1,
          isRegistered: 1,
          isDisqualified: 1,
        },
      )
      .lean()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row]));
  }

  private async liveContestRows(
    contestId: string,
    live: ReadonlyMap<string, unknown>,
  ) {
    const rows = await this.contestSubmissions
      .find({ contest: contestId }, { participation: 1, problem: 1, points: 1 })
      .lean()
      .exec();
    return rows.filter((row) => live.has(uuidStr(row.participation)));
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

  private async submissionDetails(ids: string[]) {
    const found = new Map<string, SubmissionDetail>();
    for (const chunk of idChunks(ids))
      for (const row of await this.submissions
        .find(
          { _id: { $in: chunk } },
          { date: 1, status: 1, result: 1, language: 1 },
        )
        .lean()
        .exec())
        found.set(uuidStr(row._id), {
          date: row.date,
          status: row.status,
          result: row.result,
          language: uuidStr(row.language),
        });
    return found;
  }

  /** Problems of the exported submissions deleted since the contest, including ones taken out of the contest first (the delete requires it). */
  private async deletedProblems(ids: string[]): Promise<Set<string>> {
    const rows = await this.problems
      .find({ _id: { $in: ids }, deletedAt: { $ne: null } }, { _id: 1 })
      .lean()
      .exec();
    return new Set(rows.map((row) => uuidStr(row._id)));
  }

  private async usernames(ids: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const chunk of idChunks(ids))
      for (const user of await this.users
        .find({ _id: { $in: chunk } }, { username: 1 })
        .lean()
        .exec())
        found.set(uuidStr(user._id), user.username);
    return found;
  }

  private async languageRows(ids: string[]) {
    return new Map(
      (
        await this.languages
          .find({ _id: { $in: ids } }, { name: 1, extension: 1 })
          .lean()
          .exec()
      ).map((language) => [
        uuidStr(language._id),
        { name: language.name, extension: language.extension },
      ]),
    );
  }
}
