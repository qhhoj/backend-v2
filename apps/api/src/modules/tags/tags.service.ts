import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  AppError,
  escapeRegExp,
  isDuplicateKey,
  Paginated,
} from '@libs/common';
import { TAG_PROBLEM_CODE_PATTERN, uuidStr } from '@libs/database';
import type { Tag, TagProblem } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { AssignTagsDto } from './dto/tag-assign.dto';
import { CreateTagProblemDto } from './dto/tag-problem-create.dto';
import { TagProblemListQueryDto } from './dto/tag-problem-list.dto';
import {
  TagCatalogResponse,
  TagGroupResponse,
  TagProblemListItemResponse,
  TagProblemResponse,
  TagResponse,
} from './dto/tag.response';
import { UserSummaryResponse } from '../problems/core/dto/user-summary.response';
import { TagGroupsQuerier } from './tag-groups.querier';
import { parseProblemLink } from './tag-links';
import { TagProblemsRepository } from './tag-problems.repository';
import type { TagProblemDocument } from './tag-problems.repository';
import { TagsQuerier } from './tags.querier';

/** Legacy VNOJ_TAG_PROBLEM_MIN_RATING. */
export const TAG_MIN_RATING = 1900;
const byCode = (left: { code: string }, right: { code: string }) =>
  left.code.localeCompare(right.code);

@Injectable()
export class TagsService {
  constructor(
    private readonly groups: TagGroupsQuerier,
    private readonly tags: TagsQuerier,
    private readonly repository: TagProblemsRepository,
    private readonly users: UsersRepository,
  ) {}

  async list(
    query: TagProblemListQueryDto,
  ): Promise<Paginated<TagProblemListItemResponse>> {
    const clauses: FilterQuery<TagProblem>[] = [];
    if (query.tag) {
      const tag = this.tags.byCode(query.tag);
      clauses.push(tag ? { 'tags.tagId': tag._id } : { _id: null });
    }
    if (query.search?.trim()) {
      const pattern = new RegExp(escapeRegExp(query.search.trim()), 'i');
      clauses.push({ $or: [{ code: pattern }, { name: pattern }] });
    }
    if (query.judges?.length) clauses.push({ judge: { $in: query.judges } });
    const { items, total } = await this.repository.list(
      clauses.length ? { $and: clauses } : {},
      query.page,
      query.pageSize,
    );
    return new Paginated(
      items.map((problem) =>
        TagProblemListItemResponse.from(problem, this.tagsOf(problem)),
      ),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  catalog(): TagCatalogResponse {
    return {
      groups: this.groups
        .all()
        .sort(byCode)
        .map((group) =>
          TagGroupResponse.from(
            group,
            this.tags.byGroup(group._id).sort(byCode),
          ),
        ),
    };
  }

  async detail(code: string): Promise<TagProblemResponse> {
    return this.response(await this.existing(code));
  }

  /** Legacy `TagProblemCreate` without the judge API call: code and judge come from the url presets, the name from the client. */
  async create(
    auth: AuthContext,
    dto: CreateTagProblemDto,
  ): Promise<TagProblemResponse> {
    this.assertCanTag(auth);
    const parsed = parseProblemLink(dto.link);
    if (!parsed)
      throw new AppError('validation_failed', 400, 'Unsupported problem link', {
        link: ['This link or online judge is not currently supported.'],
      });
    if (await this.repository.findByCode(parsed.code))
      throw this.alreadyExists(parsed.code);
    const problem = await this.repository
      .create({
        code: parsed.code,
        name: dto.name,
        link: dto.link,
        judge: parsed.judge,
        tags: [],
      })
      .catch((error: unknown) => {
        throw isDuplicateKey(error, 'code')
          ? this.alreadyExists(parsed.code)
          : error;
      });
    await this.repository.appendRevision({
      entityId: problem._id,
      action: 'create',
      userId: auth.principal.userId,
      changes: {
        code: { before: null, after: problem.code },
        name: { before: null, after: problem.name },
        link: { before: null, after: problem.link },
      },
      comment: 'Created on site',
    });
    return this.response(problem);
  }

  private alreadyExists(code: string): AppError {
    return new AppError('conflict', 409, `Tag problem ${code} already exists`);
  }

  /** Adds the tags that are not on the problem yet (legacy ignores duplicates) and records who added what. */
  async assign(
    auth: AuthContext,
    code: string,
    dto: AssignTagsDto,
  ): Promise<TagProblemResponse> {
    this.assertCanTag(auth);
    const problem = await this.existing(code);
    const unknown = dto.tagCodes.filter(
      (tagCode) => !this.tags.byCode(tagCode),
    );
    if (unknown.length)
      throw new AppError('validation_failed', 400, 'Unknown tags', {
        tagCodes: [`Unknown tag: ${unknown.join(', ')}`],
      });
    const before = this.tagsOf(problem);
    const requested = new Map(
      dto.tagCodes.map((tagCode) => {
        const tag = this.tags.byCode(tagCode)!;
        return [tag._id, tag];
      }),
    );
    const added: Tag[] = [];
    for (const tag of requested.values())
      if (
        await this.repository.assign(problem._id, {
          tagId: tag._id,
          assignerId: auth.principal.userId,
        })
      )
        added.push(tag);
    if (added.length)
      await this.repository.appendRevision({
        entityId: problem._id,
        action: 'assign',
        userId: auth.principal.userId,
        changes: {
          tags: {
            before: before.map((tag) => tag.code),
            after: [...before, ...added].sort(byCode).map((tag) => tag.code),
          },
        },
        comment: `Assigned new tags ${added.map((tag) => tag.name).join(', ')} from site`,
      });
    return this.detail(problem.code);
  }

  /** Legacy `Profile.can_tag_problems`: opted in, and either the permission or a rating of at least 1900. */
  assertCanTag(auth: AuthContext): void {
    const allowed =
      auth.user.allowTagging &&
      (hasPermission(auth.principal, 'judge.add_tagproblem') ||
        (auth.user.rating !== null && auth.user.rating >= TAG_MIN_RATING));
    if (!allowed)
      throw new AppError(
        'forbidden',
        403,
        'You are not allowed to tag problems.',
      );
  }

  /** 404 for malformed and unknown codes alike. */
  private async existing(code: string): Promise<TagProblemDocument> {
    const problem = TAG_PROBLEM_CODE_PATTERN.test(code)
      ? await this.repository.findByCode(code)
      : null;
    if (!problem)
      throw new AppError(
        'not_found',
        404,
        `Could not find a problem with the code "${code}".`,
      );
    return problem;
  }

  private tagsOf(problem: TagProblem): Tag[] {
    return this.tags
      .byIds(problem.tags.map((assignment) => uuidStr(assignment.tagId)))
      .sort(byCode);
  }

  private async response(
    problem: TagProblemDocument,
  ): Promise<TagProblemResponse> {
    const tags = this.tagsOf(problem);
    const assignerIds = [
      ...new Set(
        problem.tags.map((assignment) => uuidStr(assignment.assignerId)),
      ),
    ];
    const users = new Map(
      (await this.users.findByIds(assignerIds)).map((user) => [user._id, user]),
    );
    const assignments = tags.map((tag) => {
      const assignment = problem.tags.find(
        (candidate) => uuidStr(candidate.tagId) === tag._id,
      )!;
      const assigner = users.get(uuidStr(assignment.assignerId));
      return {
        tag: TagResponse.from(tag),
        assigner: assigner ? UserSummaryResponse.from(assigner) : null,
      };
    });
    return { ...TagProblemListItemResponse.from(problem, tags), assignments };
  }
}
