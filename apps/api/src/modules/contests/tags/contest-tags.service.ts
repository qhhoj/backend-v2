import { Injectable, Logger } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import { ContestAccess } from '../core/contest-access';
import { ContestTagsQuerier } from './contest-tags.querier';
import { ContestTagsRepository } from './contest-tags.repository';
import { MAX_CONTEST_TAGS } from './dto/contest-tag.dto';
import type {
  ContestTagListQueryDto,
  CreateContestTagDto,
  UpdateContestTagDto,
} from './dto/contest-tag.dto';
import { ContestTagResponse } from './dto/contest-tag.response';

const noSuchTag = () => new AppError('not_found', 404, 'No such tag');

@Injectable()
export class ContestTagsService {
  private readonly logger = new Logger(ContestTagsService.name);

  constructor(
    private readonly tags: ContestTagsRepository,
    private readonly querier: ContestTagsQuerier,
  ) {}

  /** Each tag counts only the contests the viewer may see, so a count never reveals a hidden contest. */
  async list(
    principal: Principal | null,
    { page, pageSize }: ContestTagListQueryDto,
  ): Promise<Paginated<ContestTagResponse>> {
    const ordered = this.querier.ordered();
    const counts = await this.tags.countsBySlug(
      ContestAccess.visibleFilter(principal),
    );
    const items = ordered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((tag) => ContestTagResponse.from(tag, counts.get(tag.slug) ?? 0));
    return new Paginated(items, { page, pageSize, total: ordered.length });
  }

  async create(dto: CreateContestTagDto): Promise<ContestTagResponse> {
    if ((await this.tags.count()) >= MAX_CONTEST_TAGS)
      throw new AppError('tag_limit', 409, 'The tag catalogue is full');
    const tag = await this.tags.create(dto);
    await this.querier.resync();
    return ContestTagResponse.from(tag);
  }

  async update(
    principal: Principal,
    slug: string,
    dto: UpdateContestTagDto,
  ): Promise<ContestTagResponse> {
    const tag = await this.tags.updateBySlug(slug, dto);
    if (!tag) throw noSuchTag();
    await this.querier.resync();
    const contestCount = await this.tags.countMatching({
      $and: [ContestAccess.visibleFilter(principal), { tags: slug }],
    });
    return ContestTagResponse.from(tag, contestCount);
  }

  /** Contests keep the slug and show a neutral chip; the log line records who deleted what. */
  async remove(actor: Principal, slug: string): Promise<void> {
    if (!(await this.tags.deleteBySlug(slug))) throw noSuchTag();
    await this.querier.resync();
    this.logger.log(
      JSON.stringify({
        event: 'contest-tag-deleted',
        slug,
        actorId: actor.userId,
        contestsStillUsing: await this.tags.countContestsUsing(slug),
      }),
    );
  }
}
