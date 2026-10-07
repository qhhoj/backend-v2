import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  Language,
  Organization,
  Problem,
  Submission,
  SubmissionSource,
  User,
  uuidStr,
} from '@libs/database';

export interface UserDataSubmission {
  id: string;
  problem: string;
  date: Date;
  time: number | null;
  memory: number | null;
  language: string;
  extension: string;
  status: string;
  result: string | null;
  casePoints: number;
  caseTotal: number;
}

/** Whitelisted: never the password hash, second-factor secrets, API token hash, staff notes, IPs or social login data. */
const PROFILE_FIELDS = {
  _id: 0,
  username: 1,
  email: 1,
  firstName: 1,
  lastName: 1,
  dateJoined: 1,
  lastLogin: 1,
  about: 1,
  timezone: 1,
  languageId: 1,
  aceTheme: 1,
  siteTheme: 1,
  mathEngine: 1,
  userScript: 1,
  points: 1,
  performancePoints: 1,
  problemCount: 1,
  contributionPoints: 1,
  rating: 1,
  displayRank: 1,
  organizations: 1,
} as const;

const unique = (values: string[]) => [...new Set(values)];

@Injectable()
export class UserDataRepository {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sourceRows: Model<SubmissionSource>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
  ) {}

  /** The exported profile: ids replaced by slugs and keys. */
  async profile(userId: string): Promise<Record<string, unknown> | null> {
    const user = await this.users
      .findById(userId, PROFILE_FIELDS)
      .lean()
      .exec();
    if (!user) return null;
    const { organizations, languageId, ...fields } = user;
    const slugs = await this.organizations
      .find({ _id: { $in: organizations.map(uuidStr) } }, { slug: 1 })
      .lean()
      .exec();
    const language =
      languageId &&
      (await this.languages
        .findById(uuidStr(languageId), { key: 1 })
        .lean()
        .exec());
    return {
      ...fields,
      organizations: slugs.map((organization) => organization.slug),
      language: language ? language.key : null,
    };
  }

  /** The user's submissions, oldest first, through `{user, _id}`; at most `limit` rows. */
  async submissionsOf(
    userId: string,
    limit: number,
  ): Promise<UserDataSubmission[]> {
    const rows = await this.submissions
      .find(
        { user: userId },
        {
          problem: 1,
          date: 1,
          time: 1,
          memory: 1,
          language: 1,
          status: 1,
          result: 1,
          casePoints: 1,
          caseTotal: 1,
        },
      )
      .sort({ _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    const [codes, languages] = await Promise.all([
      this.problems
        .find(
          { _id: { $in: unique(rows.map((row) => uuidStr(row.problem))) } },
          { code: 1 },
        )
        .lean()
        .exec(),
      this.languages
        .find(
          { _id: { $in: unique(rows.map((row) => uuidStr(row.language))) } },
          { key: 1, extension: 1 },
        )
        .lean()
        .exec(),
    ]);
    const codeOf = new Map(
      codes.map((problem) => [uuidStr(problem._id), problem.code]),
    );
    const languageOf = new Map(
      languages.map((language) => [uuidStr(language._id), language]),
    );
    return rows.map((row) => {
      const language = languageOf.get(uuidStr(row.language));
      return {
        id: uuidStr(row._id),
        problem: codeOf.get(uuidStr(row.problem)) ?? '',
        date: row.date,
        time: row.time,
        memory: row.memory,
        language: language?.key ?? '',
        extension: language?.extension ?? 'txt',
        status: row.status,
        result: row.result,
        casePoints: row.casePoints,
        caseTotal: row.caseTotal,
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
}
