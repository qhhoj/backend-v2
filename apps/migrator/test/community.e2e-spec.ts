import { Comment, CommentLock, CommentVote, uuidStr } from '@libs/database';
import { IntegrityCheckService } from '../src/integrity-check.service';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

const JOBS = ['comments', 'comment-votes', 'comment-locks'];

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

  it('does not migrate the legacy blog: its comments, votes and locks are skipped and reported', async () => {
    for (const collection of ['blogPosts', 'blogVotes'])
      expect(await harness.db.collection(collection).countDocuments()).toBe(0);
    expect(await comment(8006)).toBeNull();
    expect(await comment(8008)).toBeNull();
    expect(reports.comments).toEqual(
      expect.arrayContaining([
        'skipped judge_comment:8006 (legacy blog not migrated)',
        'skipped judge_comment:8008 (ancestor skipped)',
      ]),
    );
    for (const legacyId of [8004, 8005])
      expect(
        await docOf<CommentVote>('commentVotes', 'judge_commentvote', legacyId),
      ).toBeNull();
    expect(
      await docOf<CommentLock>('commentLocks', 'judge_commentlock', 8004),
    ).toBeNull();
    expect(reports['comment-locks']).toContain(
      'skipped judge_commentlock:8004 (legacy blog not migrated)',
    );
  });

  it('rejects the retired blog job names', async () => {
    await expect(migration.backfill(['blog-posts'])).rejects.toThrow(
      'unknown job: blog-posts',
    );
  });

  it('verifies clean and leaves no dangling comment or blog reference', async () => {
    expect(await migration.verify(JOBS)).toBe(0);
    const lines = await harness.testingModule.get(IntegrityCheckService).run();
    expect(lines.filter((line) => /comment|blog/i.test(line))).toEqual([]);
  });
});
