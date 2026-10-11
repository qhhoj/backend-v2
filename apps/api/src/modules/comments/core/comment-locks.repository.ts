import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isDuplicateKey } from '@libs/common';
import { pageOf } from '@libs/community';
import type { CommentPage } from '@libs/community';
import { CommentLock } from '@libs/database';

const filterOf = (page: CommentPage) => ({
  'page.type': page.type,
  'page.id': page.id,
});

@Injectable()
export class CommentLocksRepository {
  constructor(
    @InjectModel(CommentLock.name) private readonly locks: Model<CommentLock>,
  ) {}

  async isLocked(page: CommentPage): Promise<boolean> {
    return (await this.locks.exists(filterOf(page)).exec()) !== null;
  }

  /** Idempotent: a second lock of the page is a no-op. */
  async lock(page: CommentPage): Promise<void> {
    try {
      await this.locks.create({ page });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  async unlock(page: CommentPage): Promise<void> {
    await this.locks.deleteOne(filterOf(page)).exec();
  }

  /** One page of locked pages, the newest lock first (UUIDv7 ids sort by time). */
  async page(
    page: number,
    pageSize: number,
  ): Promise<{ items: CommentPage[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.locks
        .find({}, { page: 1 })
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<CommentLock[]>()
        .exec(),
      this.locks.estimatedDocumentCount().exec(),
    ]);
    return {
      items: rows.map(pageOf),
      total,
    };
  }
}
