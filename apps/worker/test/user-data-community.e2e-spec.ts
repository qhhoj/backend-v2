import { childPath, userDataPath } from '@libs/community';
import { newId } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import {
  DEFAULT_USER_DATA_LIMITS,
  USER_DATA_LIMITS,
  UserDataError,
  UserDataService,
} from '../src/jobs/user-data/user-data.service';
import { seedProblem, seedUser } from './effects-fixtures';
import { readZip } from './read-zip';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('user data export of comments and posts', () => {
  const limits = { ...DEFAULT_USER_DATA_LIMITS };
  let worker: WorkerTest;
  let service: UserDataService;

  beforeAll(async () => {
    worker = await setupWorkerTest({
      overrides: [{ provide: USER_DATA_LIMITS, useValue: limits }],
    });
    service = worker.module.get(UserDataService);
  });
  afterEach(() => Object.assign(limits, DEFAULT_USER_DATA_LIMITS));
  afterAll(() => worker.teardown());

  it("exports the requester's comments, hidden ones included, and posts, nobody else's", async () => {
    const owner = await seedUser(worker);
    const other = await seedUser(worker);
    const problem = await seedProblem(worker, { code: 'talked_about' });
    const post = await worker.blogPosts.create({
      title: 'My post',
      slug: 'me',
      authors: [owner._id],
      publishOn: new Date('2026-01-01T00:00:00Z'),
      content: 'post body',
      summary: 'short',
      visible: true,
      score: 4,
    });
    await worker.blogPosts.create({
      title: 'Not mine',
      slug: 'other',
      authors: [other._id],
      publishOn: new Date('2026-01-01T00:00:00Z'),
      content: 'foreign post body',
    });
    const comment = async (
      author: string,
      page: { type: string; id: string },
      extra = {},
    ) => {
      const commentId = newId();
      return worker.comments.create({
        _id: commentId,
        page,
        author,
        threadId: commentId,
        path: childPath(null, commentId),
        body: `said by ${author === owner._id ? 'owner' : 'other'}`,
        ...extra,
      });
    };
    const onProblem = await comment(
      owner._id,
      { type: 'problem', id: problem._id },
      { score: 2 },
    );
    const hidden = await comment(
      owner._id,
      { type: 'blog', id: post._id },
      { hidden: true },
    );
    await comment(other._id, { type: 'problem', id: problem._id });
    expect(await service.prepare(owner._id)).toBe(6);
    const files = await readZip(userDataPath(worker.userDataRoot, owner._id));
    expect(Object.keys(files).sort()).toEqual(
      [
        'profile.json',
        'comments/info.json',
        `comments/${onProblem._id}.txt`,
        `comments/${hidden._id}.txt`,
        'posts/info.json',
        `posts/${post._id}.md`,
      ].sort(),
    );
    const commentInfo = JSON.parse(files['comments/info.json']) as Record<
      string,
      object
    >;
    expect(commentInfo).toEqual({
      [onProblem._id]: {
        date: onProblem.createdAt.toISOString(),
        page: { type: 'problem', key: 'talked_about' },
        score: 2,
        hidden: false,
      },
      [hidden._id]: {
        date: hidden.createdAt.toISOString(),
        page: { type: 'blog', key: post._id },
        score: 0,
        hidden: true,
      },
    });
    for (const entry of Object.values(commentInfo))
      expect(Object.keys(entry).sort()).toEqual([
        'date',
        'hidden',
        'page',
        'score',
      ]);
    expect(files[`comments/${onProblem._id}.txt`]).toBe('said by owner');
    const postInfo = JSON.parse(files['posts/info.json']) as Record<
      string,
      object
    >;
    expect(postInfo).toEqual({
      [post._id]: {
        title: 'My post',
        publish_on: '2026-01-01T00:00:00.000Z',
        visible: true,
        organization: null,
        score: 4,
      },
    });
    expect(Object.keys(postInfo[post._id]).sort()).toEqual([
      'organization',
      'publish_on',
      'score',
      'title',
      'visible',
    ]);
    expect(files[`posts/${post._id}.md`]).toBe('post body\n\n---\n\nshort');
    expect(JSON.stringify(files)).not.toContain('said by other');
    expect(JSON.stringify(files)).not.toContain('foreign post body');
  });

  it('exports a co-authored post and an empty key for a vanished page', async () => {
    const [owner, coauthor] = [await seedUser(worker), await seedUser(worker)];
    const post = await worker.blogPosts.create({
      title: 'Joint',
      slug: 'joint',
      authors: [coauthor._id, owner._id],
      publishOn: new Date('2026-02-01T00:00:00Z'),
      content: 'joint body',
    });
    const commentId = newId();
    await worker.comments.create({
      _id: commentId,
      page: { type: 'problem', id: newId() },
      author: owner._id,
      threadId: commentId,
      path: commentId,
      body: 'orphan',
    });
    await service.prepare(owner._id);
    const files = await readZip(userDataPath(worker.userDataRoot, owner._id));
    expect(files[`posts/${post._id}.md`]).toBe('joint body');
    expect(
      (
        JSON.parse(files['comments/info.json']) as Record<
          string,
          { page: object }
        >
      )[commentId].page,
    ).toEqual({
      type: 'problem',
      key: '',
    });
  });

  it("reads a user's comments through the author index, not a collection scan", async () => {
    const owner = await seedUser(worker);
    const rows = Array.from({ length: 50 }, () => {
      const commentId = newId();
      return {
        _id: commentId,
        page: { type: 'blog', id: newId() },
        author: owner._id,
        threadId: commentId,
        path: commentId,
        body: 'x',
        hidden: Math.random() < 0.5,
      };
    });
    await worker.comments.create(rows);
    const operations = await profileQueries(worker.db, () =>
      service.prepare(owner._id),
    );
    const reads = operations.filter(
      ({ collection, operation }) =>
        collection === worker.comments.collection.name &&
        ['query', 'getmore'].includes(operation),
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const { planSummary, hasSortStage } of reads) {
      expect(planSummary).toContain('author: 1');
      expect(hasSortStage).toBe(false);
    }
  });

  it('counts comments and posts against the entry cap', async () => {
    limits.maxEntries = 3;
    const owner = await seedUser(worker);
    for (let index = 0; index < 3; index += 1) {
      const commentId = newId();
      await worker.comments.create({
        _id: commentId,
        page: { type: 'blog', id: newId() },
        author: owner._id,
        threadId: commentId,
        path: commentId,
        body: 'x',
      });
    }
    await expect(service.prepare(owner._id)).rejects.toThrow(UserDataError);
  });
});
