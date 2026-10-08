import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { unique } from '@libs/common';
import { pageOf } from '@libs/community';
import type { Model } from 'mongoose';
import {
  BlogPost,
  Comment,
  Contest,
  Organization,
  Problem,
  TagProblem,
  uuidStr,
} from '@libs/database';

export interface UserDataComment {
  id: string;
  date: Date;
  page: { type: string; key: string };
  score: number;
  hidden: boolean;
}

export interface UserDataPost {
  id: string;
  title: string;
  publishOn: Date;
  visible: boolean;
  organization: string | null;
  score: number;
}

/** The community reads of the data export: own comments and posts, with their bodies. */
@Injectable()
export class UserDataCommunityRepository {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(TagProblem.name)
    private readonly tagProblems: Model<TagProblem>,
  ) {}

  /** Every own comment, hidden ones too (legacy), oldest first; page ids become the keys the site routes by. `hidden: {$in}` lets `{author, hidden, _id}` serve the `_id` sort. */
  async commentsOf(userId: string, limit: number): Promise<UserDataComment[]> {
    const rows = await this.comments
      .find(
        { author: userId, hidden: { $in: [false, true] } },
        { page: 1, score: 1, hidden: 1, createdAt: 1 },
      )
      .sort({ _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    const idsOf = (...types: string[]) =>
      unique(
        rows
          .filter((row) => types.includes(row.page.type))
          .map((row) => uuidStr(row.page.id)),
      );
    const [problems, contests, tagProblems] = await Promise.all([
      this.problems
        .find({ _id: { $in: idsOf('problem', 'editorial') } }, { code: 1 })
        .lean()
        .exec(),
      this.contests
        .find({ _id: { $in: idsOf('contest') } }, { key: 1 })
        .lean()
        .exec(),
      this.tagProblems
        .find({ _id: { $in: idsOf('tagProblem') } }, { code: 1 })
        .lean()
        .exec(),
    ]);
    const keyOf = new Map<string, string>([
      ...problems.map(
        (problem) => [uuidStr(problem._id), problem.code] as const,
      ),
      ...contests.map(
        (contest) => [uuidStr(contest._id), contest.key] as const,
      ),
      ...tagProblems.map(
        (tagProblem) => [uuidStr(tagProblem._id), tagProblem.code] as const,
      ),
    ]);
    return rows.map((row) => {
      const { type, id: pageId } = pageOf(row);
      return {
        id: uuidStr(row._id),
        date: row.createdAt,
        page: {
          type,
          key: type === 'blog' ? pageId : (keyOf.get(pageId) ?? ''),
        },
        score: row.score,
        hidden: row.hidden,
      };
    });
  }

  /** Every post the user authored or co-authored, oldest first (sorted here: the `authors` index cannot serve an `_id` sort, so the read stays bounded by the user's posts). */
  async postsOf(userId: string, limit: number): Promise<UserDataPost[]> {
    const rows = await this.posts
      .find(
        { authors: userId },
        {
          title: 1,
          publishOn: 1,
          visible: 1,
          organization: 1,
          score: 1,
        },
      )
      .limit(limit)
      .lean()
      .exec();
    const slugOf = new Map(
      (
        await this.organizations
          .find(
            {
              _id: {
                $in: unique(
                  rows.flatMap((row) =>
                    row.organization ? [uuidStr(row.organization)] : [],
                  ),
                ),
              },
            },
            { slug: 1 },
          )
          .lean()
          .exec()
      ).map((organization) => [uuidStr(organization._id), organization.slug]),
    );
    return rows
      .map((row) => ({
        id: uuidStr(row._id),
        title: row.title,
        publishOn: row.publishOn,
        visible: row.visible,
        organization: row.organization
          ? (slugOf.get(uuidStr(row.organization)) ?? null)
          : null,
        score: row.score,
      }))
      .sort((first, second) => (first.id < second.id ? -1 : 1));
  }

  async commentBodies(ids: string[]): Promise<Map<string, string>> {
    return new Map(
      (
        await this.comments
          .find({ _id: { $in: ids } }, { body: 1 })
          .lean()
          .exec()
      ).map((row) => [uuidStr(row._id), row.body]),
    );
  }

  /** Content, then the summary after a `---` line when there is one. */
  async postTexts(ids: string[]): Promise<Map<string, string>> {
    return new Map(
      (
        await this.posts
          .find({ _id: { $in: ids } }, { content: 1, summary: 1 })
          .lean()
          .exec()
      ).map((row) => [
        uuidStr(row._id),
        row.summary ? `${row.content}\n\n---\n\n${row.summary}` : row.content,
      ]),
    );
  }
}
