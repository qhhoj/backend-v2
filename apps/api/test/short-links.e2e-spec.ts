import { Logger } from '@nestjs/common';
import { newId, SHORT_CODE_ALPHABET, toUuid } from '@libs/database';
import {
  randomShortCode,
  SHORT_CODE_SOURCE,
} from '../src/modules/short-links/short-code';
import { clearRateLimits } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

interface Link {
  code: string;
  path: string;
  isAuto: boolean;
  hits: number;
  lastHitAt: string | null;
  expiresAt: string | null;
}

describe('short links', () => {
  let api: ApiTest;
  let staff: TestSession;
  let student: TestSession;
  let other: TestSession;
  let counter = 0;
  const forcedCodes: string[] = [];
  const fresh = () => `/problems/sl${(counter += 1)}`;
  const create = (session: TestSession, body: object) =>
    authed(api.http().post('/api/internal/short-links'), session).send(body);
  const visit = (code: string) => api.http().get(`/s/${code}`).redirects(0);

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [
        {
          provide: SHORT_CODE_SOURCE,
          useValue: { next: () => forcedCodes.shift() ?? randomShortCode() },
        },
      ],
    });
    staff = await loginAs(
      api,
      (
        await createUserWith(api, 'slstaff', {
          permissions: ['judge.manage_short_link'],
        })
      )._id,
    );
    student = await loginAs(api, (await createUserWith(api, 'slstudent'))._id);
    other = await loginAs(api, (await createUserWith(api, 'slother'))._id);
  });
  beforeEach(async () => {
    forcedCodes.length = 0;
    await clearRateLimits(api);
  });
  afterAll(() => api.teardown());

  describe('creating', () => {
    it('gives any signed-in user a six-character link, and the same link to everyone for the same path', async () => {
      const path = fresh();
      const first = dataOf<Link>(await create(student, { path }).expect(201));
      expect(first.code).toHaveLength(6);
      expect(
        [...first.code].every((letter) => SHORT_CODE_ALPHABET.includes(letter)),
      ).toBe(true);
      expect(first).toMatchObject({
        path,
        isAuto: true,
        hits: 0,
        expiresAt: null,
      });
      expect(
        dataOf<Link>(await create(student, { path }).expect(201)).code,
      ).toBe(first.code);
      expect(dataOf<Link>(await create(other, { path }).expect(201)).code).toBe(
        first.code,
      );
      expect(
        await api.db.collection('shortLinks').countDocuments({ path }),
      ).toBe(1);
    });

    it('makes one link when ten requests ask for the same path at once', async () => {
      const path = fresh();
      const codes = await Promise.all(
        Array.from(
          { length: 10 },
          async () =>
            dataOf<Link>(await create(student, { path }).expect(201)).code,
        ),
      );
      expect(new Set(codes).size).toBe(1);
      expect(
        await api.db.collection('shortLinks').countDocuments({ path }),
      ).toBe(1);
    });

    it.each([
      '//evil.example',
      '/\\evil.example',
      '/%2F%2Fevil.example',
      'https://evil.example/problems/sum',
      'javascript:alert(1)',
      '/problems/ok?next=//evil.example',
      '/problems/ok#x',
      '/problems/ok%0d%0aSet-Cookie:x=1',
      '/problems/../admin',
      '/problems/ok\n',
      '/admin',
      '',
    ])('refuses the target %j and stores nothing', async (path) => {
      const before = await api.db.collection('shortLinks').countDocuments({});
      await create(student, { path })
        .expect(400)
        .expect(errorCode('validation_failed'));
      expect(await api.db.collection('shortLinks').countDocuments({})).toBe(
        before,
      );
    });

    it('retries a code collision and gives up politely after five', async () => {
      const taken = dataOf<Link>(
        await create(student, { path: fresh() }).expect(201),
      );
      forcedCodes.push(taken.code, taken.code, 'bbbbbb');
      const made = dataOf<Link>(
        await create(student, { path: fresh() }).expect(201),
      );
      expect(made.code).toBe('bbbbbb');
      forcedCodes.push(...Array.from({ length: 5 }, () => taken.code));
      await create(student, { path: fresh() })
        .expect(409)
        .expect(errorCode('conflict'));
      expect(forcedCodes).toEqual([]);
    });

    it('lets only staff choose a code or an expiry', async () => {
      const path = fresh();
      await create(student, { path, code: 'mychoice' })
        .expect(403)
        .expect(errorCode('forbidden'));
      await create(student, { path, expiresAt: '2099-01-01T00:00:00Z' }).expect(
        403,
      );
      const chosen = dataOf<Link>(
        await create(staff, { path, code: 'mychoice' }).expect(201),
      );
      expect(chosen).toMatchObject({ code: 'mychoice', isAuto: false });
      const auto = dataOf<Link>(await create(student, { path }).expect(201));
      expect(auto.code).not.toBe('mychoice');
      const expiring = dataOf<Link>(
        await create(staff, { path, expiresAt: '2099-01-01T00:00:00Z' }).expect(
          201,
        ),
      );
      expect(expiring.expiresAt).toBe('2099-01-01T00:00:00.000Z');
      expect(expiring.isAuto).toBe(false);
    });

    it('refuses a taken, reserved or malformed chosen code', async () => {
      const path = fresh();
      await create(staff, { path, code: 'taken-one' }).expect(201);
      await create(staff, { path: fresh(), code: 'taken-one' })
        .expect(409)
        .expect(errorCode('conflict'));
      await create(staff, { path: fresh(), code: 'admin' }).expect(400);
      await create(staff, { path: fresh(), code: 'UPPER' }).expect(400);
      await create(staff, { path: fresh(), code: 'ab' }).expect(400);
    });

    it('gives the allowance back when a chosen code is taken', async () => {
      await create(staff, { path: fresh(), code: 'refund-me' }).expect(201);
      const spender = await loginAs(
        api,
        (
          await createUserWith(api, 'slrefund', {
            permissions: ['judge.manage_short_link'],
          })
        )._id,
      );
      for (let index = 0; index < 25; index += 1)
        await create(spender, { path: fresh(), code: 'refund-me' }).expect(409);
      for (let index = 0; index < 20; index += 1)
        await create(spender, { path: fresh() }).expect(201);
    });

    it('allows 20 new links a day, and an existing link does not use the allowance up', async () => {
      const reused = fresh();
      await create(student, { path: reused }).expect(201);
      for (let index = 0; index < 25; index += 1)
        await create(student, { path: reused }).expect(201);
      const tired = await createUserWith(api, 'sltired');
      const session = await loginAs(api, tired._id);
      for (let index = 0; index < 20; index += 1)
        await create(session, { path: fresh() }).expect(201);
      await create(session, { path: fresh() })
        .expect(429)
        .expect(errorCode('rate_limited'));
    });
  });

  it('holds staff to no daily quota', async () => {
    for (let index = 0; index < 22; index += 1)
      await create(staff, { path: fresh() }).expect(201);
  });

  describe('visiting', () => {
    it('answers a HEAD probe like a visit but does not count it', async () => {
      const path = fresh();
      const { code } = dataOf<Link>(
        await create(student, { path }).expect(201),
      );
      const response = await api.http().head(`/s/${code}`).redirects(0);
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(path);
      expect(
        await api.db.collection('shortLinks').findOne({ code }),
      ).toMatchObject({ hits: 0 });
    });

    it('redirects to the stored relative path, uncached, and counts the visit', async () => {
      const path = fresh();
      const { code } = dataOf<Link>(
        await create(student, { path }).expect(201),
      );
      const response = await visit(code).expect(302);
      expect(response.headers.location).toBe(path);
      expect(response.headers['cache-control']).toContain('no-store');
      await visit(code.toUpperCase()).expect(302);
      const row = await api.db.collection('shortLinks').findOne({ code });
      expect(row).toMatchObject({ hits: 2 });
      expect(row?.lastHitAt).toBeInstanceOf(Date);
    });

    it('counts every one of 30 simultaneous visits exactly once', async () => {
      const { code } = dataOf<Link>(
        await create(student, { path: fresh() }).expect(201),
      );
      await Promise.all(
        Array.from({ length: 30 }, () => visit(code).expect(302)),
      );
      expect(
        await api.db.collection('shortLinks').findOne({ code }),
      ).toMatchObject({ hits: 30 });
    });

    it('answers 404 for an unknown code and for an expired link, without counting', async () => {
      const unknown = await visit('nosuch').expect(404);
      expect(unknown.headers['cache-control']).toContain('no-store');
      const path = fresh();
      const { code } = dataOf<Link>(
        await create(staff, {
          path,
          code: 'soonover',
          expiresAt: '2099-01-01T00:00:00Z',
        }).expect(201),
      );
      await api.db
        .collection('shortLinks')
        .updateOne(
          { code },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );
      await visit(code).expect(404);
      expect(
        await api.db.collection('shortLinks').findOne({ code }),
      ).toMatchObject({ hits: 0 });
    });

    it('refuses to redirect to a stored path outside the allow-list, whatever wrote it', async () => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      for (const [code, path] of [
        ['evil01', '//evil.example'],
        ['evil02', 'https://evil.example'],
        ['evil03', '/problems/ok?next=//evil.example'],
      ] as const) {
        await api.db.collection('shortLinks').insertOne({
          _id: toUuid(newId()),
          code,
          path,
          createdBy: toUuid(newId()),
          isAuto: false,
          hits: 0,
          expiresAt: null,
          lastHitAt: null,
        } as never);
        const response = await visit(code).expect(404);
        expect(response.headers.location).toBeUndefined();
        expect(
          await api.db.collection('shortLinks').findOne({ code }),
        ).toMatchObject({ hits: 0 });
      }
      error.mockRestore();
    });

    it('limits visits to 120 a minute per address', async () => {
      const { code } = dataOf<Link>(
        await create(student, { path: fresh() }).expect(201),
      );
      for (let index = 0; index < 120; index += 1)
        await visit(code).expect(302);
      await visit(code).expect(429).expect(errorCode('rate_limited'));
    });
  });

  describe('listing and deleting', () => {
    it('lists a user their own links and staff everyone, paged', async () => {
      const mine = dataOf<Link>(
        await create(student, { path: fresh() }).expect(201),
      );
      const theirs = dataOf<Link>(
        await create(other, { path: fresh() }).expect(201),
      );
      const codesOf = async (session: TestSession, query: string) =>
        dataOf<Link[]>(
          await authed(
            api.http().get(`/api/internal/short-links${query}`),
            session,
          ).expect(200),
        ).map((link) => link.code);
      const ownCodes = await codesOf(student, '');
      expect(ownCodes).toContain(mine.code);
      expect(ownCodes).not.toContain(theirs.code);
      expect(await codesOf(staff, '?scope=all&pageSize=100')).toEqual(
        expect.arrayContaining([mine.code, theirs.code]),
      );
      await authed(
        api.http().get('/api/internal/short-links?scope=all'),
        student,
      ).expect(403);
      await authed(
        api.http().get('/api/internal/short-links?scope=everything'),
        student,
      ).expect(400);
      const page = await authed(
        api.http().get('/api/internal/short-links?scope=all&pageSize=1'),
        staff,
      ).expect(200);
      const { data, meta } = page.body as {
        data: Link[];
        meta: { pageSize: number };
      };
      expect(data).toHaveLength(1);
      expect(meta.pageSize).toBe(1);
    });

    it('lets staff delete a link, which stops working at once, and logs who did it', async () => {
      const { code } = dataOf<Link>(
        await create(student, { path: fresh() }).expect(201),
      );
      await authed(
        api.http().delete(`/api/internal/short-links/${code}`),
        student,
      ).expect(403);
      const log = jest.spyOn(Logger.prototype, 'log');
      await authed(
        api.http().delete(`/api/internal/short-links/${code}`),
        staff,
      ).expect(204);
      const lines = log.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('short-link.deleted'));
      log.mockRestore();
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ code });
      await visit(code).expect(404);
      await authed(
        api.http().delete(`/api/internal/short-links/${code}`),
        staff,
      ).expect(404);
    });

    it('deletes by the code in any letter case, like the redirect resolves it', async () => {
      const { code } = dataOf<Link>(
        await create(student, { path: fresh() }).expect(201),
      );
      await visit(code.toUpperCase()).expect(302);
      await authed(
        api.http().delete(`/api/internal/short-links/${code.toUpperCase()}`),
        staff,
      ).expect(204);
      await visit(code).expect(404);
    });

    it('needs a signed-in user to create, list or delete', async () => {
      await api
        .http()
        .post('/api/internal/short-links')
        .send({ path: fresh() })
        .expect(401);
      await api.http().get('/api/internal/short-links').expect(401);
      await api.http().delete('/api/internal/short-links/abcdef').expect(401);
    });
  });
});
