import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { LIVE } from '@libs/contests';
import {
  ContestParticipation,
  ContestSubmission,
  Language,
  Organization,
  Problem,
  Submission,
  User,
  uuidStr,
} from '@libs/database';
import type { SubmissionResult, SubmissionStatus } from '@libs/database';

export interface FeedTeamRow {
  id: string;
  userId: string;
  username: string;
  organizationId: string | null;
  realStart: Date;
  virtual: number;
  isRegistered: boolean;
}
export interface FeedSubmissionRow {
  id: string;
  teamId: string;
  problemId: string;
  languageId: string;
  date: Date;
  result: SubmissionResult | null;
  status: SubmissionStatus;
  judgedDate: Date | null;
}
const ID_CHUNK = 1000;
const idChunks = <Item>(items: Item[]): Item[][] =>
  Array.from({ length: Math.ceil(items.length / ID_CHUNK) }, (_unused, chunk) =>
    items.slice(chunk * ID_CHUNK, (chunk + 1) * ID_CHUNK),
  );

@Injectable()
export class FeedDataRepository {
  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
  ) {}

  /** Live, not disqualified (registrations included), through `{contest, virtual}`; oldest id first. */
  async teams(contestId: string): Promise<FeedTeamRow[]> {
    const rows = await this.participations
      .find(
        { contest: contestId, virtual: LIVE, isDisqualified: false },
        { user: 1, realStart: 1, virtual: 1, isRegistered: 1 },
      )
      .sort({ _id: 1 })
      .lean()
      .exec();
    const users = new Map(
      (
        await this.users
          .find(
            { _id: { $in: rows.map((row) => row.user) } },
            { username: 1, organizations: { $slice: 1 } },
          )
          .lean()
          .exec()
      ).map((user) => [uuidStr(user._id), user]),
    );
    return rows.map((row) => {
      const user = users.get(uuidStr(row.user));
      return {
        id: uuidStr(row._id),
        userId: uuidStr(row.user),
        username: user?.username ?? uuidStr(row.user),
        organizationId: user?.organizations[0]
          ? uuidStr(user.organizations[0])
          : null,
        realStart: row.realStart,
        virtual: row.virtual,
        isRegistered: row.isRegistered,
      };
    });
  }

  /** Listed organizations only: an unlisted school's name must not leave through the feed. */
  async groups(
    organizationIds: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.organizations
      .find(
        { _id: { $in: organizationIds }, isUnlisted: false, deletedAt: null },
        { name: 1 },
      )
      .lean()
      .exec();
    return rows.map((row) => ({ id: uuidStr(row._id), name: row.name }));
  }

  /** The count first (through `{contest, problem}`), so an oversized contest is refused before any submission is read. */
  countContestSubmissions(contestId: string): Promise<number> {
    return this.contestSubmissions
      .countDocuments({ contest: contestId })
      .exec();
  }

  /** Every submission row of the contest, whatever its team: the feed builder leaves out teams, problems and languages it does not list. */
  async allSubmissions(contestId: string): Promise<FeedSubmissionRow[]> {
    const links = await this.contestSubmissions
      .find({ contest: contestId }, { participation: 1, problem: 1 })
      .lean()
      .exec();
    return this.joined(links);
  }

  /** The delta of a stream tick: submissions submitted or judged after `since`, through the `{date}` and `{judgedDate}` indexes; nothing is read from `contestSubmissions` when nothing changed. */
  async changedSubmissions(
    contestId: string,
    since: Date,
  ): Promise<FeedSubmissionRow[]> {
    const changed = await this.submissions
      .find(
        {
          contest: contestId,
          $or: [{ date: { $gt: since } }, { judgedDate: { $gt: since } }],
        },
        { _id: 1 },
      )
      .lean()
      .exec();
    if (changed.length === 0) return [];
    const links = await this.contestSubmissions
      .find(
        { _id: { $in: changed.map((row) => row._id) } },
        { participation: 1, problem: 1 },
      )
      .lean()
      .exec();
    return this.joined(links);
  }

  /** Submission fields in id chunks, joined to their contest row through a `Map` (not a search per row). */
  private async joined(
    links: ReadonlyArray<
      Pick<ContestSubmission, '_id' | 'participation' | 'problem'>
    >,
  ): Promise<FeedSubmissionRow[]> {
    const linkOf = new Map(links.map((link) => [uuidStr(link._id), link]));
    const found: FeedSubmissionRow[] = [];
    for (const chunk of idChunks(links.map((link) => link._id)))
      for (const detail of await this.submissions
        .find(
          { _id: { $in: chunk } },
          { language: 1, date: 1, result: 1, status: 1, judgedDate: 1 },
        )
        .lean()
        .exec()) {
        const link = linkOf.get(uuidStr(detail._id))!;
        found.push({
          id: uuidStr(detail._id),
          teamId: uuidStr(link.participation),
          problemId: uuidStr(link.problem),
          languageId: uuidStr(detail.language),
          date: detail.date,
          result: detail.result,
          status: detail.status,
          judgedDate: detail.judgedDate,
        });
      }
    return found;
  }

  async problemRows(
    ids: string[],
  ): Promise<Map<string, { code: string; name: string }>> {
    return new Map(
      (
        await this.problems
          .find({ _id: { $in: ids } }, { code: 1, name: 1 })
          .lean()
          .exec()
      ).map((row) => [uuidStr(row._id), { code: row.code, name: row.name }]),
    );
  }

  async languageRows(
    ids: string[],
  ): Promise<Array<{ id: string; name: string; extension: string }>> {
    const rows = await this.languages
      .find({ _id: { $in: ids } }, { name: 1, extension: 1 })
      .lean()
      .exec();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      name: row.name,
      extension: row.extension,
    }));
  }
}
