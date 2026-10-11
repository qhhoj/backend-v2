import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  CONTEST_DATA_QUEUE,
  contestDataJobId,
  contestDataPath,
} from '@libs/contests';
import type { ContestDataJob } from '@libs/contests';
import type { ContestDataStatusResponse } from '../src/modules/contests/data/dto/contest-data.dto';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest data download', () => {
  let api: ApiTest;
  let dataQueue: Queue<ContestDataJob>;
  let ended: { _id: string; key: string };
  let running: { _id: string; key: string };
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const prepare = (who: string, key: string, body: object = {}) =>
    authed(api.http().post(contestUrl(key, '/data')).send(body), sessions[who]);
  const statusOf = async (key: string) =>
    dataOf<ContestDataStatusResponse>(
      await authed(
        api.http().get(contestUrl(key, '/data')),
        sessions.editor,
      ).expect(200),
    );
  const download = (who: string, key: string) =>
    authed(api.http().get(contestUrl(key, '/data/download')), sessions[who])
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          done(
            null,
            response.headers['content-type']?.includes('json')
              ? JSON.parse(body.toString())
              : body,
          );
        });
      });
  const zipFile = () => contestDataPath(api.contestDataRoot, ended._id);

  beforeAll(async () => {
    api = await setupApiTest();
    dataQueue = api.app.get(getQueueToken(CONTEST_DATA_QUEUE));
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
  });
  beforeEach(async () => {
    await dataQueue.obliterate({ force: true });
    await api.contests.updateOne({ _id: ended._id }, { dataPreparedAt: null });
    rmSync(zipFile(), { force: true });
  });

  it('prepares for editors of an ended contest, once a day while a zip exists', async () => {
    await prepare('plain', ended.key).expect(403);
    await prepare('editor', running.key)
      .expect(409)
      .expect(errorCode('conflict'));
    await prepare('editor', ended.key, { problemGlob: '../x' }).expect(400);
    await prepare('editor', ended.key, { results: ['NOPE'] }).expect(400);
    await prepare('editor', ended.key, {
      problemGlob: 's*',
      results: ['AC'],
    }).expect(202);
    expect((await dataQueue.getJob(contestDataJobId(ended._id)))!.data).toEqual(
      { contestId: ended._id, problemGlob: 's*', results: ['AC'] },
    );
    await prepare('editor', ended.key).expect(409); // still preparing
    expect((await statusOf(ended.key)).state).toBe('preparing');
    await dataQueue.obliterate({ force: true });
    writeFileSync(zipFile(), 'zip bytes');
    await prepare('editor', ended.key)
      .expect(429)
      .expect(errorCode('rate_limited'));
    rmSync(zipFile());
    await prepare('editor', ended.key).expect(202); // the zip is gone: allowed again
  });

  it('downloads the zip as an attachment, and 404 without one', async () => {
    writeFileSync(zipFile(), 'zip bytes');
    const response = await download('editor', ended.key).expect(200);
    expect(response.headers).toMatchObject({
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${ended.key}-data.zip"`,
      'x-content-type-options': 'nosniff',
    });
    expect((response.body as Buffer).toString()).toBe('zip bytes');
    rmSync(zipFile());
    await download('editor', ended.key)
      .expect(404)
      .expect(errorCode('not_found'));
  });

  it('serves status and download to editors only, once the contest has ended', async () => {
    writeFileSync(zipFile(), 'zip bytes');
    await download('plain', ended.key).expect(403);
    await authed(
      api.http().get(contestUrl(ended.key, '/data')),
      sessions.plain,
    ).expect(403);
    await api.http().get(contestUrl(ended.key, '/data/download')).expect(401);
    await download('editor', running.key).expect(409);
    await authed(
      api.http().get(contestUrl(running.key, '/data')),
      sessions.editor,
    ).expect(409);
    expect(existsSync(zipFile())).toBe(true);
  });
});
