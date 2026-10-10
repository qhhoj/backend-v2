import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isDuplicateKey } from '@libs/common';
import { pageOf } from '@libs/community';
import type { CommentPage } from '@libs/community';
import { Comment, CommentPageCounter, uuidStr } from '@libs/database';

const pageFilter = (page: CommentPage) => ({
  'page.type': page.type,
  'page.id': page.id,
});

@Injectable()
export class CommentNumbersRepository {
  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(CommentPageCounter.name)
    private readonly counters: Model<CommentPageCounter>,
  ) {}

  /** Pages holding unnumbered comments. */
  async pagesToNumber(): Promise<CommentPage[]> {
    const rows = await this.comments
      .aggregate<{
        _id: { type: CommentPage['type']; id: unknown };
      }>([
        { $match: { number: null } },
        { $group: { _id: { type: '$page.type', id: '$page.id' } } },
      ])
      .exec();
    return rows.map((row) => pageOf({ page: row._id }));
  }

  /** The api's seed (`CommentsRepository.nextNumber`): a page without a counter starts at its comment count, so posts made during the backfill go after the rows it numbers. */
  async seedCounter(page: CommentPage): Promise<void> {
    if (await this.counters.exists(pageFilter(page)).exec()) return;
    const seq = await this.comments.countDocuments(pageFilter(page)).exec();
    try {
      await this.counters.create({ page, seq });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  /** Numbers the page's unnumbered rows 1..n in posting (`_id`) order; a row numbered meanwhile is left alone. Returns n. */
  async numberUnnumbered(page: CommentPage): Promise<number> {
    const rows: Array<{ _id: unknown }> = await this.comments
      .find({ ...pageFilter(page), number: null }, { _id: 1 })
      .sort({ _id: 1 })
      .lean()
      .exec();
    if (!rows.length) return 0;
    await this.comments.bulkWrite(
      rows.map((row, index) => ({
        updateOne: {
          filter: { _id: uuidStr(row._id), number: null },
          update: { $set: { number: index + 1 } },
        },
      })),
      { ordered: false },
    );
    return rows.length;
  }
}
