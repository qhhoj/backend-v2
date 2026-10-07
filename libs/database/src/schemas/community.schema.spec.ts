import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { subtreeFilter } from '@libs/community';
import { profileQueries, startMongo } from '../testing';
import { newId } from '../uuid';
import { BlogPostSchema } from './blog-post.schema';
import { BlogVoteSchema } from './blog-vote.schema';
import { CommentLockSchema } from './comment-lock.schema';
import { CommentVoteSchema } from './comment-vote.schema';
import { CommentSchema } from './comment.schema';
import { OrganizationSchema } from './organization.schema';
import { OrganizationRequestSchema } from './organization-request.schema';

describe('Community schemas', () => {
  let replSet: MongoMemoryReplSet;
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

  it('creates unlisted, closed organizations without a slot limit by default', async () => {
    const organization = await Organizations.create({
      name: 'Defaults',
      slug: 'defaults',
      shortName: 'defaults',
    });
    expect(organization.toObject()).toMatchObject({
      isUnlisted: true,
      isOpen: false,
      slots: null,
      memberCount: 0,
      performancePoints: 0,
      adminIds: [],
    });
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

  it('bounds the reason', async () => {
    await expect(
      Requests.create({
        organization: newId(),
        user: newId(),
        reason: 'x'.repeat(4097),
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      Requests.create({ organization: newId(), user: newId(), reason: '' }),
    ).rejects.toThrow(/reason/);
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

  it('keeps one lock per page', async () => {
    const page = { type: 'problem', id: newId() };
    await Locks.create({ page });
    await expect(Locks.create({ page })).rejects.toThrow(/duplicate key/);
    await expect(
      Locks.create({ page: { ...page, type: 'contest' } }),
    ).resolves.toBeDefined();
  });

  it('bounds comment bodies and page types', async () => {
    const fields = {
      page: { type: 'blog', id: newId() },
      author: newId(),
      threadId: newId(),
      path: 'x',
    };
    await expect(
      Comments.create({ ...fields, body: 'x'.repeat(8192) }),
    ).resolves.toBeDefined();
    await expect(
      Comments.create({ ...fields, body: 'x'.repeat(8193) }),
    ).rejects.toThrow(/body/);
    await expect(Comments.create({ ...fields, body: '' })).rejects.toThrow(
      /body/,
    );
    await expect(
      Comments.create({
        ...fields,
        page: { type: 'ticket', id: newId() },
        body: 'x',
      }),
    ).rejects.toThrow(/type/);
  });

  it('creates unpublished personal posts by default and bounds the title', async () => {
    const post = await Posts.create({
      title: 'Hello',
      slug: 'alice',
      publishOn: new Date(),
      content: 'Hi',
    });
    expect(post.toObject()).toMatchObject({
      visible: false,
      sticky: false,
      globalPost: false,
      organization: null,
      score: 0,
    });
    await expect(
      Posts.create({
        title: 'x'.repeat(101),
        slug: 'a',
        publishOn: new Date(),
        content: 'Hi',
      }),
    ).rejects.toThrow(/title/);
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
    expect(read.planSummary).not.toContain('SORT');
    expect(read.docsExamined).toBeLessThanOrEqual(11);
  });
});
