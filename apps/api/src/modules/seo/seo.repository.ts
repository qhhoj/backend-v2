import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { BlogPost, CI, Contest, Problem, User } from '@libs/database';
import { ProblemAccess } from '@libs/problems';
import { BlogAccess } from '../blog/core/blog-access';
import { ContestAccess } from '../contests/core/contest-access';
import { LISTED_USERS } from '../users/core/listed-users';

/** Everything below is the signed-out viewer's view: nothing private, unpublished, unlisted or deleted. */
export const SITEMAP_PAGE_SIZE = 10_000;

/** The pieces of a record a link preview prints. */
export interface PreviewSource {
  title: string;
  /** HTML or plain text; the caller turns it into an excerpt. */
  text: string;
  /** The page's own preview image (URL or site path); absent or empty for the site image. */
  image?: string;
}

interface UrlSource {
  path: string;
}

export interface Lister {
  count(): Promise<number>;
  page(page: number): Promise<UrlSource[]>;
}

const lister = <T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  field: string,
  toPath: (value: string) => string,
): Lister => ({
  count: () => model.countDocuments(filter).exec(),
  page: async (page) =>
    (
      await model
        .find(filter, { [field]: 1 })
        .sort({ _id: 1 })
        .skip((page - 1) * SITEMAP_PAGE_SIZE)
        .limit(SITEMAP_PAGE_SIZE)
        .lean<Array<Record<string, string>>>()
        .exec()
    ).map((doc) => ({ path: toPath(doc[field]) })),
});

const encoded = (prefix: string) => (value: string) =>
  `${prefix}/${encodeURIComponent(value)}`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SeoRepository {
  readonly problems: Lister;
  readonly contests: Lister;
  readonly posts: Lister;
  readonly users: Lister;

  constructor(
    @InjectModel(Problem.name) private readonly problemModel: Model<Problem>,
    @InjectModel(Contest.name) private readonly contestModel: Model<Contest>,
    @InjectModel(BlogPost.name) private readonly postModel: Model<BlogPost>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {
    this.problems = lister(
      problemModel,
      this.problemFilter(),
      'code',
      encoded('/problems'),
    );
    this.contests = lister(
      contestModel,
      ContestAccess.visibleFilter(null),
      'key',
      encoded('/contests'),
    );
    this.posts = lister(
      postModel,
      BlogAccess.publishedPersonalFilter(new Date()),
      '_id',
      encoded('/blog'),
    );
    this.users = lister(userModel, LISTED_USERS, 'username', encoded('/users'));
  }

  private problemFilter(): FilterQuery<Problem> {
    return { ...ProblemAccess.visibleFilter(null, null), deletedAt: null };
  }

  async problem(code: string): Promise<PreviewSource | null> {
    const doc = await this.problemModel
      .findOne(
        { ...this.problemFilter(), code },
        { name: 1, descriptionHtml: 1 },
      )
      .lean<{ name: string; descriptionHtml: string }>()
      .exec();
    return doc && { title: doc.name, text: doc.descriptionHtml };
  }

  async contest(key: string): Promise<PreviewSource | null> {
    const doc = await this.contestModel
      .findOne(
        { ...ContestAccess.visibleFilter(null), key },
        { name: 1, summary: 1, descriptionHtml: 1, ogImage: 1 },
      )
      .lean<{
        name: string;
        summary: string;
        descriptionHtml: string;
        ogImage?: string;
      }>()
      .exec();
    return (
      doc && {
        title: doc.name,
        text: doc.summary || doc.descriptionHtml,
        image: doc.ogImage,
      }
    );
  }

  async post(id: string): Promise<PreviewSource | null> {
    if (!UUID_PATTERN.test(id)) return null;
    const doc = await this.postModel
      .findOne(
        { ...BlogAccess.publishedPersonalFilter(new Date()), _id: id },
        { title: 1, summaryHtml: 1, contentHtml: 1 },
      )
      .lean<{ title: string; summaryHtml: string; contentHtml: string }>()
      .exec();
    return (
      doc && { title: doc.title, text: doc.summaryHtml || doc.contentHtml }
    );
  }

  async user(username: string): Promise<PreviewSource | null> {
    const doc = await this.userModel
      .findOne({ ...LISTED_USERS, username }, { username: 1, aboutHtml: 1 })
      .collation(CI)
      .lean<{ username: string; aboutHtml: string }>()
      .exec();
    return doc && { title: doc.username, text: doc.aboutHtml };
  }
}
