import {
  BlogPost,
  BlogVote,
  Comment,
  CommentLock,
  CommentVote,
  uuidStr,
} from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

const JOBS = [
  'comments',
  'comment-votes',
  'comment-locks',
  'blog-posts',
  'blog-votes',
];

describe('community jobs', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;
  const docOf = async <T>(
    collection: string,
    table: string,
    legacyId: number,
  ) =>
    (await harness.docOf(collection, table, legacyId)) as unknown as T | null;
  const comment = (legacyId: number) =>
    docOf<Comment>('comments', 'judge_comment', legacyId);
  const id = async (table: string, legacyId: number) =>
    uuidStr(await harness.uuidOf(table, legacyId));

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    reports = await migration.backfill(JOBS);
  });
  afterAll(() => harness.teardown());

  it('turns the MPTT tree into a materialized path and thread', async () => {
    const [root, middle, leaf] = await Promise.all([
      id('judge_comment', 8001),
      id('judge_comment', 8002),
      id('judge_comment', 8003),
    ]);
    const deep = (await comment(8003))!;
    expect(deep.path).toBe(`${root}/${middle}/${leaf}`);
    expect(uuidStr(deep.threadId)).toBe(root);
    expect(uuidStr(deep.parentId)).toBe(middle);
    expect((await comment(8001))!.parentId).toBeNull();
  });

  it('resolves pages to entity ids, renders bodies and marks direct hides', async () => {
    const first = (await comment(8001))!;
    expect(first.page.type).toBe('problem');
    expect(uuidStr(first.page.id)).toBe(await id('judge_problem', 8001));
    expect(first).toMatchObject({
      score: 2,
      revisions: 1,
      hidden: false,
      hiddenBy: null,
    });
    expect(first.bodyHtml).toContain('<strong>all</strong>');
    const hidden = (await comment(8002))!;
    expect(uuidStr(hidden.hiddenBy)).toBe(uuidStr(hidden._id));
    // 8003 is visible in legacy but sits under hidden 8002: v2 hides it by its nearest hidden ancestor.
    const reply = (await comment(8003))!;
    expect(reply.hidden).toBe(true);
    expect(uuidStr(reply.hiddenBy)).toBe(uuidStr(hidden._id));
    expect(reports.comments).toContain(
      'judge_comment:8003 hidden under hidden judge_comment:8002',
    );
    expect((await comment(8007))!.page.type).toBe('editorial');
    expect(uuidStr((await comment(8006))!.page.id)).toBe(
      await id('judge_blogpost', 8001),
    );
  });

  it('skips comments on gone pages and every reply under them', async () => {
    expect(await comment(8004)).toBeNull();
    expect(await comment(8005)).toBeNull();
    expect(reports.comments).toEqual(
      expect.arrayContaining([
        'skipped judge_comment:8004 (page gone)',
        'skipped judge_comment:8005 (ancestor skipped)',
      ]),
    );
  });

  it('keeps only valid votes of imported comments, and resolvable locks', async () => {
    expect(
      await docOf<CommentVote>('commentVotes', 'judge_commentvote', 8001),
    ).toMatchObject({ score: 1 });
    expect(
      await docOf<CommentVote>('commentVotes', 'judge_commentvote', 8002),
    ).toBeNull();
    expect(
      await docOf<CommentVote>('commentVotes', 'judge_commentvote', 8003),
    ).toBeNull();
    expect(
      (await docOf<CommentLock>('commentLocks', 'judge_commentlock', 8001))!
        .page.type,
    ).toBe('problem');
    expect(
      await docOf<CommentLock>('commentLocks', 'judge_commentlock', 8002),
    ).toBeNull();
    expect(
      await docOf<CommentLock>('commentLocks', 'judge_commentlock', 8003),
    ).toBeNull();
    expect(reports['comment-locks']).toContain(
      'skipped judge_commentlock:8003 (duplicate page)',
    );
  });

  it('maps posts with blog-style HTML and keeps only ±1 votes', async () => {
    const post = (await docOf<BlogPost>('blogPosts', 'judge_blogpost', 8001))!;
    expect(post).toMatchObject({
      title: 'News',
      slug: 'news',
      visible: true,
      sticky: false,
      globalPost: true,
      organization: null,
      score: 3,
      publishOn: new Date('2023-03-01T00:00:00Z'),
    });
    expect(post.contentHtml).toContain('<strong>big</strong>');
    expect(post.summaryHtml).toContain('sum');
    expect(post.authors.map(uuidStr)).toEqual([await id('auth_user', 1)]);
    expect(
      await docOf<BlogVote>('blogVotes', 'judge_blogvote', 8001),
    ).toMatchObject({ score: -1 });
    expect(
      await docOf<BlogVote>('blogVotes', 'judge_blogvote', 8002),
    ).toBeNull();
  });

  it('verifies clean', async () => {
    expect(await migration.verify(JOBS)).toBe(0);
  });
});
