import type { Test } from 'supertest';
import { newId } from '@libs/database';
import type { User } from '@libs/database';
import { clearRateLimits } from './contest-fixtures';
import {
  commentPageUrl,
  createComment,
  createPost,
  writer,
} from './community-fixtures';
import { createOrganization, organizationUrl } from './organization-fixtures';
import {
  authed,
  createProblem,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

interface Person {
  id: string;
  session: TestSession;
}
type Attempt = (session: TestSession) => Test;
interface Row {
  name: string;
  /** The code a locked attempt answers (old locks keep `forbidden`). */
  lockedCode: string;
  okStatus: number;
  /** Seeds what the attempt needs (before the mode is switched on) and returns the attempt. */
  prepare: (person: Person) => Attempt | Promise<Attempt>;
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const aMinuteAgo = () => new Date(Date.now() - 60_000).toISOString();

describe('official contest mode', () => {
  let api: ApiTest;
  let counter = 0;
  let catalog: Catalog;
  const setMode = async (on: boolean, endsAt = '') => {
    await api.setSetting('contest.officialMode', on);
    await api.setSetting('contest.officialModeEndsAt', endsAt);
  };
  const newPerson = async (extra: Partial<User> = {}): Promise<Person> => {
    counter += 1;
    const user = await writer(api, `locked${counter}`, extra);
    return { id: user._id, session: await loginAs(api, user._id) };
  };
  const patchProfile =
    (body: object): Attempt =>
    (session) =>
      authed(api.http().patch('/api/internal/profile'), session).send(body);

  const rows = (): Row[] => [
    {
      name: 'profile about',
      lockedCode: 'forbidden',
      okStatus: 200,
      prepare: () => patchProfile({ about: 'About me' }),
    },
    {
      name: 'profile first name',
      lockedCode: 'forbidden',
      okStatus: 200,
      prepare: () => patchProfile({ firstName: 'Grace' }),
    },
    {
      name: 'comment page',
      lockedCode: 'forbidden',
      okStatus: 200,
      prepare: async () => {
        const post = await createPost(api);
        return (session) =>
          authed(api.http().get(commentPageUrl('blog', post._id)), session);
      },
    },
    {
      name: 'blog post creation',
      lockedCode: 'forbidden',
      okStatus: 201,
      prepare: () => (session) =>
        authed(api.http().post('/api/internal/posts'), session).send({
          title: 'T',
          content: 'C',
        }),
    },
    {
      name: 'profile display badge',
      lockedCode: 'locked_in_official_contest',
      okStatus: 200,
      prepare: async (person) => {
        const badge = newId();
        await api.users.updateOne(
          { _id: person.id },
          { $set: { badges: [badge] } },
        );
        return patchProfile({ displayBadgeId: badge });
      },
    },
    {
      name: 'profile organization order',
      lockedCode: 'locked_in_official_contest',
      okStatus: 200,
      prepare: async (person) => {
        const first = await createOrganization(api, {}, [person.id]);
        const second = await createOrganization(api, {}, [person.id]);
        return patchProfile({ organizations: [second._id, first._id] });
      },
    },
    {
      name: 'organization join',
      lockedCode: 'locked_in_official_contest',
      okStatus: 204,
      prepare: async () => {
        const organization = await createOrganization(api, { isOpen: true });
        return (session) =>
          authed(
            api.http().post(organizationUrl(organization.slug, '/join')),
            session,
          );
      },
    },
    {
      name: 'organization leave',
      lockedCode: 'locked_in_official_contest',
      okStatus: 204,
      prepare: async (person) => {
        const organization = await createOrganization(api, { isOpen: true }, [
          person.id,
        ]);
        return (session) =>
          authed(
            api.http().post(organizationUrl(organization.slug, '/leave')),
            session,
          );
      },
    },
    {
      name: 'organization join request',
      lockedCode: 'locked_in_official_contest',
      okStatus: 201,
      prepare: async () => {
        const organization = await createOrganization(api, { isOpen: false });
        return (session) =>
          authed(
            api.http().post(organizationUrl(organization.slug, '/requests')),
            session,
          ).send({ reason: 'I would like to join' });
      },
    },
  ];

  /** One attempt in one mode state by one kind of person, each on a fresh person and fresh data. */
  const attempt = async (
    row: Row,
    mode: { on: boolean; endsAt?: string },
    expected: 'locked' | 'open',
    extra: Partial<User> = {},
  ) => {
    const person = await newPerson(extra);
    const run = await row.prepare(person);
    await clearRateLimits(api);
    await setMode(mode.on, mode.endsAt);
    const response = run(person.session);
    if (expected === 'locked')
      await response.expect(403).expect(errorCode(row.lockedCode));
    else await response.expect(row.okStatus);
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
  });
  afterEach(() => setMode(false));
  afterAll(() => api.teardown());

  it.each(rows())(
    'locks $name while the mode is on, until its end time, and not for superusers',
    async (row) => {
      await attempt(row, { on: true }, 'locked');
      await attempt(row, { on: true, endsAt: inAnHour() }, 'locked');
      await attempt(row, { on: true }, 'open', { isSuperuser: true });
      await attempt(row, { on: true, endsAt: aMinuteAgo() }, 'open');
      await attempt(row, { on: false }, 'open');
    },
  );

  it('empties the recent comments of the home slice while locked and brings them back after the end time', async () => {
    const author = await newPerson();
    const reader = await newPerson();
    const post = await createPost(api);
    await createComment(api, {
      page: { type: 'blog', id: post._id },
      author: author.id,
    });
    const count = async (session?: TestSession) => {
      const request = api.http().get('/api/internal/home');
      const { recentComments } = dataOf<{ recentComments: unknown[] }>(
        await (session ? authed(request, session) : request).expect(200),
      );
      return recentComments.length;
    };
    await setMode(false);
    expect(await count()).toBeGreaterThan(0);
    expect(await count(reader.session)).toBeGreaterThan(0);
    await setMode(true);
    expect(await count()).toBe(0);
    expect(await count(reader.session)).toBe(0);
    await setMode(true, inAnHour());
    expect(await count()).toBe(0);
    await setMode(true, aMinuteAgo());
    expect(await count()).toBeGreaterThan(0);
    expect(await count(reader.session)).toBeGreaterThan(0);
  });

  it('tells the shell on GET /site, with the end instant, and stops telling it after the end time', async () => {
    const site = async () =>
      dataOf<{ officialMode: boolean; officialModeEndsAt: string | null }>(
        await api.http().get('/api/internal/site').expect(200),
      );
    expect(await site()).toMatchObject({
      officialMode: false,
      officialModeEndsAt: null,
    });
    await setMode(true);
    expect(await site()).toMatchObject({
      officialMode: true,
      officialModeEndsAt: null,
    });
    const endsAt = inAnHour();
    await setMode(true, endsAt);
    expect(await site()).toMatchObject({
      officialMode: true,
      officialModeEndsAt: endsAt,
    });
    await setMode(true, aMinuteAgo());
    expect(await site()).toMatchObject({
      officialMode: false,
      officialModeEndsAt: null,
    });
    await setMode(false, inAnHour());
    expect(await site()).toMatchObject({
      officialMode: false,
      officialModeEndsAt: null,
    });
  });

  it('refuses an end time without an offset or a date', async () => {
    await expect(
      api.setSetting('contest.officialModeEndsAt', '2026-10-10T08:00:00'),
    ).rejects.toThrow();
    await expect(
      api.setSetting('contest.officialModeEndsAt', 'soon'),
    ).rejects.toThrow();
    await expect(
      api.setSetting('contest.officialModeEndsAt', '2026-10-10T08:00:00+07:00'),
    ).resolves.toBeUndefined();
  });

  it('does not lock a profile form that resends the stored badge and order', async () => {
    const person = await newPerson();
    const badge = newId();
    const first = await createOrganization(api, {}, [person.id]);
    const second = await createOrganization(api, {}, [person.id]);
    await api.users.updateOne(
      { _id: person.id },
      { $set: { badges: [badge], displayBadgeId: badge } },
    );
    await setMode(true);
    await patchProfile({
      displayBadgeId: badge,
      organizations: [first._id, second._id],
      timezone: 'UTC',
    })(person.session).expect(200);
  });

  it('keeps tickets open while the mode is on', async () => {
    const problem = await createProblem(api, catalog, {
      code: `lockticket${(counter += 1)}`,
    });
    const person = await newPerson();
    await setMode(true);
    await authed(
      api.http().post(`/api/internal/problems/${problem.code}/tickets`),
      person.session,
    )
      .send({ title: 'Wrong answer', body: 'Sample 2 looks wrong' })
      .expect(201);
  });

  it('lets an organization administrator keep removing members while the mode is on', async () => {
    const admin = await newPerson();
    const member = await newPerson();
    const organization = await createOrganization(
      api,
      { adminIds: [admin.id], isOpen: true },
      [member.id],
    );
    await setMode(true);
    await authed(
      api.http().post(organizationUrl(organization.slug, '/kick')),
      admin.session,
    )
      .send({ userId: member.id })
      .expect(204);
  });
});
