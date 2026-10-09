import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  CONTEST_EXPORT_QUEUE,
  contestExportJobId,
  contestExportPath,
} from '@libs/contests';
import type { ContestExportJob } from '@libs/contests';
import type { ContestExportStatusResponse } from '../src/modules/contests/export/dto/contest-export.dto';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const issueCodes = ({ body }: { body: unknown }): string[] =>
  (body as { error: { issues: { code: string }[] } }).error.issues.map(
    (issue) => issue.code,
  );

describe('contest submissions export', () => {
  let api: ApiTest;
  let unconfigured: ApiTest;
  let queue: Queue<ContestExportJob>;
  let ended: { _id: string; key: string };
  let running: { _id: string; key: string };
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const request = (who: string, key: string) =>
    authed(api.http().post(contestUrl(key, '/export')), sessions[who]);
  const download = (who: string, key: string) =>
    authed(api.http().get(contestUrl(key, '/export/download')), sessions[who]);
  const statusOf = async (key: string) =>
    dataOf<ContestExportStatusResponse>(
      await authed(
        api.http().get(contestUrl(key, '/export')),
        sessions.editor,
      ).expect(200),
    );
  const zipFile = () => contestExportPath(api.contestDataRoot, ended._id);

  beforeAll(async () => {
    api = await setupApiTest();
    unconfigured = await setupApiTest({ env: { CONTEST_DATA_ROOT: '' } });
    queue = api.app.get(getQueueToken(CONTEST_EXPORT_QUEUE));
    for (const [name, permissions] of [
      ['plain', []],
      ['editor', ['judge.edit_own_contest']],
    ] as const) {
      users[name] = await createUserWith(api, name, {
        permissions: [...permissions],
      });
      sessions[name] = await loginAs(api, users[name]._id);
    }
    const authors = [users.editor._id];
    ended = await createContest(api, {
      authors,
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    running = await createContest(api, { authors });
  });
  afterAll(async () => {
    await api.teardown();
    await unconfigured.teardown();
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await api.contests.updateOne(
      { _id: ended._id },
      { exportPreparedAt: null },
    );
    rmSync(zipFile(), { force: true });
  });

  it('queues an export for editors of an ended contest, once a day while a zip exists', async () => {
    await request('editor', running.key).expect(409);
    await request('editor', ended.key).expect(202);
    expect((await queue.getJob(contestExportJobId(ended._id)))!.data).toEqual({
      contestId: ended._id,
    });
    expect(issueCodes(await request('editor', ended.key).expect(409))).toEqual([
      'export_in_progress',
    ]);
    expect((await statusOf(ended.key)).state).toBe('preparing');
    await queue.obliterate({ force: true });
    writeFileSync(zipFile(), 'zip bytes');
    const limited = await request('editor', ended.key).expect(429);
    expect(issueCodes(limited)).toEqual(['export_rate_limited']);
    rmSync(zipFile());
    await request('editor', ended.key).expect(202);
  });

  it('refuses everyone but editors, each refusal carrying an issue code', async () => {
    const asked = await request('plain', ended.key).expect(403);
    expect(issueCodes(asked)).toEqual(['forbidden']);
    writeFileSync(zipFile(), 'zip bytes');
    const fetched = await download('plain', ended.key).expect(403);
    expect(issueCodes(fetched)).toEqual(['forbidden']);
    expect(
      issueCodes(await request('editor', running.key).expect(409)),
    ).toEqual(['contest_not_ended']);
    const status = await authed(
      api.http().get(contestUrl(ended.key, '/export')),
      sessions.plain,
    ).expect(403);
    expect(issueCodes(status)).toEqual(['forbidden']);
  });

  it('reports none, then ready with its size and the next allowed request', async () => {
    expect(await statusOf(ended.key)).toEqual({
      state: 'none',
      preparedAt: null,
      readyAt: null,
      size: null,
      nextPrepareAt: null,
    });
    const preparedAt = new Date(Date.now() - 3_600_000);
    await api.contests.updateOne(
      { _id: ended._id },
      { exportPreparedAt: preparedAt },
    );
    writeFileSync(zipFile(), 'zip bytes');
    expect(await statusOf(ended.key)).toMatchObject({
      state: 'ready',
      preparedAt: preparedAt.toISOString(),
      size: 9,
      nextPrepareAt: new Date(preparedAt.getTime() + 86_400_000).toISOString(),
    });
  });

  it('serves the zip as an uncached attachment to editors only, 404 while none exists', async () => {
    const missing = await download('editor', ended.key).expect(404);
    expect(issueCodes(missing)).toEqual(['export_not_prepared']);
    writeFileSync(zipFile(), 'zip bytes');
    const response = await download('editor', ended.key).expect(200);
    expect(response.headers['content-type']).toMatch(/application\/zip/);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${ended.key}-export.zip"`,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(
      existsSync(contestExportPath(api.contestDataRoot, running._id)),
    ).toBe(false);
  });

  it('keeps the data zip and the export independent', async () => {
    await api.contests.updateOne(
      { _id: ended._id },
      { dataPreparedAt: new Date() },
    );
    await request('editor', ended.key).expect(202);
  });

  it('is off without a data root', async () => {
    const author = await createUserWith(unconfigured, 'x_editor', {
      permissions: ['judge.edit_own_contest'],
    });
    const editor = await loginAs(unconfigured, author._id);
    const contest = await createContest(unconfigured, {
      authors: [author._id],
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    const refused = await authed(
      unconfigured.http().post(contestUrl(contest.key, '/export')),
      editor,
    ).expect(404);
    expect(issueCodes(refused)).toEqual(['export_not_configured']);
  });
});
