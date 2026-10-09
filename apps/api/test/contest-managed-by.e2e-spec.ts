import { newId } from '@libs/database';
import { contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('client-managed contests and clones', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('does not carry the managing client over to a human clone', async () => {
    const cloner = await createUserWith(api, 'managedcloner', {
      permissions: ['judge.clone_contest', 'judge.edit_own_contest'],
    });
    const source = await createContest(api, {
      authors: [cloner._id],
      managedBy: newId(),
    });
    await authed(
      api.http().post(contestUrl(source.key, '/clone')),
      await loginAs(api, cloner._id),
    )
      .send({ key: `${source.key}_copy` })
      .expect(201);
    const copy = await api.contests
      .findOne({ key: `${source.key}_copy` })
      .lean();
    expect(copy?.managedBy).toBeNull();
    expect(
      (await api.contests.findById(source._id).lean())?.managedBy,
    ).not.toBeNull();
  });
});
