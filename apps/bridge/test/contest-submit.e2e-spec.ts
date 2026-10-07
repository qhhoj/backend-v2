import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { sha256 } from '@libs/auth';
import {
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from '../../api/test/contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from '../../api/test/problem-fixtures';
import type { Catalog, TestSession } from '../../api/test/problem-fixtures';
import { dataOf } from '../../api/test/submission-fixtures';
import { setupApiTest } from '../../api/test/setup';
import type { ApiTest } from '../../api/test/setup';
import { BridgeModule } from '../src/bridge.module';
import { BRIDGE_TIMINGS } from '../src/bridge-timings';
import { JudgeServerService } from '../src/judges/judge-server.service';
import { FakeJudge } from './fake-judge';
import { FAST_TIMINGS } from './setup';

const KEY = 'contest key';

/** The real api and bridge: a contest submission leaves the api at priority 0 and reaches only the judges its contest allows. */
describe('contest submissions across the api and the bridge', () => {
  let api: ApiTest;
  let bridge: TestingModule;
  let catalog: Catalog;
  let session: TestSession;
  let allowed: FakeJudge;
  let banned: FakeJudge;

  beforeAll(async () => {
    api = await setupApiTest();
    Object.assign(process.env, {
      JUDGE_BRIDGE_HOST: '127.0.0.1',
      JUDGE_BRIDGE_PORT: '0',
    });
    catalog = await seedCatalog(api);
    const user = await createUserWith(api, 'contestant');
    session = await loginAs(api, user._id);
    const problem = await createProblem(api, catalog, {
      code: 'xcontest',
      isPublic: false,
    });
    const contest = await createContest(api, {
      bannedJudges: ['judge-banned'],
      problems: [contestProblem(problem._id, 0)],
    });
    await makeCurrent(
      api,
      user._id,
      (await joinParticipation(api, contest._id, user._id))._id,
    );
    for (const name of ['judge-allowed', 'judge-banned'])
      await api.judges.create({ name, authKeyHash: sha256(KEY) });
    bridge = await Test.createTestingModule({ imports: [BridgeModule] })
      .overrideProvider(BRIDGE_TIMINGS)
      .useValue(FAST_TIMINGS)
      .compile();
    await bridge.init();
    const port = bridge.get(JudgeServerService).port();
    const online = (name: string) =>
      FakeJudge.online(port, { name, key: KEY, problems: ['xcontest'] });
    banned = await online('judge-banned');
    allowed = await online('judge-allowed');
  });
  afterAll(async () => {
    await banned?.close();
    await allowed?.close();
    await bridge?.close();
    await api.teardown();
  });

  it('dispatches at priority 0 to a judge the contest does not ban', async () => {
    const id = dataOf<{ id: string }>(
      await authed(
        api.http().post('/api/internal/problems/xcontest/submit'),
        session,
      )
        .send({ language: catalog.languages.cpp, source: 'int main() {}' })
        .expect(201),
    ).id;
    const request = await allowed.next('submission-request');
    expect(request['submission-id']).toBe(id);
    expect(request.meta).toMatchObject({
      'pretests-only': false,
      'in-contest': 0,
    });
    expect(await api.submissions.findById(id).lean()).toMatchObject({
      priority: 0,
      status: 'P',
      judgedOn: 'judge-allowed',
    });
    expect(
      banned.received.filter((packet) => packet.name === 'submission-request'),
    ).toEqual([]);
  });
});
