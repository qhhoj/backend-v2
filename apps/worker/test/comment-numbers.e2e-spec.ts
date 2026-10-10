import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { childPath, rootOf } from '@libs/community';
import type { CommentPage } from '@libs/community';
import { CommentPageCounter, newId } from '@libs/database';
import type { Comment } from '@libs/database';
import { CommentNumbersService } from '../src/jobs/comment-numbers/comment-numbers.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('comment numbers backfill', () => {
  let worker: WorkerTest;
  let counters: Model<CommentPageCounter>;
  const author = newId();
  const insert = async (page: CommentPage, extra: Partial<Comment> = {}) => {
    const id = newId();
    const path = childPath(null, id);
    await worker.comments.create({
      _id: id,
      page,
      author,
      parentId: null,
      threadId: rootOf(path),
      path,
      body: 'b',
      ...extra,
    });
    return id;
  };
  const numbersOf = async (ids: string[]) => {
    const rows = await worker.comments
      .find({ _id: { $in: ids } }, { number: 1 })
      .lean();
    const byId = new Map(rows.map((row) => [String(row._id), row.number]));
    return ids.map((id) => byId.get(id));
  };

  beforeAll(async () => {
    worker = await setupWorkerTest();
    counters = worker.module.get(getModelToken(CommentPageCounter.name));
  });
  afterAll(() => worker.teardown());

  it('numbers each page 1..n in posting order and seeds its counter after them', async () => {
    const page: CommentPage = { type: 'blog', id: newId() };
    const other: CommentPage = { type: 'blog', id: newId() };
    const ids = [
      await insert(page),
      await insert(page, { hidden: true }),
      await insert(page, { deletedAt: new Date() }),
    ];
    const elsewhere = await insert(other);

    await worker.module.get(CommentNumbersService).backfill();

    expect(await numbersOf(ids)).toEqual([1, 2, 3]);
    expect(await numbersOf([elsewhere])).toEqual([1]);
    const counter = await counters
      .findOne({ 'page.type': 'blog', 'page.id': page.id })
      .lean();
    expect(counter?.seq).toBe(3);
  });

  it('leaves rows the api numbered alone, and a second run changes nothing', async () => {
    const page: CommentPage = { type: 'blog', id: newId() };
    const old = [await insert(page), await insert(page)];
    // The api posted first: it seeded the counter with the 2 old rows and took 3.
    await counters.create({ page, seq: 3 });
    const fresh = await insert(page, { number: 3 });

    const service = worker.module.get(CommentNumbersService);
    await service.backfill();
    expect(await numbersOf([...old, fresh])).toEqual([1, 2, 3]);
    expect(await service.backfill()).toEqual({ pages: 0, comments: 0 });
  });
});
