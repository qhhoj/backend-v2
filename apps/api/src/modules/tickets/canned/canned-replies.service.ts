import { Injectable } from '@nestjs/common';
import { AppError, Paginated } from '@libs/common';
import {
  TICKET_CANNED_REPLIES_MAX,
  TICKET_CANNED_REPLIES_PAGE_SIZE,
} from '@libs/community';
import { CannedRepliesRepository } from './canned-replies.repository';
import type {
  CannedReplyPageQueryDto,
  CreateCannedReplyDto,
  UpdateCannedReplyDto,
} from './dto/canned-reply.dto';
import { CannedReplyResponse } from './dto/canned-reply.response';

const notFound = () => new AppError('not_found', 404, 'No such canned reply');

@Injectable()
export class CannedRepliesService {
  constructor(private readonly replies: CannedRepliesRepository) {}

  async list({
    page,
  }: CannedReplyPageQueryDto): Promise<Paginated<CannedReplyResponse>> {
    const { rows, total } = await this.replies.page(page);
    return new Paginated(
      rows.map((row) => CannedReplyResponse.from(row)),
      { page, pageSize: TICKET_CANNED_REPLIES_PAGE_SIZE, total },
    );
  }

  /** Refuses past `TICKET_CANNED_REPLIES_MAX`; two creates that race past the check can both insert, so the cap is soft by that margin. */
  async create(
    userId: string,
    dto: CreateCannedReplyDto,
  ): Promise<CannedReplyResponse> {
    if ((await this.replies.count()) >= TICKET_CANNED_REPLIES_MAX)
      throw new AppError(
        'conflict',
        409,
        `There are already ${TICKET_CANNED_REPLIES_MAX} canned replies`,
      );
    const order = dto.order ?? (await this.replies.nextOrder());
    const created = await this.replies.create({
      title: dto.title,
      body: dto.body,
      order,
      createdBy: userId,
    });
    return CannedReplyResponse.from(created);
  }

  async update(
    id: string,
    dto: UpdateCannedReplyDto,
  ): Promise<CannedReplyResponse> {
    const updated = await this.replies.update(id, dto);
    if (!updated) throw notFound();
    return CannedReplyResponse.from(updated);
  }

  async remove(id: string): Promise<void> {
    if (!(await this.replies.remove(id))) throw notFound();
  }
}
