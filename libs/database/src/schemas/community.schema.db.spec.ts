import mongoose from 'mongoose';
import { subtreeFilter } from '@libs/community';
import { profileQueries, startMongo } from '../testing';
import type { TestMongo } from '../testing';
import { newId } from '../uuid';
import { BlogPostSchema } from './blog-post.schema';
import { BlogVoteSchema } from './blog-vote.schema';
import { CommentLockSchema } from './comment-lock.schema';
import { CommentVoteSchema } from './comment-vote.schema';
import { CommentSchema } from './comment.schema';
import { OrganizationSchema } from './organization.schema';
import { OrganizationRequestSchema } from './organization-request.schema';

describe('Community schemas', () => {
  let replSet: TestMongo;
  const Organizations = mongoose.model(
    'OrganizationSchemaSpec',
    OrganizationSchema,
  );
  const Requests = mongoose.model(
    'OrganizationRequestSchemaSpec',
    OrganizationRequestSchema,
  );

  const Posts = mongoose.model('BlogPostSchemaSpec', BlogPostSchema);
  const PostVotes = mongoose.model('BlogVoteSchemaSpec', BlogVoteSchema);
  const Comments = mongoose.model('CommentSchemaSpec', CommentSchema);
  const CommentVotes = mongoose.model(
    'CommentVoteSchemaSpec',
    CommentVoteSchema,
  );
  const Locks = mongoose.model('CommentLockSchemaSpec', CommentLockSchema);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [
        Organizations,
        Requests,
        Posts,
        PostVotes,
        Comments,
        CommentVotes,
        Locks,
      ].map((model) => model.syncIndexes()),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps slugs unique case-insensitively and starting with a letter', async () => {
    await Organizations.create({ name: 'QH', slug: 'qhh', shortName: 'qhh' });
    await expect(
      Organizations.create({ name: 'Other', slug: 'QHH', shortName: 'QHH' }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Organizations.create({ name: 'Digit', slug: '1abc', shortName: '1abc' }),
    ).rejects.toThrow(/slug/);
    await expect(
      Organizations.create({ name: 'Space', slug: 'a b', shortName: 'a b' }),
    ).rejects.toThrow(/slug/);
  });

  it('keeps one pending request per user and organization, decided ones aside', async () => {
    const fields = { organization: newId(), user: newId(), reason: 'please' };
    const first = await Requests.create(fields);
    expect(first.state).toBe('P');
    await expect(Requests.create(fields)).rejects.toThrow(/duplicate key/);
    await Requests.updateOne({ _id: first._id }, { $set: { state: 'R' } });
    await expect(Requests.create(fields)).resolves.toBeDefined();
    await expect(
      Requests.create({ ...fields, organization: newId(), state: 'X' }),
    ).rejects.toThrow(/state/);
  });

  it('keeps one vote per voter and target, worth +1 or -1', async () => {
    const [blog, comment, voter] = [newId(), newId(), newId()];
    await PostVotes.create({ blog, voter, score: 1 });
    await expect(PostVotes.create({ blog, voter, score: -1 })).rejects.toThrow(
      /duplicate key/,
    );
    await CommentVotes.create({ comment, voter, score: -1 });
    await expect(
      CommentVotes.create({ comment, voter, score: 1 }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      CommentVotes.create({ comment: newId(), voter, score: 2 }),
    ).rejects.toThrow(/score/);
    await expect(
      PostVotes.create({ blog: newId(), voter, score: 0 }),
    ).rejects.toThrow(/score/);
  });

  it('reads a subtree by an index-bounded prefix, not the whole path index', async () => {
    const [root, sibling] = [newId(), newId()];
    const fields = { page: { type: 'blog', id: newId() }, author: newId() };
    const docs = [root, ...Array.from({ length: 30 }, () => sibling)].map(
      (head, index) => ({
        ...fields,
        threadId: head,
        path: `${head}/${index}`,
        body: 'x',
      }),
    );
    await Comments.insertMany([
      { ...fields, threadId: root, path: root, body: 'x' },
      { ...fields, threadId: root, path: `${root}/child`, body: 'x' },
      { ...fields, threadId: root, path: `${root}x`, body: 'x' },
      ...docs,
    ]);
    const operations = await profileQueries(mongoose.connection.db!, () =>
      Comments.find(subtreeFilter(root)).hint({ path: 1 }).exec(),
    );
    const read = operations.find((entry) => entry.operation === 'query')!;
    expect(read.keysExamined).toBeLessThanOrEqual(4);
    const paths = (await Comments.find(subtreeFilter(root))).map(
      (comment) => comment.path,
    );
    expect(paths.sort()).toEqual([root, `${root}/0`, `${root}/child`]);
  });

  it('serves a post list sorted by publish date and id from one index', async () => {
    await Posts.insertMany(
      Array.from({ length: 25 }, (unused, index) => ({
        title: 'T',
        slug: 's',
        publishOn: new Date(1_700_000_000_000 + index),
        content: 'c',
        visible: true,
      })),
    );
    const operations = await profileQueries(mongoose.connection.db!, () =>
      Posts.find({ organization: null, visible: true })
        .sort({ publishOn: -1, _id: -1 })
        .limit(10)
        .exec(),
    );
    const read = operations.find((entry) => entry.operation === 'query')!;
    expect(read.planSummary).toMatch(/^IXSCAN/);
    expect(read.hasSortStage).toBe(false);
    expect(read.docsExamined).toBeLessThanOrEqual(11);
  });
});
