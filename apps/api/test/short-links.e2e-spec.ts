import { Logger } from '@nestjs/common';
import { newId, toUuid } from '@libs/database';
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
  });
  beforeEach(async () => {
    forcedCodes.length = 0;
    await clearRateLimits(api);
  });
  afterAll(() => api.teardown());

  describe('creating', () => {
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
  });

  describe('visiting', () => {
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
  });

  describe('listing and deleting', () => {
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
  });
});
