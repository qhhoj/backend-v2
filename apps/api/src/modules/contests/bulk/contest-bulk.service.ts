import { Injectable } from '@nestjs/common';
import type { FilterQuery } from 'mongoose';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import type { Contest } from '@libs/database';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import { ContestEditFieldsService } from '../editing/contest-edit-fields.service';
import { ContestEditingService } from '../editing/contest-editing.service';
import { MAX_TAGS_PER_CONTEST } from '../editing/dto/contest-edit.dto';
import type { UpdateContestDto } from '../editing/dto/contest-edit.dto';
import type {
  BulkContestTagDto,
  BulkContestVisibilityDto,
} from './dto/contest-bulk.dto';
import type {
  BulkContestResponse,
  BulkContestResultResponse,
} from './dto/contest-bulk.response';

/** Per user: each run may edit up to 100 contests. */
const BULK_LIMIT = 20;
const BULK_WINDOW_SECONDS = 60 * 60;

/** One contest's edit: the PATCH body, null when the contest already is so; `guard` is the stored state the write still expects. */
interface BulkEdit {
  patch: UpdateContestDto | null;
  guard?: FilterQuery<Contest>;
}

const tooManyTags = () =>
  new AppError(
    'too_many_tags',
    409,
    `A contest carries at most ${MAX_TAGS_PER_CONTEST} tags`,
  );

/** Legacy admin actions `make_visible` / `make_hidden`, and tagging from the tag screen: one PATCH per contest, so each keeps its gates, cache purge and follow-ups. */
@Injectable()
export class ContestBulkService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly editFields: ContestEditFieldsService,
    private readonly editing: ContestEditingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  visibility(
    principal: Principal,
    dto: BulkContestVisibilityDto,
  ): Promise<BulkContestResponse> {
    return this.run(principal, dto.keys, (contest) => ({
      patch:
        contest.isVisible === dto.isVisible
          ? null
          : { isVisible: dto.isVisible },
    }));
  }

  /** The write expects the tags it read, so a concurrent tag edit fails as `conflict` instead of being lost. */
  tag(
    principal: Principal,
    dto: BulkContestTagDto,
  ): Promise<BulkContestResponse> {
    return this.run(principal, dto.keys, (contest) => {
      const tags = [...contest.tags];
      if (tags.includes(dto.tag) === dto.assigned) return { patch: null };
      if (dto.assigned && tags.length >= MAX_TAGS_PER_CONTEST)
        throw tooManyTags();
      return {
        patch: {
          tags: dto.assigned
            ? [...tags, dto.tag]
            : tags.filter((slug) => slug !== dto.tag),
        },
        guard: { tags },
      };
    });
  }

  /** Keys run one after another; a refused key is reported and the rest still apply. */
  private async run(
    principal: Principal,
    keys: string[],
    editOf: (contest: ContestDocument) => BulkEdit,
  ): Promise<BulkContestResponse> {
    await this.rateLimit.reserve(
      [`contests-bulk:user:${principal.userId}`],
      BULK_LIMIT,
      BULK_WINDOW_SECONDS,
    );
    const results: BulkContestResultResponse[] = [];
    for (const key of keys)
      results.push(await this.applyOne(principal, key, editOf));
    return {
      results,
      done: results.filter((result) => result.outcome === 'done').length,
      failed: results.filter((result) => result.outcome === 'failed').length,
    };
  }

  private async applyOne(
    principal: Principal,
    key: string,
    editOf: (contest: ContestDocument) => BulkEdit,
  ): Promise<BulkContestResultResponse> {
    try {
      const contest = await this.contestsService.editableContest(
        principal,
        key,
      );
      const { patch, guard } = editOf(contest);
      if (!patch) return { key, outcome: 'unchanged' };
      const fields = await this.editFields.toFields(principal, patch, contest);
      await this.editing.applyFields(principal, contest, fields, guard);
      return { key, outcome: 'done' };
    } catch (error) {
      if (error instanceof AppError)
        return { key, outcome: 'failed', reason: error.code };
      throw error;
    }
  }
}
