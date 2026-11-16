import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlogPost, Comment, newId, toUuid } from '@libs/database';
import { renderMarkdown } from '@libs/render';
import { setupContentJobsTest } from '../../../test/content-jobs-setup';
import type { ContentJobsTest } from '../../../test/content-jobs-setup';
import { parseJobOptions } from '../job-options';
import { runContentJob } from '../run-content-job';
import { RerenderContentJob } from './rerender-content.job';

describe('rerender-content job', () => {
  let test: ContentJobsTest;
  let job: RerenderContentJob;
  const run = (args: string[]) =>
    runContentJob(job, parseJobOptions(args), test.storage);

  beforeAll(async () => {
    test = await setupContentJobsTest(jest.fn());
    job = test.module.get(RerenderContentJob);
  });
  afterAll(() => test.teardown());

  const insertComment = (extra: Record<string, unknown>) => {
    const id = newId();
    return test
      .raw(Comment.name)
      .insertOne({
        _id: toUuid(id),
        body: 'x',
        bodyHtml: '<p>stale</p>',
        deletedAt: null,
        ...extra,
      })
      .then(() => id);
  };
  const stored = (name: string, id: string) =>
    test.raw(name).findOne({ _id: toUuid(id) });

  it('dry run changes nothing; apply rewrites stale HTML, backs it up, and a second run changes 0', async () => {
    const stale = await insertComment({ body: '# Title\n\ntext' });
    const fresh = await insertComment({
      body: 'plain',
      bodyHtml: renderMarkdown('plain', 'user'),
    });
    const deleted = await insertComment({
      body: '[deleted]',
      bodyHtml: '',
      deletedAt: new Date(),
    });
    const postId = newId();
    await test.raw(BlogPost.name).insertOne({
      _id: toUuid(postId),
      content: '## Post',
      contentHtml: '<h2>old</h2>',
      summary: '',
      summaryHtml: '',
    });

    const dry = await run([]);
    expect(dry.planned).toBe(2);
    expect(dry.written).toBe(0);
    expect(dry.sample.length).toBeLessThanOrEqual(10);
    expect((await stored(Comment.name, stale))?.bodyHtml).toBe('<p>stale</p>');

    const backup = join(tmpdir(), `qhhoj-backup-${newId()}.jsonl`);
    const applied = await run(['--apply', '--backup', backup]);
    expect(applied.written).toBe(2);
    expect((await stored(Comment.name, stale))?.bodyHtml).toBe(
      renderMarkdown('# Title\n\ntext', 'user'),
    );
    expect((await stored(BlogPost.name, postId))?.contentHtml).toBe(
      renderMarkdown('## Post', 'blog'),
    );
    expect((await stored(Comment.name, fresh))?.bodyHtml).toBe(
      renderMarkdown('plain', 'user'),
    );
    expect((await stored(Comment.name, deleted))?.bodyHtml).toBe('');
    const lines = readFileSync(backup, 'utf8').trim().split('\n');
    expect(
      lines.map((line) => (JSON.parse(line) as { before: unknown }).before),
    ).toContainEqual({
      bodyHtml: '<p>stale</p>',
    });

    expect((await run(['--apply', '--backup', `${backup}.2`])).planned).toBe(0);
  });

  it('refuses --apply without --backup and never overwrites a backup', async () => {
    expect(() => parseJobOptions(['--apply'])).toThrow('--backup');
    const backup = join(tmpdir(), `qhhoj-backup-${newId()}.jsonl`);
    await run(['--apply', '--backup', backup]);
    expect(existsSync(backup)).toBe(true);
    await expect(run(['--apply', '--backup', backup])).rejects.toThrow(
      /EEXIST/,
    );
  });
});
