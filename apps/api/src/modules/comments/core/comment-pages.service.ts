import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import { pageRef } from '@libs/community';
import type { CommentPage, CommentPageType } from '@libs/community';
import {
  CONTEST_KEY_PATTERN,
  isUuid,
  PROBLEM_CODE_PATTERN,
  TAG_PROBLEM_CODE_PATTERN,
  uuidStr,
} from '@libs/database';
import type { BlogPost, Contest, Problem, TagProblem } from '@libs/database';
import { BlogAccess } from '../../blog/core/blog-access';
import type { BlogAccessView } from '../../blog/core/blog-access';
import { BlogPostsRepository } from '../../blog/core/blog-posts.repository';
import { BlogVisibilityService } from '../../blog/core/blog-visibility.service';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestsRepository } from '../../contests/core/contests.repository';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ContestScope } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ProblemsService } from '../../problems/core/problems.service';
import { TagProblemsRepository } from '../../tags/tag-problems.repository';

export interface PageInfo {
  page: CommentPage;
  /** The natural key the SPA routes by (problem code, contest key, post id, tag problem code). */
  key: string;
  title: string;
  /** Readable by a signed-out viewer: Discord announcements and the comment feed. */
  isPublic: boolean;
  /** The viewer's started contest holds this problem: no discussion (legacy locked it for contests with clarifications, which v2 dropped). */
  contestLocked: boolean;
}

/** Legacy `Comment.is_accessible_by` and `get_newest_visible_comments`: the one place that decides which comment pages a viewer may read, by reusing each page's own access rules. */
@Injectable()
export class CommentPagesService {
  constructor(
    private readonly problems: ProblemsRepository,
    private readonly problemsService: ProblemsService,
    private readonly contests: ContestsRepository,
    private readonly currentContest: CurrentContestService,
    private readonly posts: BlogPostsRepository,
    private readonly postVisibility: BlogVisibilityService,
    private readonly tagProblems: TagProblemsRepository,
  ) {}

  /** A page by its natural key; 404 when malformed, unknown or unreadable, so existence never leaks. */
  async resolve(
    principal: Principal | null,
    type: CommentPageType,
    key: string,
  ): Promise<PageInfo> {
    const id = await this.idOf(type, key);
    const pageInfo =
      id &&
      (await this.accessible(principal, [{ type, id }])).get(
        pageRef({ type, id }),
      );
    if (!pageInfo) throw new AppError('not_found', 404, 'No such page');
    return pageInfo;
  }

  /** The readable ones among `pages`, keyed by `pageRef`; one read per page type whatever the count. A caller scanning in batches passes the viewer's `scope` (null: outside any contest) so it is computed once. */
  async accessible(
    principal: Principal | null,
    pages: readonly CommentPage[],
    now = new Date(),
    knownScope?: ContestScope | null,
  ): Promise<Map<string, PageInfo>> {
    const idsOf = (...types: CommentPageType[]) =>
      unique(
        pages
          .filter((page) => types.includes(page.type))
          .map((page) => page.id),
      );
    const problemIds = idsOf('problem', 'editorial');
    const [scope, problems, contests, posts, tagProblems] = await Promise.all([
      knownScope !== undefined || !problemIds.length
        ? (knownScope ?? null)
        : this.currentContest.scopeOf(principal, now),
      this.problems.findByIds(problemIds),
      this.contests.findByIds(idsOf('contest')),
      this.posts.findByIds(idsOf('blog')),
      this.tagProblems.findByIds(idsOf('tagProblem')),
    ]);
    const postViews = await this.postVisibility.viewsOf(posts);
    const found = [
      ...problems.flatMap((problem) => [
        this.problemPage(principal, problem, scope),
        this.editorialPage(principal, problem, scope),
      ]),
      ...contests.map((contest) => this.contestPage(principal, contest)),
      ...posts.map((post) => this.blogPage(principal, post, postViews, now)),
      ...tagProblems.map((tagProblem) => this.tagProblemPage(tagProblem)),
    ];
    const byRef = new Map(
      found.flatMap((pageInfo) =>
        pageInfo ? [[pageRef(pageInfo.page), pageInfo] as const] : [],
      ),
    );
    return new Map(
      pages.flatMap((page) => {
        const pageInfo = byRef.get(pageRef(page));
        return pageInfo ? [[pageRef(page), pageInfo] as const] : [];
      }),
    );
  }

  /** Legacy `Problem.is_accessible_by`, contest scope included (`ProblemsService.visibleProblem`). */
  private problemPage(
    principal: Principal | null,
    problem: Problem,
    scope: ContestScope | null,
  ): PageInfo | null {
    const view = ProblemAccess.accessView(problem);
    if (!ProblemAccess.canSee(principal, view, scope)) return null;
    return {
      page: { type: 'problem', id: view.id },
      key: problem.code,
      title: problem.name,
      isPublic: ProblemAccess.canSee(null, view, null),
      contestLocked:
        scope !== null && scope.started && scope.problemIds.includes(view.id),
    };
  }

  /** `ProblemsService.editorialReadable`. */
  private editorialPage(
    principal: Principal | null,
    problem: Problem,
    scope: ContestScope | null,
  ): PageInfo | null {
    if (!this.problemsService.editorialReadable(principal, problem, scope))
      return null;
    return {
      page: { type: 'editorial', id: uuidStr(problem._id) },
      key: problem.code,
      title: `Editorial for ${problem.name}`,
      isPublic: this.problemsService.editorialReadable(null, problem, null),
      contestLocked: false,
    };
  }

  /** Legacy `Contest.is_accessible_by` (`ContestAccess.canSee`). */
  private contestPage(
    principal: Principal | null,
    contest: Contest,
  ): PageInfo | null {
    const view = ContestAccess.accessView(contest);
    if (!ContestAccess.canSee(principal, view)) return null;
    return {
      page: { type: 'contest', id: uuidStr(contest._id) },
      key: contest.key,
      title: contest.name,
      isPublic: ContestAccess.canSee(null, view),
      contestLocked: false,
    };
  }

  /** Legacy `BlogPost.can_see`. */
  private blogPage(
    principal: Principal | null,
    post: BlogPost,
    views: Map<string, BlogAccessView>,
    now: Date,
  ): PageInfo | null {
    const view = views.get(uuidStr(post._id));
    if (!view || !BlogAccess.canSee(principal, view, now)) return null;
    return {
      page: { type: 'blog', id: view.id },
      key: view.id,
      title: post.title,
      isPublic: BlogAccess.canSee(null, view, now),
      contestLocked: false,
    };
  }

  /** Legacy `t:` pages are open to everyone. */
  private tagProblemPage(tagProblem: TagProblem): PageInfo {
    return {
      page: { type: 'tagProblem', id: uuidStr(tagProblem._id) },
      key: tagProblem.code,
      title: tagProblem.name,
      isPublic: true,
      contestLocked: false,
    };
  }

  private idOf(type: CommentPageType, key: string): Promise<string | null> {
    switch (type) {
      case 'problem':
      case 'editorial':
        return PROBLEM_CODE_PATTERN.test(key)
          ? this.problems.idByCode(key)
          : Promise.resolve(null);
      case 'contest':
        return CONTEST_KEY_PATTERN.test(key)
          ? this.contests.idByKey(key)
          : Promise.resolve(null);
      case 'blog':
        return Promise.resolve(isUuid(key) ? key : null);
      case 'tagProblem':
        return TAG_PROBLEM_CODE_PATTERN.test(key)
          ? this.tagProblems.idByCode(key)
          : Promise.resolve(null);
    }
  }
}
