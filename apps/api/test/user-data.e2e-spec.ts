import { utimesSync, writeFileSync } from 'node:fs';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { USER_DATA_QUEUE, userDataJobId, userDataPath } from '@libs/community';
import type { UserDataJob } from '@libs/community';
import type { User } from '@libs/database';
import type { UserDataStatusResponse } from '../src/modules/users/data/dto/user-data.response';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('user data routes', () => {
  let api: ApiTest;
  let queue: Queue<UserDataJob>;
  let userCount = 0;
  const person = async (
    extra: Partial<User> = {},
    username = `exporter${(userCount += 1)}`,
  ) => {
    const user = await createUserWith(api, username, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const status = async (session: TestSession) =>
    dataOf<UserDataStatusResponse>(
      await authed(
        api.http().get('/api/internal/profile/data'),
        session,
      ).expect(200),
    );
  const prepare = (session: TestSession) =>
    authed(api.http().post('/api/internal/profile/data'), session);
  const download = (session: TestSession) =>
    authed(api.http().get('/api/internal/profile/data/download'), session);

  beforeAll(async () => {
    api = await setupApiTest();
    queue = api.app.get(getQueueToken(USER_DATA_QUEUE));
  });
  afterAll(() => api.teardown());

  it('prepares once a day while a fresh zip is ready, at once when it is missing or expired', async () => {
    const { user, session } = await person({ dataLastDownloaded: new Date() });
    await prepare(session).expect(202);
    await queue.remove(userDataJobId(user._id));
    writeFileSync(userDataPath(api.userDataRoot, user._id), 'zip');
    await api.users.updateOne(
      { _id: user._id },
      { $set: { dataLastDownloaded: new Date() } },
    );
    expect(await status(session)).toMatchObject({ state: 'ready', size: 3 });
    await prepare(session).expect(429);
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    utimesSync(
      userDataPath(api.userDataRoot, user._id),
      eightDaysAgo,
      eightDaysAgo,
    );
    expect((await status(session)).state).toBe('none');
    await download(session).expect(404);
    await prepare(session).expect(202);
  });

  it('caps prepares at three a day even when no zip is ever produced', async () => {
    const { user, session } = await person();
    await prepare(session).expect(202);
    await queue.remove(userDataJobId(user._id));
    await prepare(session).expect(202);
    await queue.remove(userDataJobId(user._id));
    await prepare(session).expect(202);
    await queue.remove(userDataJobId(user._id));
    expect((await status(session)).canPrepare).toBe(false);
    await prepare(session).expect(429);
    expect(await queue.getJob(userDataJobId(user._id))).toBeUndefined();
    expect((await status(session)).canPrepare).toBe(false);
  });
});

describe('user data routes without a root', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest({ env: { USER_DATA_ROOT: '' } });
  });
  afterAll(() => api.teardown());

  it('answers 404', async () => {
    const session = await loginAs(
      api,
      (await createUserWith(api, 'rootless'))._id,
    );
    await authed(api.http().post('/api/internal/profile/data'), session).expect(
      404,
    );
  });
});
